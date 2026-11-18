/**
 * Shared pack data model. Pure data: nothing here touches the filesystem or
 * the terminal, and nothing in a pack executes as code.
 */

export const SCHEMA_VERSION = 1

/** Hard caps from SPEC §4.6. The loader rejects, the CLI downscales. */
export const CAPS = {
  cols: 400,
  rows: 200,
  frames: 600,
  fps: 30,
  packBytes: 20 * 1024 * 1024,
  frameBytes: 1024 * 1024,
  paletteStops: 32,
  rampGlyphs: 64,
  effects: 4,
  uniqueColors: 4096,
  idLength: 32,
  nameLength: 80,
  descriptionLength: 500,
  authorLength: 80,
  licenseLength: 40,
  homepageLength: 200,
} as const

export type StyleName = "mono" | "theme" | "palette" | "original"

export const STYLE_NAMES: readonly StyleName[] = ["mono", "theme", "palette", "original"]

export type Scope = "project" | "user" | "bundled"

/** Row-major display grid. `chars` holds one BMP code unit per cell. */
export interface Grid {
  readonly cols: number
  readonly rows: number
  /** Length `cols * rows`, row-major. */
  readonly chars: string
  /** Length `cols * rows * 3` when present, row-major RGB. */
  readonly colors: Uint8Array | null
}

export type Frame = Grid

export interface Cell {
  readonly char: string
  readonly color: readonly [number, number, number] | null
}

export type RGB = readonly [number, number, number]

export type EffectType = "shimmer" | "wave" | "drift" | "twinkle" | "scanline"

export const EFFECT_TYPES: readonly EffectType[] = ["shimmer", "wave", "drift", "twinkle", "scanline"]

export interface EffectSpec {
  readonly type: EffectType
  readonly intensity?: number
  readonly speed?: number
  readonly seed?: number
  readonly axis?: "x" | "y"
}

export interface PackSource {
  readonly type?: string
  readonly file?: string
  readonly note?: string
}

/** Validated manifest, defaults applied. Unknown fields are dropped after warning. */
export interface Manifest {
  readonly schemaVersion: number
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly author?: string
  readonly license?: string
  readonly homepage?: string
  readonly fps: number
  readonly cols: number
  readonly rows: number
  readonly defaultStyle: StyleName
  readonly ramp: string
  readonly palette?: readonly string[]
  readonly frames?: string
  readonly canvas?: string
  readonly effects: readonly EffectSpec[]
  readonly source?: PackSource
}

export interface Pack {
  readonly id: string
  readonly dir: string
  readonly manifest: Manifest
  readonly kind: "frames" | "canvas"
  /** One entry for a canvas pack. */
  readonly frames: readonly Frame[]
  readonly warnings: readonly string[]
}

export type PackErrorCode =
  | "io"
  | "json"
  | "schema"
  | "id"
  | "field"
  | "cap"
  | "path"
  | "frames"
  | "frame"
  | "sidecar"
  | "effects"

export interface PackError {
  /** Pack-relative path, or the manifest name for manifest errors. */
  readonly file: string
  readonly line?: number
  readonly code: PackErrorCode
  readonly message: string
}

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

/** A discovered pack: manifest validated, frames not read yet. */
export interface PackCandidate {
  readonly id: string
  readonly dir: string
  readonly scope: Scope
  readonly manifest: Manifest
  readonly animated: boolean
  /** Sequence length, or 1 for a canvas pack. */
  readonly frameCount: number
  readonly warnings: readonly string[]
}

export interface PackProblem {
  readonly id: string
  readonly dir: string
  readonly scope: Scope
  readonly errors: readonly PackError[]
}

export interface PackIndex {
  /** Ordered by precedence: project, user, bundled; then id. */
  readonly candidates: readonly PackCandidate[]
  readonly problems: readonly PackProblem[]
}
