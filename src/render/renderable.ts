import { RGBA, Renderable } from "@opentui/core"
import type { OptimizedBuffer, RenderContext, RenderableOptions } from "@opentui/core"
import type { Grid, Pack } from "../art/types.ts"
import { applyEffects } from "../effects/index.ts"
import { brightnessAt } from "./brightness.ts"
import { hexToRgba4, quantizeForCapability } from "./colors.ts"
import { computePaintArea, fitFrame, stopIndexFor } from "./frame.ts"
import { Player } from "./player.ts"
import { resolveStyle } from "./styles.ts"
import type { Capabilities, RGBA4, ResolvedStyle, ThemeColors } from "./types.ts"

export interface ArtRenderableOptions extends RenderableOptions<ArtRenderable> {
  readonly pack?: Pack | null
  readonly style?: ResolvedStyle
  readonly fps?: number
  readonly enabled?: boolean
  readonly paused?: boolean
  readonly animations?: boolean
  /** Optional; only needed so slow `original` art can degrade to a theme palette. */
  readonly theme?: ThemeColors
  readonly onError?: (message: string) => void
  readonly onDegrade?: (message: string) => void
}

const FALLBACK_STYLE: ResolvedStyle = {
  requested: "mono",
  effective: "mono",
  stops: [[255, 255, 255, 255]],
  original: false,
}

const MAX_STYLE_STOPS = 32
const MAX_ORIGINAL_COLORS = 4096
const SAMPLE_WINDOW = 30
const SLOW_FRAME_MS = 12
const VERY_SLOW_FRAME_MS = 20
const MIN_DEGRADED_FPS = 5
const MAX_ERRORS = 3
const MIN_FPS = 1
const MAX_FPS = 30

interface FitCache {
  readonly pack: Pack
  readonly cols: number
  readonly rows: number
  readonly frames: Map<number, Grid>
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Full-screen background renderer. Paints one cached display grid per frame,
 * advances a pure Player on the host animation clock, and never throws out of
 * a tick or a paint.
 */
export class ArtRenderable extends Renderable {
  private _pack: Pack | null = null
  private _style: ResolvedStyle = FALLBACK_STYLE
  private _fps: number | undefined
  private _enabled = true
  private _paused = false
  private _animations = true
  private _theme: ThemeColors | undefined
  private _onError: ((message: string) => void) | undefined
  private _onDegrade: ((message: string) => void) | undefined

  private _player = new Player({ frameCount: 1, fps: 10, animated: true, staticCanvas: false })
  private _fitCache: FitCache | null = null
  private _displayGrid: Grid | null = null
  private _displayCols = 0
  private _displayRows = 0
  private _stopColors: RGBA[] | null = null
  private _stopColorsFor: ResolvedStyle | null = null
  private _originalColors = new Map<number, RGBA>()

  private _samples: number[] = []
  private _degraded = false
  private _fpsReduced = false
  private _errorCount = 0
  private _stopped = false
  private _rendering = false

  /** One-shot blank paint state, so idle art does not repaint every host frame. */
  private _cleared = true
  private _clearedCols = 0
  private _clearedRows = 0

  constructor(ctx: RenderContext, options: ArtRenderableOptions) {
    // A renderable with no children has no intrinsic size; fill the parent box.
    super(ctx, { ...options, width: options.width ?? "100%", height: options.height ?? "100%" })
    this._theme = options.theme
    this._onError = options.onError
    this._onDegrade = options.onDegrade
    this._fps = typeof options.fps === "number" && Number.isFinite(options.fps) ? options.fps : undefined
    this._enabled = options.enabled !== false
    this._paused = options.paused === true
    this._animations = options.animations !== false
    this._pack = options.pack ?? null
    this._style = options.style ?? FALLBACK_STYLE
    this.rebuildPlayer()
    this.updateAnimation()
    this.safeRequestRender()
  }

  /** A cleared width/height fills the parent instead of collapsing to zero. */
  protected override defaultDimension(_kind: "width" | "height"): number | "auto" | `${number}%` {
    return "100%"
  }

  get pack(): Pack | null {
    return this._pack
  }

  set pack(value: Pack | null | undefined) {
    const next = value ?? null
    if (next === this._pack) return
    this._pack = next
    this.invalidate()
    this.rebuildPlayer()
    this.updateAnimation()
  }

  get style(): ResolvedStyle {
    return this._style
  }

  set style(value: ResolvedStyle | undefined) {
    const next = value ?? FALLBACK_STYLE
    if (next === this._style) return
    this._style = next
    this.invalidate()
  }

  get fps(): number | undefined {
    return this._fps
  }

  set fps(value: number | undefined) {
    const next = typeof value === "number" && Number.isFinite(value) ? value : undefined
    if (next === this._fps) return
    this._fps = next
    this._player.setFps(this.effectiveFps())
    this.updateAnimation()
  }

  get enabled(): boolean {
    return this._enabled
  }

  set enabled(value: boolean | undefined) {
    const next = value !== false
    if (next === this._enabled) return
    this._enabled = next
    if (next) this._cleared = false
    if (!next) this._player.reset()
    this.invalidate()
    this.updateAnimation()
  }

  get paused(): boolean {
    return this._paused
  }

  set paused(value: boolean | undefined) {
    const next = value === true
    if (next === this._paused) return
    this._paused = next
    if (next) {
      this._player.reset()
    } else {
      this._cleared = false
    }
    this.invalidate()
    this.updateAnimation()
  }

  get animations(): boolean {
    return this._animations
  }

  set animations(value: boolean | undefined) {
    const next = value !== false
    if (next === this._animations) return
    this._animations = next
    this.rebuildPlayer()
    this.invalidate()
    this.updateAnimation()
  }

  get theme(): ThemeColors | undefined {
    return this._theme
  }

  set theme(value: ThemeColors | undefined) {
    this._theme = value
  }

  get onError(): ((message: string) => void) | undefined {
    return this._onError
  }

  set onError(value: ((message: string) => void) | undefined) {
    this._onError = value
  }

  get onDegrade(): ((message: string) => void) | undefined {
    return this._onDegrade
  }

  set onDegrade(value: ((message: string) => void) | undefined) {
    this._onDegrade = value
  }

  /** Only ticks while art is enabled, on-home, animations are on, and there is motion. */
  private updateAnimation(): void {
    if (this.isDestroyed || this._stopped) {
      this.animationFps = undefined
      return
    }
    const pack = this._pack
    const active = this._enabled && !this._paused && this._animations && pack !== null && pack.frames.length > 0
    const moving =
      pack !== null && (pack.kind === "frames" ? pack.frames.length > 1 : this.hasEffects(pack))
    const desired = active && moving ? this.effectiveFps() : undefined

    if (this.animationFps === desired) return
    this.animationFps = desired
    if (desired === undefined) this._displayGrid = null
    this.safeRequestRender()
  }

  private effectiveFps(): number {
    const raw = this._fps ?? this._pack?.manifest.fps ?? 10
    return Math.min(MAX_FPS, Math.max(MIN_FPS, finiteOr(raw, 10)))
  }

  private hasEffects(pack: Pack | null = this._pack): boolean {
    return pack !== null && pack.kind === "canvas" && (pack.manifest.effects?.length ?? 0) > 0
  }

  private rebuildPlayer(): void {
    const pack = this._pack
    const frameCount = pack === null ? 1 : pack.kind === "frames" ? pack.frames.length : 1
    this._player = new Player({
      frameCount,
      fps: this.effectiveFps(),
      animated: this._animations,
      staticCanvas: pack !== null && pack.kind === "canvas" && !this.hasEffects(pack),
    })
  }

  private invalidate(): void {
    this._fitCache = null
    this._displayGrid = null
    this._displayCols = 0
    this._displayRows = 0
    this._stopColors = null
    this._stopColorsFor = null
    this._originalColors.clear()
    this.safeRequestRender()
  }

  private safeRequestRender(): void {
    if (this.isDestroyed) return
    // Requests made during a paint pass are dropped by the host; defer them.
    if (this._rendering) {
      queueMicrotask(() => this.safeRequestRender())
      return
    }
    this.requestRender()
  }

  private capabilities(): Capabilities {
    const caps = this._ctx.capabilities
    return { rgb: caps?.rgb ?? true, ansi256: caps?.ansi256 ?? false, unicode: true, color: true }
  }

  private displayGrid(): Grid | null {
    if (this._stopped || !this._enabled || this._paused) return null
    const pack = this._pack
    if (pack === null || pack.frames.length === 0) return null

    const cols = Math.floor(this._paintWidth)
    const rows = Math.floor(this._paintHeight)
    if (!(cols > 0) || !(rows > 0)) return null

    if (this._displayGrid && this._displayCols === cols && this._displayRows === rows) {
      return this._displayGrid
    }

    const index = pack.kind === "frames" ? this._player.index : 0
    const grid = this.buildDisplay(pack, index, cols, rows)
    this._displayGrid = grid
    this._displayCols = cols
    this._displayRows = rows
    this._originalColors.clear()
    return grid
  }

  private buildDisplay(pack: Pack, index: number, cols: number, rows: number): Grid | null {
    const cache = this._fitCache
    const reusable = cache !== null && cache.pack === pack && cache.cols === cols && cache.rows === rows
    let fitted = reusable ? cache.frames.get(index) : undefined

    if (!fitted) {
      fitted = fitFrame(pack, index, cols, rows) ?? undefined
      if (!fitted) return null
      if (reusable && cache) {
        cache.frames.set(index, fitted)
      } else {
        this._fitCache = { pack, cols, rows, frames: new Map([[index, fitted]]) }
      }
    }

    const effects = pack.kind === "canvas" ? pack.manifest.effects ?? [] : []
    if (effects.length === 0 || !this._animations) return fitted
    return applyEffects(fitted, effects, this._player.time, { fps: this.effectiveFps(), seed: 0 })
  }

  private stopColors(style: ResolvedStyle): readonly RGBA[] {
    if (this._stopColorsFor === style && this._stopColors) return this._stopColors
    const colors: RGBA[] = []
    for (const stop of style.stops.slice(0, MAX_STYLE_STOPS)) {
      colors.push(RGBA.fromInts(stop[0], stop[1], stop[2], stop[3]))
    }
    if (colors.length === 0) colors.push(RGBA.fromInts(255, 255, 255, 255))
    this._stopColors = colors
    this._stopColorsFor = style
    return colors
  }

  private originalColor(colors: Uint8Array, index: number, caps: Capabilities): RGBA {
    const r = colors[index * 3] ?? 0
    const g = colors[index * 3 + 1] ?? 0
    const b = colors[index * 3 + 2] ?? 0
    const key = (r << 16) | (g << 8) | b
    const cached = this._originalColors.get(key)
    if (cached) return cached

    if (this._originalColors.size >= MAX_ORIGINAL_COLORS) this._originalColors.clear()
    const [qr, qg, qb, qa] = quantizeForCapability([r, g, b, 255], caps)
    const color = RGBA.fromInts(qr, qg, qb, qa)
    this._originalColors.set(key, color)
    return color
  }

  private paint(buffer: OptimizedBuffer, grid: Grid): void {
    const style = this._style
    const ramp = this._pack?.manifest.ramp ?? ""
    const ox = this.buffered ? 0 : Math.trunc(this._screenX)
    const oy = this.buffered ? 0 : Math.trunc(this._screenY)
    const area = computePaintArea(grid.cols, grid.rows, ox, oy, buffer.width, buffer.height)
    if (!area) return

    const stops = this.stopColors(style)
    const usesOriginal = style.original && grid.colors !== null
    const caps = usesOriginal ? this.capabilities() : null
    const background = RGBA.fromInts(0, 0, 0, 0)

    for (let y = area.startY; y < area.endY; y++) {
      const screenY = oy + y
      for (let x = area.startX; x < area.endX; x++) {
        const index = y * grid.cols + x
        const raw = grid.chars[index] ?? " "
        const char = raw === "" ? " " : raw
        const foreground =
          usesOriginal && caps && grid.colors
            ? this.originalColor(grid.colors, index, caps)
            : stops[stopIndexFor(brightnessAt(grid, ramp, x, y), stops.length)]
        buffer.setCell(ox + x, screenY, char, foreground, background, 0)
      }
    }
  }

  private markPainted(): void {
    this._cleared = false
    this._clearedCols = 0
    this._clearedRows = 0
  }

  /** Clears the last art cells once after art goes away or the idle area resizes. */
  private blankPaintArea(buffer: OptimizedBuffer): void {
    const cols = Math.floor(this._paintWidth)
    const rows = Math.floor(this._paintHeight)
    if (this._cleared && this._clearedCols === cols && this._clearedRows === rows) return
    this._cleared = true
    this._clearedCols = cols
    this._clearedRows = rows
    if (!(cols > 0) || !(rows > 0)) return

    const ox = this.buffered ? 0 : Math.trunc(this._screenX)
    const oy = this.buffered ? 0 : Math.trunc(this._screenY)
    const area = computePaintArea(cols, rows, ox, oy, buffer.width, buffer.height)
    if (!area) return

    const foreground = RGBA.fromInts(255, 255, 255, 255)
    const background = RGBA.fromInts(0, 0, 0, 0)
    for (let y = area.startY; y < area.endY; y++) {
      const screenY = oy + y
      for (let x = area.startX; x < area.endX; x++) {
        buffer.setCell(ox + x, screenY, " ", foreground, background, 0)
      }
    }
  }

  private recordRenderTime(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return
    this._samples.push(ms)
    if (this._samples.length > SAMPLE_WINDOW) this._samples.shift()
    if (this._samples.length < SAMPLE_WINDOW) return

    const average = this._samples.reduce((total, value) => total + value, 0) / SAMPLE_WINDOW
    if (average > SLOW_FRAME_MS && !this._degraded && this._style.effective === "original") {
      this._degraded = true
      this._samples.length = 0
      this.degradeStyle()
    } else if (average > VERY_SLOW_FRAME_MS && !this._fpsReduced) {
      this._fpsReduced = true
      this._samples.length = 0
      this.reduceFps()
    }
  }

  /** One-shot safety net: exact colors to palette (or theme) when painting is slow. */
  private degradeStyle(): void {
    const pack = this._pack
    if (pack === null) return
    const current = this._style
    let next: ResolvedStyle
    if (this._theme) {
      next = resolveStyle("palette", pack, this.capabilities(), this._theme)
    } else {
      const palette = pack.manifest.palette
      const hasPalette = !!palette && palette.length >= 2
      const stops: RGBA4[] =
        palette && palette.length >= 2
          ? palette
              .slice(0, MAX_STYLE_STOPS)
              .map((hex) => quantizeForCapability(hexToRgba4(hex), this.capabilities()))
          : [[255, 255, 255, 255]]
      next = {
        requested: current.requested,
        effective: hasPalette ? "palette" : "mono",
        stops,
        original: false,
        reason: "render too slow; colors simplified",
      }
    }
    this._style = next
    this._stopColors = null
    this._stopColorsFor = null
    this._displayGrid = null
    this.notify(this._onDegrade, `art rendering slow; switched to ${next.effective} colors`)
  }

  /** One-shot safety net: halve the tick rate, never below 5 fps. */
  private reduceFps(): void {
    const current = this.animationFps ?? this.effectiveFps()
    const next = Math.max(MIN_DEGRADED_FPS, Math.floor(current / 2))
    if (next >= current) return
    const wasActive = this.animationFps !== undefined
    this._fps = next
    this._player.setFps(next)
    if (wasActive && !this.isDestroyed) this.animationFps = next
    this.notify(this._onDegrade, `art rendering slow; fps reduced to ${next}`)
  }

  private notify(callback: ((message: string) => void) | undefined, message: string): void {
    if (!callback) return
    try {
      callback(message)
    } catch {
      // A failing toast must never break rendering.
    }
  }

  private handleError(error: unknown): void {
    this._errorCount += 1
    if (this._errorCount < MAX_ERRORS) return
    this._stopped = true
    this.animationFps = undefined
    this._displayGrid = null
    this._fitCache = null
    this._originalColors.clear()
    this.safeRequestRender()
    this.notify(this._onError, `art rendering failed: ${errorMessage(error)}`)
  }

  protected override onAnimationTick(deltaTime: number, ticks: number, time: number): void {
    void ticks
    void time
    if (this._stopped || this.animationFps === undefined) return
    try {
      const changed = this._player.advance(deltaTime)
      if (changed || this.hasEffects()) {
        this._displayGrid = null
        this._originalColors.clear()
        this.safeRequestRender()
      }
      this._errorCount = 0
    } catch (error) {
      this.handleError(error)
    }
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    const started = performance.now()
    this._rendering = true
    try {
      const grid = this.displayGrid()
      if (!grid) {
        this.blankPaintArea(buffer)
        return
      }
      this.markPainted()
      this.paint(buffer, grid)
      this._errorCount = 0
      this.recordRenderTime(performance.now() - started)
    } catch (error) {
      this.handleError(error)
    } finally {
      this._rendering = false
    }
  }

  protected override destroySelf(): void {
    this._stopped = true
    this.animationFps = undefined
    this._fitCache = null
    this._displayGrid = null
    this._stopColors = null
    this._stopColorsFor = null
    this._originalColors.clear()
    this._samples.length = 0
    super.destroySelf()
  }
}
