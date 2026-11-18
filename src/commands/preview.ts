import type { Grid, Pack } from "../art/types.ts"
import { brightnessAt, fitGrid } from "../render/index.ts"
import type { RGBA4, ResolvedStyle } from "../render/types.ts"

export interface PreviewRun {
  readonly text: string
  readonly color: RGBA4 | null
}

export type Preview = readonly (readonly PreviewRun[])[]

/** A still frame fitted to the preview box, grouped into colored runs. */
export function buildPreview(pack: Pack, style: ResolvedStyle, cols: number, rows: number): Preview {
  const frame = pack.frames[0]
  if (!frame || cols < 1 || rows < 1) return []
  const grid = fitGrid(frame, cols, rows)
  const ramp = pack.manifest.ramp
  const lines: PreviewRun[][] = []
  for (let y = 0; y < grid.rows; y++) {
    const runs: PreviewRun[] = []
    let text = ""
    let color: RGBA4 | null = null
    for (let x = 0; x < grid.cols; x++) {
      const next = colorAt(grid, style, ramp, x, y)
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

function colorAt(grid: Grid, style: ResolvedStyle, ramp: string, x: number, y: number): RGBA4 | null {
  if (style.original && grid.colors) {
    const index = (y * grid.cols + x) * 3
    const r = grid.colors[index]
    const g = grid.colors[index + 1]
    const b = grid.colors[index + 2]
    if (r === undefined || g === undefined || b === undefined) return null
    if (r === 0 && g === 0 && b === 0) return null
    return [r, g, b, 255]
  }
  if (style.stops.length === 0) return null
  const brightness = brightnessAt(grid, ramp, x, y)
  const index = Math.min(style.stops.length - 1, Math.floor(brightness * style.stops.length))
  return style.stops[index] ?? null
}

function sameColor(a: RGBA4 | null, b: RGBA4 | null): boolean {
  if (a === null || b === null) return a === b
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

export function previewText(preview: Preview): string {
  return preview.map((line) => line.map((run) => run.text).join("")).join("\n")
}
