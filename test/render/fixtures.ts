import type { EffectSpec, Grid, Manifest, Pack, RGB, StyleName } from "../../src/art/types.ts"
import type { Capabilities, ThemeColors } from "../../src/render/types.ts"

export function makeGrid(rows: readonly string[], color?: RGB): Grid {
  const cols = rows.length > 0 ? rows[0].length : 0
  const chars = rows.join("")
  let colors: Uint8Array | null = null
  if (color) {
    colors = new Uint8Array(cols * rows.length * 3)
    for (let index = 0; index < cols * rows.length; index++) {
      colors[index * 3] = color[0]
      colors[index * 3 + 1] = color[1]
      colors[index * 3 + 2] = color[2]
    }
  }
  return { cols, rows: rows.length, chars, colors }
}

/** Grid where each column has its own color, so movement is visible. */
export function columnColoredGrid(rows: readonly string[]): Grid {
  const width = rows[0]?.length ?? 0
  const colors = new Uint8Array(width * rows.length * 3)
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 3
      colors[index] = (x * 17) % 256
      colors[index + 1] = (y * 11 + 40) % 256
      colors[index + 2] = 200
    }
  }
  return { cols: width, rows: rows.length, chars: rows.join(""), colors }
}

export interface PackOptions {
  readonly kind?: "frames" | "canvas"
  readonly frames?: readonly Grid[]
  readonly palette?: readonly string[]
  readonly effects?: readonly EffectSpec[]
  readonly ramp?: string
  readonly fps?: number
  readonly defaultStyle?: StyleName
}

export function makePack(options: PackOptions = {}): Pack {
  const frames = options.frames ?? [makeGrid(["ab", "cd"])]
  const first = frames[0]
  const kind = options.kind ?? "canvas"
  const manifest: Manifest = {
    schemaVersion: 1,
    id: "test",
    name: "Test",
    fps: options.fps ?? 10,
    cols: first.cols,
    rows: first.rows,
    defaultStyle: options.defaultStyle ?? "mono",
    ramp: options.ramp ?? " .:-=+*#%@",
    effects: options.effects ?? [],
    ...(options.palette ? { palette: options.palette } : {}),
    ...(kind === "frames" ? { frames: "frames" } : { canvas: "canvas.txt" }),
  }
  return { id: "test", dir: "/tmp/test", manifest, kind, frames, warnings: [] }
}

export const DARK_THEME: ThemeColors = {
  faint: [110, 110, 125, 255],
  muted: [170, 170, 185, 255],
  base: [235, 235, 245, 255],
  hue: [190, 150, 255, 255],
  background: [20, 20, 30, 255],
}

export const LIGHT_THEME: ThemeColors = {
  faint: [150, 150, 150, 255],
  muted: [90, 90, 90, 255],
  base: [25, 25, 25, 255],
  hue: [80, 40, 160, 255],
  background: [246, 246, 240, 255],
}

export const RGB_CAPS: Capabilities = { rgb: true, ansi256: true, unicode: true, color: true }
export const ANSI256_CAPS: Capabilities = { rgb: false, ansi256: true, unicode: true, color: true }
export const ANSI16_CAPS: Capabilities = { rgb: false, ansi256: false, unicode: true, color: true }
export const MONO_CAPS: Capabilities = { rgb: false, ansi256: false, unicode: false, color: false }
