import type { StyleName } from "../art/types.ts"

/**
 * One settings layer. Every field is optional so an unset field can fall
 * through to the next layer instead of freezing a default.
 */
export interface Settings {
  readonly version?: number
  readonly enabled?: boolean
  readonly pack?: string
  readonly style?: StyleName
  readonly fps?: number
}

export const SETTINGS_VERSION = 1

/** Plugin defaults; `null` means "defer to the pack, then to these". */
export const PLUGIN_DEFAULTS = {
  enabled: true,
  pack: "fool",
  style: "mono" satisfies StyleName as StyleName,
  fps: 10,
} as const

/** Merged view before pack defaults are applied. */
export interface EffectiveSettings {
  readonly enabled: boolean
  readonly pack: string | null
  readonly style: StyleName | null
  readonly fps: number | null
}

/** Merged view after pack defaults are applied. */
export interface ResolvedSettings {
  readonly enabled: boolean
  readonly pack: string | null
  readonly style: StyleName
  readonly fps: number
}

export interface SettingsStore {
  effective(): EffectiveSettings
  setEnabled(value: boolean): Promise<void>
  setPack(id: string): Promise<void>
  setStyle(style: StyleName): Promise<void>
  setFps(fps: number): Promise<void>
  /** Re-reads the project file. Invalid fields keep their previous value. */
  reload(): Promise<void>
  /** Absolute project settings path, for `/art help` and docs. */
  readonly projectPath: string
}
