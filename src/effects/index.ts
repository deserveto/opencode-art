import type { EffectSpec, Grid } from "../art/types.ts"
import { densityBucket, glyphBrightness } from "../render/brightness.ts"

const DEFAULT_FPS = 10
const MAX_FPS = 30
const DEFAULT_INTENSITY = 0.5
const DEFAULT_SPEED = 1
const DEFAULT_SEED = 0
const MONO_RAMP = " .:-=+*#%@"

interface Params {
  readonly intensity: number
  readonly speed: number
  readonly seed: number
  readonly axis: "x" | "y"
}

interface MutableGrid {
  cols: number
  rows: number
  chars: string[]
  colors: Uint8Array | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function numberOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function params(spec: EffectSpec): Params {
  return {
    intensity: clamp(numberOr(spec.intensity, DEFAULT_INTENSITY), 0, 1),
    speed: clamp(numberOr(spec.speed, DEFAULT_SPEED), 0, 4),
    seed: Math.trunc(numberOr(spec.seed, DEFAULT_SEED)),
    axis: spec.axis === "y" ? "y" : "x",
  }
}

function safeTime(time: number): number {
  return Number.isFinite(time) && time > 0 ? time : 0
}

function safeFps(fps: number): number {
  return clamp(Math.trunc(numberOr(fps, DEFAULT_FPS)), 1, MAX_FPS)
}

/** Deterministic 32-bit hash of three integers, returned in [0, 1). */
function hash(x: number, y: number, z: number): number {
  let value = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1)
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
  value ^= value >>> 16
  return (value >>> 0) / 4294967296
}

function toMutable(grid: Grid): MutableGrid {
  const cols = Number.isFinite(grid.cols) ? Math.max(0, Math.floor(grid.cols)) : 0
  const rows = Number.isFinite(grid.rows) ? Math.max(0, Math.floor(grid.rows)) : 0
  const cells = cols * rows
  const chars = new Array<string>(cells)
  for (let index = 0; index < cells; index++) chars[index] = grid.chars[index] ?? " "

  let colors: Uint8Array | null = null
  if (grid.colors) {
    colors = new Uint8Array(cells * 3)
    const copy = Math.min(colors.length, grid.colors.length)
    for (let index = 0; index < copy; index++) colors[index] = grid.colors[index]
  }

  return { cols, rows, chars, colors }
}

function toGrid(grid: MutableGrid): Grid {
  return { cols: grid.cols, rows: grid.rows, chars: grid.chars.join(""), colors: grid.colors }
}

function wrap(value: number, size: number): number {
  if (size <= 0) return 0
  return ((value % size) + size) % size
}

/** Glyph candidates grouped by the same density bucket shimmer uses. */
const SPARKLE_BUCKETS: readonly (readonly string[])[] = (() => {
  const buckets: string[][] = [[], [], [], []]
  for (const char of ".,:;'-~|/=+*ox#%@8") {
    buckets[densityBucket(glyphBrightness(char, ""))].push(char)
  }
  return buckets
})()

function shimmer(grid: MutableGrid, p: Params, time: number, fps: number, metaSeed: number): void {
  if (p.intensity <= 0) return
  const tick = Math.floor(time * fps * p.speed)
  const threshold = p.intensity * 0.3
  const seed = p.seed * 7919 + metaSeed * 31 + tick

  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const index = y * grid.cols + x
      const char = grid.chars[index]
      if (char === " " || char === "") continue
      if (hash(x, y, seed) >= threshold) continue
      const bucket = densityBucket(glyphBrightness(char, ""))
      const candidates = SPARKLE_BUCKETS[bucket]
      if (candidates.length === 0) continue
      const pick = candidates[Math.floor(hash(x + 31, y + 17, p.seed + tick) * candidates.length)]
      if (pick && pick !== char) grid.chars[index] = pick
    }
  }
}

function wave(grid: MutableGrid, p: Params, time: number): void {
  const sourceChars = grid.chars.slice()
  const sourceColors = grid.colors ? grid.colors.slice() : null
  const span = p.axis === "x" ? grid.cols : grid.rows
  const amplitude = Math.min(6, Math.max(0, Math.round(p.intensity * 6)), Math.max(0, span - 1))
  if (amplitude === 0) return

  const phase = time * p.speed * Math.PI
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const coordinate = p.axis === "x" ? y : x
      const shift = Math.round(Math.sin((Math.PI * 2 * coordinate) / 12 + phase) * amplitude)
      const srcX = p.axis === "x" ? wrap(x + shift, grid.cols) : x
      const srcY = p.axis === "x" ? y : wrap(y + shift, grid.rows)
      const sourceIndex = srcY * grid.cols + srcX
      const index = y * grid.cols + x
      grid.chars[index] = sourceChars[sourceIndex] ?? " "
      if (grid.colors && sourceColors) {
        grid.colors[index * 3] = sourceColors[sourceIndex * 3] ?? 0
        grid.colors[index * 3 + 1] = sourceColors[sourceIndex * 3 + 1] ?? 0
        grid.colors[index * 3 + 2] = sourceColors[sourceIndex * 3 + 2] ?? 0
      }
    }
  }
}

function drift(grid: MutableGrid, p: Params, time: number): void {
  const sourceChars = grid.chars.slice()
  const sourceColors = grid.colors ? grid.colors.slice() : null
  const cellsPerSecond = 6 * p.speed * p.intensity
  const shift = Math.round(time * cellsPerSecond)
  if (shift === 0) return

  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const srcX = p.axis === "x" ? wrap(x - shift, grid.cols) : x
      const srcY = p.axis === "y" ? wrap(y - shift, grid.rows) : y
      const sourceIndex = srcY * grid.cols + srcX
      const index = y * grid.cols + x
      grid.chars[index] = sourceChars[sourceIndex] ?? " "
      if (grid.colors && sourceColors) {
        grid.colors[index * 3] = sourceColors[sourceIndex * 3] ?? 0
        grid.colors[index * 3 + 1] = sourceColors[sourceIndex * 3 + 1] ?? 0
        grid.colors[index * 3 + 2] = sourceColors[sourceIndex * 3 + 2] ?? 0
      }
    }
  }
}

function twinkle(grid: MutableGrid, p: Params, time: number, fps: number, metaSeed: number): void {
  if (p.intensity <= 0) return
  const tick = Math.floor(time * fps * p.speed)
  const threshold = p.intensity * 0.5
  const cycle = 8

  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const index = y * grid.cols + x
      if (grid.chars[index] === " ") continue
      if (hash(x, y, p.seed + metaSeed * 31) >= threshold) continue
      const phase = Math.floor(hash(x + 5, y + 9, p.seed) * cycle)
      const lit = wrap(tick + phase, cycle) < cycle / 2
      if (!lit) grid.chars[index] = " "
    }
  }
}

function scanline(grid: MutableGrid, p: Params, time: number, ramp: string): void {
  if (p.intensity <= 0) return
  const span = p.axis === "x" ? grid.cols : grid.rows
  if (span <= 0) return
  const position = wrap(Math.floor(time * p.speed * 12), span)
  const band = Math.max(1, Math.round(span * 0.08))

  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const coordinate = p.axis === "x" ? x : y
      const raw = wrap(coordinate - position, span)
      const distance = Math.min(raw, span - raw)
      if (distance > band) continue
      const strength = (1 - distance / (band + 1)) * p.intensity
      if (strength <= 0) continue
      const index = y * grid.cols + x

      if (grid.colors) {
        const scale = 1 - 0.7 * strength
        grid.colors[index * 3] = clamp(Math.round((grid.colors[index * 3] ?? 0) * scale), 0, 255)
        grid.colors[index * 3 + 1] = clamp(Math.round((grid.colors[index * 3 + 1] ?? 0) * scale), 0, 255)
        grid.colors[index * 3 + 2] = clamp(Math.round((grid.colors[index * 3 + 2] ?? 0) * scale), 0, 255)
      } else {
        let usedRamp = ramp
        let rank = usedRamp.indexOf(grid.chars[index])
        if (rank < 0) {
          usedRamp = MONO_RAMP
          rank = usedRamp.indexOf(grid.chars[index])
        }
        if (rank > 0) {
          const step = Math.max(1, Math.round(strength * 3))
          grid.chars[index] = usedRamp[Math.max(0, rank - step)]
        }
      }
    }
  }
}

/**
 * Composes effects in array order at display resolution. Pure and deterministic;
 * dimensions never change and colors travel with their cells.
 */
export function applyEffects(
  grid: Grid,
  effects: readonly EffectSpec[],
  time: number,
  meta: { fps: number; seed: number; ramp?: string },
): Grid {
  const t = safeTime(time)
  const fps = safeFps(meta?.fps)
  const metaSeed = Math.trunc(numberOr(meta?.seed, 0))
  const ramp = typeof meta?.ramp === "string" && meta.ramp.length >= 2 ? meta.ramp : MONO_RAMP
  let mutable = toMutable(grid)

  for (const spec of effects ?? []) {
    if (!spec || typeof spec.type !== "string") continue
    const p = params(spec)
    switch (spec.type) {
      case "shimmer":
        shimmer(mutable, p, t, fps, metaSeed)
        break
      case "wave":
        wave(mutable, p, t)
        break
      case "drift":
        drift(mutable, p, t)
        break
      case "twinkle":
        twinkle(mutable, p, t, fps, metaSeed)
        break
      case "scanline":
        scanline(mutable, p, t, ramp)
        break
      default:
        break
    }
  }

  return toGrid(mutable)
}
