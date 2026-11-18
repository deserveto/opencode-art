import type { Grid, Pack, RGB, StyleName } from "../art/types.ts"

/** RGBA as 0–255 channels; keeps render logic free of host color objects. */
export type RGBA4 = readonly [number, number, number, number]

export interface FrameSize {
  readonly cols: number
  readonly rows: number
}

export interface Capabilities {
  readonly rgb: boolean
  readonly ansi256: boolean
  readonly unicode: boolean
  /** False for `NO_COLOR`, `TERM=dumb`, or a terminal with no color at all. */
  readonly color: boolean
}

export type Palette = readonly RGB[]

/** Minimal theme surface used by style resolution; filled from `context.theme`. */
export interface ThemeColors {
  readonly faint: RGBA4
  readonly muted: RGBA4
  readonly base: RGBA4
  readonly hue: RGBA4
  readonly background: RGBA4
}

/**
 * A resolved style is display-ready: the renderer only picks a stop by
 * brightness, or reads sidecar RGB in `original` mode.
 */
export interface ResolvedStyle {
  readonly requested: StyleName
  readonly effective: StyleName
  /** Set when the effective style differs from the requested one. */
  readonly reason?: string
  /** Brightness stops, low to high. Empty in `original` mode. */
  readonly stops: readonly RGBA4[]
  /** True when per-cell sidecar color should be used. */
  readonly original: boolean
}

/** A display grid plus its resolved style, ready for the renderable. */
export interface RenderFrame {
  readonly grid: Grid
  readonly style: ResolvedStyle
}
