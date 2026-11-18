import type { RGB } from "../art/types.ts"
import type { Capabilities, RGBA4 } from "./types.ts"

const BLACK: RGBA4 = [0, 0, 0, 255]

/** xterm's 16 base colors; terminal themes may differ, but quantization needs fixed values. */
const ANSI16: readonly RGB[] = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [192, 192, 192],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
]

const CUBE_LEVELS: readonly number[] = [0, 95, 135, 175, 215, 255]

function buildAnsi256(): readonly RGB[] {
  const table: RGB[] = ANSI16.map((color) => [color[0], color[1], color[2]])
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        table.push([CUBE_LEVELS[r], CUBE_LEVELS[g], CUBE_LEVELS[b]])
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const value = 8 + i * 10
    table.push([value, value, value])
  }
  return table
}

const ANSI256 = buildAnsi256()

function channel(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

/** Parses `#rgb` / `#rrggbb` (with or without `#`). Invalid input is opaque black. */
export function hexToRgba4(hex: string): RGBA4 {
  if (typeof hex !== "string") return BLACK
  let value = hex.trim()
  if (value.startsWith("#")) value = value.slice(1)
  if (value.length === 3) {
    value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2]
  } else if (value.length === 8) {
    value = value.slice(0, 6)
  }
  if (value.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(value)) return BLACK
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    255,
  ]
}

/**
 * Nearest entry in the xterm 256-color palette. Colors 0–15 are skipped because
 * their actual values depend on the user's terminal theme.
 */
export function nearestAnsi256(color: RGB | RGBA4): number {
  const r = channel(color[0])
  const g = channel(color[1])
  const b = channel(color[2])
  let best = 16
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 16; index < ANSI256.length; index++) {
    const entry = ANSI256[index]
    const dr = r - entry[0]
    const dg = g - entry[1]
    const db = b - entry[2]
    const distance = dr * dr + dg * dg + db * db
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
      if (distance === 0) break
    }
  }
  return best
}

/** Expands an xterm 256-color index to its conventional RGB value. */
export function ansi256ToRgba4(index: number): RGBA4 {
  const safe = Number.isFinite(index) ? Math.max(0, Math.min(255, Math.round(index))) : 0
  const entry = ANSI256[safe]
  return [entry[0], entry[1], entry[2], 255]
}

function nearestAnsi16(color: RGBA4): RGBA4 {
  const r = channel(color[0])
  const g = channel(color[1])
  const b = channel(color[2])
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < ANSI16.length; index++) {
    const entry = ANSI16[index]
    const dr = r - entry[0]
    const dg = g - entry[1]
    const db = b - entry[2]
    const distance = dr * dr + dg * dg + db * db
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  }
  const entry = ANSI16[best]
  return [entry[0], entry[1], entry[2], 255]
}

/** Converts an 0–255 RGBA value to the nearest color the terminal can show. */
export function quantizeForCapability(color: RGBA4, capabilities: Capabilities): RGBA4 {
  if (capabilities.rgb) {
    return [channel(color[0]), channel(color[1]), channel(color[2]), channel(color[3])]
  }
  if (capabilities.ansi256) return ansi256ToRgba4(nearestAnsi256(color))
  if (capabilities.color) return nearestAnsi16(color)
  return [channel(color[0]), channel(color[1]), channel(color[2]), channel(color[3])]
}

/** WCAG relative luminance, alpha ignored. */
export function relativeLuminance(color: RGBA4): number {
  const linear = (value: number): number => {
    const s = channel(value) / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2])
}

/** WCAG contrast ratio in the 1–21 range. */
export function contrastRatio(a: RGBA4, b: RGBA4): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

export interface ContrastAdjustment {
  readonly color: RGBA4
  readonly ratio: number
  readonly reached: boolean
}

function mix(from: RGBA4, toward: RGBA4, amount: number): RGBA4 {
  const t = Math.max(0, Math.min(1, amount))
  return [
    channel(from[0] + (toward[0] - from[0]) * t),
    channel(from[1] + (toward[1] - from[1]) * t),
    channel(from[2] + (toward[2] - from[2]) * t),
    channel(from[3] + (toward[3] - from[3]) * t),
  ]
}

/**
 * Blends `color` toward `toward` (the theme foreground) by at most `maxBlend`
 * until it reaches `target` contrast against `background`.
 */
export function contrastAdjust(
  color: RGBA4,
  toward: RGBA4,
  background: RGBA4,
  target = 3,
  maxBlend = 0.25,
): ContrastAdjustment {
  const baseRatio = contrastRatio(color, background)
  if (baseRatio >= target) return { color, ratio: baseRatio, reached: true }
  const limit = Math.max(0, Math.min(1, maxBlend))
  const steps = 20
  for (let step = 1; step <= steps; step++) {
    const blended = mix(color, toward, (limit * step) / steps)
    const ratio = contrastRatio(blended, background)
    if (ratio >= target) return { color: blended, ratio, reached: true }
  }
  const blended = mix(color, toward, limit)
  return { color: blended, ratio: contrastRatio(blended, background), reached: false }
}
