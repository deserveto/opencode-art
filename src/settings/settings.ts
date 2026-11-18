import { readFile } from "node:fs/promises"
import path from "node:path"
import { PACK_ID_PATTERN, type StyleName, STYLE_NAMES } from "../art/types.ts"
import {
  PLUGIN_DEFAULTS,
  SETTINGS_VERSION,
  type EffectiveSettings,
  type ResolvedSettings,
  type Settings,
  type SettingsStore,
  type StorageSettings,
} from "./types.ts"

export const PROJECT_SETTINGS = path.join(".opencode", "art.json")

export function projectSettingsPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_SETTINGS)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStyle(value: unknown): value is StyleName {
  return typeof value === "string" && (STYLE_NAMES as readonly string[]).includes(value)
}

export interface ParsedSettings {
  readonly settings: Settings
  readonly warnings: readonly string[]
}

/**
 * Validates one settings layer field by field. Invalid fields are dropped
 * individually so one typo cannot wipe the rest of the file.
 */
export function parseSettings(raw: unknown): ParsedSettings {
  const warnings: string[] = []
  if (!isRecord(raw)) return { settings: {}, warnings: ["settings must be a JSON object"] }

  if (typeof raw.version === "number" && raw.version !== SETTINGS_VERSION) {
    return {
      settings: {},
      warnings: [
        `settings version ${raw.version} is not supported (expected ${SETTINGS_VERSION}); ignoring the file`,
      ],
    }
  }

  const settings: {
    version?: number
    enabled?: boolean
    pack?: string
    style?: StyleName
    fps?: number
  } = { version: SETTINGS_VERSION }

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled === "boolean") settings.enabled = raw.enabled
    else warnings.push("enabled must be true or false")
  }
  if (raw.pack !== undefined) {
    if (typeof raw.pack === "string" && PACK_ID_PATTERN.test(raw.pack)) settings.pack = raw.pack
    else warnings.push("pack must be a pack id (a-z, 0-9, _ or -)")
  }
  if (raw.style !== undefined) {
    if (isStyle(raw.style)) settings.style = raw.style
    else warnings.push(`style must be one of ${STYLE_NAMES.join(", ")}`)
  }
  if (raw.fps !== undefined) {
    if (typeof raw.fps === "number" && Number.isInteger(raw.fps) && raw.fps >= 1 && raw.fps <= 30) {
      settings.fps = raw.fps
    } else warnings.push("fps must be an integer from 1 to 30")
  }

  return { settings, warnings }
}

export async function readProjectSettings(file: string): Promise<ParsedSettings> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return { settings: {}, warnings: [] }
    return { settings: {}, warnings: [`could not read ${file}: ${message(error)}`] }
  }
  try {
    return parseSettings(JSON.parse(text))
  } catch (error) {
    return { settings: {}, warnings: [`${file} is not valid JSON: ${message(error)}`] }
  }
}

export function mergeLayers(project: Settings, global: Settings): EffectiveSettings {
  return {
    enabled: project.enabled ?? global.enabled ?? PLUGIN_DEFAULTS.enabled,
    pack: project.pack ?? global.pack ?? PLUGIN_DEFAULTS.pack,
    style: project.style ?? global.style ?? null,
    fps: project.fps ?? global.fps ?? null,
  }
}

export function resolveSettings(effective: EffectiveSettings, packDefaults?: { style: StyleName; fps: number }): ResolvedSettings {
  return {
    enabled: effective.enabled,
    pack: effective.pack,
    style: effective.style ?? packDefaults?.style ?? PLUGIN_DEFAULTS.style,
    fps: effective.fps ?? packDefaults?.fps ?? PLUGIN_DEFAULTS.fps,
  }
}

export interface SettingsHost {
  readonly readGlobal: () => Settings
  readonly updateGlobal: (mutation: (draft: StorageSettings) => void) => Promise<void>
  readonly projectPath: string
  readonly onError: (message: string) => void
}

export function createSettingsStore(host: SettingsHost, initialProject: Settings): SettingsStore {
  let project = initialProject
  // Applies even when the durable write fails, so the session keeps the choice.
  let pending: Settings = {}

  function globalValue(): Settings {
    // A foreign or older TUI can write invalid values; sanitize on read.
    const parsed = parseSettings(host.readGlobal())
    for (const warning of parsed.warnings) host.onError(warning)
    return { ...parsed.settings, ...pending }
  }

  function clearPending(field: keyof Settings, value: unknown): void {
    if (pending[field] !== value) return
    const next: Record<string, unknown> = { ...pending }
    delete next[field]
    pending = next as Settings
  }

  function effective(): EffectiveSettings {
    return mergeLayers(project, globalValue())
  }

  async function write(mutation: (draft: StorageSettings) => void): Promise<boolean> {
    try {
      await host.updateGlobal(mutation)
      return true
    } catch (error) {
      host.onError(`Could not save settings: ${message(error)}`)
      return false
    }
  }

  return {
    effective,
    projectPath: host.projectPath,
    async reload() {
      const parsed = await readProjectSettings(host.projectPath)
      project = parsed.settings
      for (const warning of parsed.warnings) host.onError(warning)
    },
    async setEnabled(value) {
      pending = { ...pending, enabled: value }
      const ok = await write((draft) => {
        draft.version = SETTINGS_VERSION
        draft.enabled = value
      })
      if (ok) clearPending("enabled", value)
    },
    async setPack(id) {
      pending = { ...pending, pack: id }
      const ok = await write((draft) => {
        draft.version = SETTINGS_VERSION
        draft.pack = id
      })
      if (ok) clearPending("pack", id)
    },
    async setStyle(style) {
      pending = { ...pending, style }
      const ok = await write((draft) => {
        draft.version = SETTINGS_VERSION
        draft.style = style
      })
      if (ok) clearPending("style", style)
    },
    async setFps(fps) {
      pending = { ...pending, fps }
      const ok = await write((draft) => {
        draft.version = SETTINGS_VERSION
        draft.fps = fps
      })
      if (ok) clearPending("fps", fps)
    },
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
