import type { Pack, StyleName } from "../art/types.ts"
import type { Capabilities, RGBA4, ResolvedStyle, ThemeColors } from "./types.ts"
import { contrastAdjust, contrastRatio, hexToRgba4, quantizeForCapability, relativeLuminance } from "./colors.ts"

const MAX_STOPS = 32
const LIGHT_BACKGROUND_LUMINANCE = 0.5
const LIGHT_CONTRAST_FLOOR = 2.2
const LIGHT_MAX_FAIL_SHARE = 0.25
const LIGHT_LIFT_TARGET = 3
const LIGHT_MAX_LIFT = 0.25

function quantizeStops(stops: readonly RGBA4[], capabilities: Capabilities): RGBA4[] {
  const trimmed = stops.slice(0, MAX_STOPS)
  if (capabilities.rgb) return trimmed.map((stop) => [stop[0], stop[1], stop[2], stop[3]])
  return trimmed.map((stop) => quantizeForCapability(stop, capabilities))
}

function themeStops(theme: ThemeColors): RGBA4[] {
  return [theme.faint, theme.muted, theme.base]
}

function packPalette(pack: Pack): RGBA4[] {
  const palette = pack.manifest.palette
  if (!palette || palette.length < 2) return []
  return palette.slice(0, MAX_STOPS).map((hex) => hexToRgba4(hex))
}

function hasSidecars(pack: Pack): boolean {
  return pack.frames.some((frame) => frame.colors !== null)
}

function sidecarColors(pack: Pack): RGBA4[] {
  const limit = 4096
  const frameCells = Math.max(0, pack.manifest.cols * pack.manifest.rows)
  const totalCells = Math.max(1, frameCells * Math.max(1, pack.frames.length))
  const stride = Math.max(1, Math.ceil(totalCells / (limit * 4)))
  const seen = new Set<number>()
  const colors: RGBA4[] = []
  for (const frame of pack.frames) {
    const data = frame.colors
    if (!data) continue
    const cells = Math.min(frameCells, Math.floor(data.length / 3))
    for (let index = 0; index < cells; index += stride) {
      const r = data[index * 3] ?? 0
      const g = data[index * 3 + 1] ?? 0
      const b = data[index * 3 + 2] ?? 0
      const key = (r << 16) | (g << 8) | b
      if (seen.has(key)) continue
      seen.add(key)
      colors.push([r, g, b, 255])
      if (colors.length >= limit) return colors
    }
  }
  return colors
}

function isLightTheme(theme: ThemeColors): boolean {
  return relativeLuminance(theme.background) > LIGHT_BACKGROUND_LUMINANCE
}

/**
 * Authored colors pass when a color already clears 2.2:1, or when blending it
 * toward the theme foreground by at most 25% reaches 3:1. Too many hard
 * failures mean the art was authored for a dark background.
 */
function passesLightContrast(pack: Pack, theme: ThemeColors): boolean {
  const colors = sidecarColors(pack)
  if (colors.length === 0) return true
  let failed = 0
  for (const color of colors) {
    if (contrastRatio(color, theme.background) >= LIGHT_CONTRAST_FLOOR) continue
    const adjusted = contrastAdjust(color, theme.base, theme.background, LIGHT_LIFT_TARGET, LIGHT_MAX_LIFT)
    if (!adjusted.reached) failed++
  }
  return failed / colors.length <= LIGHT_MAX_FAIL_SHARE
}

function fallbackStops(pack: Pack, capabilities: Capabilities, theme: ThemeColors): {
  effective: "palette" | "theme"
  stops: RGBA4[]
} {
  const palette = packPalette(pack)
  if (palette.length >= 2) {
    return { effective: "palette", stops: quantizeStops(palette, capabilities) }
  }
  return { effective: "theme", stops: quantizeStops(themeStops(theme), capabilities) }
}

function degraded(
  requested: StyleName,
  reason: string,
  pack: Pack,
  capabilities: Capabilities,
  theme: ThemeColors,
): ResolvedStyle {
  const fallback = fallbackStops(pack, capabilities, theme)
  return {
    requested,
    effective: fallback.effective,
    stops: fallback.stops,
    original: false,
    reason,
  }
}

/**
 * Resolves a requested style to what the terminal can actually show, in the
 * order from SPEC §5.1/§5.4. `reason` is always set when the request changes.
 */
export function resolveStyle(
  requested: StyleName,
  pack: Pack,
  capabilities: Capabilities,
  theme: ThemeColors,
): ResolvedStyle {
  if (!capabilities.color) {
    return {
      requested,
      effective: "mono",
      stops: [theme.faint],
      original: false,
      reason: requested === "mono" ? undefined : "no color support",
    }
  }

  if (requested === "mono") {
    return { requested, effective: "mono", stops: [theme.faint], original: false }
  }

  if (requested === "theme") {
    return {
      requested,
      effective: "theme",
      stops: quantizeStops(themeStops(theme), capabilities),
      original: false,
    }
  }

  if (requested === "palette") {
    const palette = packPalette(pack)
    const stops = palette.length >= 2 ? palette : themeStops(theme)
    return {
      requested,
      effective: "palette",
      stops: quantizeStops(stops, capabilities),
      original: false,
    }
  }

  // original
  if (!hasSidecars(pack)) {
    return degraded(requested, "no color sidecars", pack, capabilities, theme)
  }
  if (!capabilities.rgb && !capabilities.ansi256) {
    return degraded(requested, "terminal supports 16 colors", pack, capabilities, theme)
  }
  if (isLightTheme(theme) && !passesLightContrast(pack, theme)) {
    return degraded(requested, "colors adjusted for light theme", pack, capabilities, theme)
  }
  return { requested, effective: "original", stops: [], original: true }
}
