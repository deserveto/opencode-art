import type { Grid } from "../art/types.ts"

/**
 * Built-in density table for common ASCII. Values mirror the recommended ramp
 * (` .:-=+*#%@`) and place the remaining punctuation and letters by eye.
 */
const DENSITY: Readonly<Record<string, number>> = {
  " ": 0,
  ".": 1 / 9,
  ",": 0.03,
  "'": 0.02,
  "`": 0.02,
  '"': 0.03,
  ":": 2 / 9,
  ";": 0.16,
  "~": 0.25,
  "-": 3 / 9,
  _: 0.3,
  "=": 4 / 9,
  "+": 5 / 9,
  "*": 6 / 9,
  "/": 0.35,
  "\\": 0.35,
  "|": 0.33,
  "(": 0.3,
  ")": 0.3,
  "[": 0.3,
  "]": 0.3,
  "{": 0.3,
  "}": 0.3,
  "<": 0.35,
  ">": 0.35,
  "^": 0.3,
  "!": 0.2,
  "?": 0.4,
  "#": 7 / 9,
  "%": 8 / 9,
  "@": 1,
  "0": 0.5,
  "1": 0.3,
  "2": 0.45,
  "3": 0.5,
  "4": 0.55,
  "5": 0.6,
  "6": 0.65,
  "7": 0.7,
  "8": 0.75,
  "9": 0.7,
  o: 0.45,
  O: 0.65,
  x: 0.5,
  X: 0.6,
  a: 0.5,
  A: 0.6,
  b: 0.6,
  B: 0.65,
  c: 0.5,
  C: 0.6,
  e: 0.5,
  E: 0.6,
  g: 0.55,
  G: 0.65,
  h: 0.5,
  H: 0.6,
  k: 0.5,
  K: 0.6,
  m: 0.6,
  M: 0.7,
  n: 0.55,
  N: 0.65,
  p: 0.55,
  P: 0.6,
  q: 0.55,
  Q: 0.65,
  s: 0.5,
  S: 0.6,
  u: 0.5,
  U: 0.6,
  v: 0.5,
  V: 0.6,
  w: 0.55,
  W: 0.7,
  y: 0.5,
  Y: 0.6,
  z: 0.5,
  Z: 0.6,
}

const UNKNOWN = 0.5

/** Brightness of one glyph: ramp rank first, then the density table, then 0.5. */
export function glyphBrightness(char: string, ramp: string): number {
  if (char === "" || char === " ") return 0
  if (ramp.length >= 2) {
    const rank = ramp.indexOf(char)
    if (rank >= 0) return rank / (ramp.length - 1)
  }
  return DENSITY[char] ?? UNKNOWN
}

/** Coarse density bucket used by effects that swap glyphs. */
export function densityBucket(brightness: number): number {
  const value = Number.isFinite(brightness) ? Math.max(0, Math.min(1, brightness)) : UNKNOWN
  return Math.min(3, Math.floor(value * 4))
}

/** Brightness of the glyph at `x`, `y`. Out-of-bounds cells report the unknown value. */
export function brightnessAt(grid: Grid, ramp: string, x: number, y: number): number {
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= grid.cols || py >= grid.rows) return UNKNOWN
  return glyphBrightness(grid.chars[py * grid.cols + px] ?? " ", ramp)
}
