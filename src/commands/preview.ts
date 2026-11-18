import type { Grid, Pack } from "../art/types.ts"
import { applyEffects, brightnessAt, contrastAdjust, fitGrid } from "../render/index.ts"
import type { RGBA4, ResolvedStyle } from "../render/types.ts"

export interface PreviewRun {
  readonly text: string
  readonly color: RGBA4 | null
}

export type Preview = readonly (readonly PreviewRun[])[]

export interface PreviewOptions {
  readonly frameIndex?: number
  readonly time?: number
  readonly fps?: number
  readonly animations?: boolean
  readonly dim?: number
  readonly background?: RGBA4
  readonly foreground?: RGBA4
}

function dimFraction(dim: number | undefined): number {
  if (typeof dim !== "number" || !Number.isFinite(dim) || dim <= 0) return 0
  return Math.min(0.8, dim / 100)
}

function blendToward(color: RGBA4, target: RGBA4, t: number): RGBA4 {
  return [
    Math.round(color[0] + (target[0] - color[0]) * t),
    Math.round(color[1] + (target[1] - color[1]) * t),
    Math.round(color[2] + (target[2] - color[2]) * t),
    color[3],
  ]
}

/** A frame fitted to the preview box, grouped into colored runs. */
export function buildPreview(
  pack: Pack,
  style: ResolvedStyle,
  cols: number,
  rows: number,
  options?: PreviewOptions,
): Preview {
  if (pack.frames.length === 0 || cols < 1 || rows < 1) return []
  const rawIndex =
    typeof options?.frameIndex === "number" && Number.isFinite(options.frameIndex)
      ? Math.floor(options.frameIndex)
      : 0
  const frameIndex = Math.max(0, Math.min(pack.frames.length - 1, rawIndex))
  const frame = pack.frames[frameIndex]
  if (!frame) return []

  let grid = fitGrid(frame, cols, rows, pack.manifest.fit ?? "stretch")
  if (pack.kind === "canvas" && options?.animations && pack.manifest.effects.length > 0) {
    const time = typeof options.time === "number" && Number.isFinite(options.time) ? options.time : 0
    const fps = typeof options.fps === "number" && Number.isFinite(options.fps) ? options.fps : pack.manifest.fps
    grid = applyEffects(grid, pack.manifest.effects, time, { fps, seed: 0, ramp: pack.manifest.ramp })
  }

  const ramp = pack.manifest.ramp
  const background = options?.background
  const foreground = options?.foreground
  const dimT = background ? dimFraction(options?.dim) : 0
  const stops =
    dimT > 0 && background
      ? style.stops.map((stop) => blendToward(stop, background, dimT))
      : style.stops

  const lines: PreviewRun[][] = []
  for (let y = 0; y < grid.rows; y++) {
    const runs: PreviewRun[] = []
    let text = ""
    let color: RGBA4 | null = null
    for (let x = 0; x < grid.cols; x++) {
      const next = colorAt(grid, style, stops, ramp, x, y, dimT, foreground, background)
      if (text.length > 0 && !sameColor(color, next)) {
        runs.push({ text, color })
        text = ""
      }
      color = next
      text += grid.chars[y * grid.cols + x] ?? " "
    }
    if (text) runs.push({ text, color })
    lines.push(runs)
  }
  return lines
}

function colorAt(
  grid: Grid,
  style: ResolvedStyle,
  stops: readonly RGBA4[],
  ramp: string,
  x: number,
  y: number,
  dimT: number,
  foreground: RGBA4 | undefined,
  background: RGBA4 | undefined,
): RGBA4 | null {
  if (style.original && grid.colors) {
    const index = (y * grid.cols + x) * 3
    const r = grid.colors[index]
    const g = grid.colors[index + 1]
    const b = grid.colors[index + 2]
    if (r === undefined || g === undefined || b === undefined) return null
    if (r === 0 && g === 0 && b === 0) return null
    let color: RGBA4 = [r, g, b, 255]
    if (style.lightLift && foreground && background) {
      color = contrastAdjust(color, foreground, background, 3, 0.25).color
    }
    return dimT > 0 && background ? blendToward(color, background, dimT) : color
  }
  if (stops.length === 0) return null
  const brightness = brightnessAt(grid, ramp, x, y)
  const index = Math.min(stops.length - 1, Math.floor(brightness * stops.length))
  return stops[index] ?? null
}

function sameColor(a: RGBA4 | null, b: RGBA4 | null): boolean {
  if (a === null || b === null) return a === b
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

export function previewText(preview: Preview): string {
  return preview.map((line) => line.map((run) => run.text).join("")).join("\n")
}
