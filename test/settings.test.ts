import assert from "node:assert/strict"
import test from "node:test"
import {
  createSettingsStore,
  mergeLayers,
  parseSettings,
  resolveSettings,
  SETTINGS_VERSION,
  PLUGIN_DEFAULTS,
} from "../src/settings/index.ts"
import type { Settings } from "../src/settings/index.ts"

test("parseSettings keeps valid fields and drops invalid ones individually", () => {
  const parsed = parseSettings({
    version: 1,
    enabled: true,
    pack: "rainy-city",
    style: "palette",
    fps: 12,
    extra: "preserved on disk",
  })
  assert.deepEqual(parsed.warnings, [])
  assert.equal(parsed.settings.enabled, true)
  assert.equal(parsed.settings.pack, "rainy-city")
  assert.equal(parsed.settings.style, "palette")
  assert.equal(parsed.settings.fps, 12)
  assert.equal("extra" in parsed.settings, false)
})

test("parseSettings reports each bad field without wiping the rest", () => {
  const parsed = parseSettings({ enabled: "yes", pack: "../escape", style: "neon", fps: 99 })
  assert.equal(parsed.settings.enabled, undefined)
  assert.equal(parsed.settings.pack, undefined)
  assert.equal(parsed.settings.style, undefined)
  assert.equal(parsed.settings.fps, undefined)
  assert.equal(parsed.warnings.length, 4)
})

test("parseSettings ignores a newer settings version entirely", () => {
  const parsed = parseSettings({ version: 2, enabled: false, pack: "fool" })
  assert.deepEqual(parsed.settings, {})
  assert.equal(parsed.warnings.length, 1)
})

test("parseSettings tolerates non-objects", () => {
  assert.equal(parseSettings(null).warnings.length, 1)
  assert.equal(parseSettings("nope").settings.version, undefined)
})

test("mergeLayers gives project precedence over global and defaults", () => {
  assert.deepEqual(mergeLayers({ enabled: false, pack: "p" }, { enabled: true, pack: "g", fps: 20 }), {
    enabled: false,
    pack: "p",
    style: null,
    fps: 20,
  })
  assert.deepEqual(mergeLayers({}, {}), {
    enabled: PLUGIN_DEFAULTS.enabled,
    pack: PLUGIN_DEFAULTS.pack,
    style: null,
    fps: null,
  })
})

test("resolveSettings falls back to pack defaults then plugin defaults", () => {
  const settings = resolveSettings({ enabled: true, pack: "logo", style: null, fps: null }, { style: "palette", fps: 8 })
  assert.equal(settings.style, "palette")
  assert.equal(settings.fps, 8)
  assert.equal(settings.pack, "logo")
})

test("a failed global write keeps the value in memory and reports once", async () => {
  let global: Settings = { version: SETTINGS_VERSION }
  const errors: string[] = []
  const store = createSettingsStore(
    {
      readGlobal: () => global,
      updateGlobal: async () => {
        throw new Error("disk full")
      },
      projectPath: "/nowhere/art.json",
      onError: (message) => errors.push(message),
    },
    {},
  )
  await store.setEnabled(false)
  assert.equal(store.effective().enabled, false)
  assert.equal(errors.length, 1)
  assert.match(errors[0] ?? "", /disk full/)
})

test("a successful global write is visible through readGlobal and project still wins", async () => {
  const global: Settings = { version: SETTINGS_VERSION }
  const store = createSettingsStore(
    {
      readGlobal: () => global,
      updateGlobal: async (mutation) => {
        const draft = { ...global, version: SETTINGS_VERSION } as {
          version: number
          enabled?: boolean
          pack?: string
          style?: Settings["style"]
          fps?: number
        }
        mutation(draft)
        Object.assign(global, draft)
      },
      projectPath: "/nowhere/art.json",
      onError: () => {},
    },
    { enabled: false },
  )
  await store.setPack("fool")
  assert.equal(store.effective().pack, "fool")
  assert.equal(store.effective().enabled, false)
})

test("a live-synced global change is visible after a successful write", async () => {
  const global: {
    version: number
    enabled?: boolean
    pack?: string
    style?: Settings["style"]
    fps?: number
  } = { version: SETTINGS_VERSION }
  const store = createSettingsStore(
    {
      readGlobal: () => global,
      updateGlobal: async (mutation) => {
        const draft = { ...global, version: SETTINGS_VERSION } as {
          version: number
          enabled?: boolean
          pack?: string
          style?: Settings["style"]
          fps?: number
        }
        mutation(draft)
        Object.assign(global, draft)
      },
      projectPath: "/nowhere/art.json",
      onError: () => {},
    },
    {},
  )
  await store.setFps(5)
  assert.equal(store.effective().fps, 5)
  global.fps = 12
  assert.equal(store.effective().fps, 12)

  const invalid: Settings = { version: SETTINGS_VERSION, enabled: "yes" as unknown as boolean, fps: 999 }
  const sanitized = createSettingsStore(
    {
      readGlobal: () => invalid,
      updateGlobal: async () => {},
      projectPath: "/nowhere/art.json",
      onError: () => {},
    },
    {},
  )
  assert.equal(sanitized.effective().enabled, true)
  assert.equal(sanitized.effective().fps, null)
})

test("parseSettings validates dim as an integer from 0 to 80", () => {
  const validZero = parseSettings({ dim: 0 })
  assert.deepEqual(validZero.warnings, [])
  assert.equal(validZero.settings.dim, 0)

  const validMax = parseSettings({ dim: 80 })
  assert.deepEqual(validMax.warnings, [])
  assert.equal(validMax.settings.dim, 80)

  for (const bad of [-1, 81, 12.5, "40", null, Number.NaN]) {
    const parsed = parseSettings({ dim: bad, fps: 10 })
    assert.equal(parsed.settings.dim, undefined)
    assert.equal(parsed.settings.fps, 10)
    assert.deepEqual(parsed.warnings, ["dim must be an integer from 0 to 80"])
  }
})

test("mergeLayers handles dim precedence without changing unset shape", () => {
  assert.equal("dim" in mergeLayers({}, {}), false)
  assert.deepEqual(mergeLayers({ dim: 0 }, { dim: 50 }), {
    enabled: PLUGIN_DEFAULTS.enabled,
    pack: PLUGIN_DEFAULTS.pack,
    style: null,
    fps: null,
    dim: 0,
  })
  assert.deepEqual(mergeLayers({}, { dim: 35 }), {
    enabled: PLUGIN_DEFAULTS.enabled,
    pack: PLUGIN_DEFAULTS.pack,
    style: null,
    fps: null,
    dim: 35,
  })
})

test("createSettingsStore persists setDim and exposes project() layer", async () => {
  const global: {
    version: number
    enabled?: boolean
    pack?: string
    style?: Settings["style"]
    fps?: number
    dim?: number
  } = { version: SETTINGS_VERSION }
  const store = createSettingsStore(
    {
      readGlobal: () => global,
      updateGlobal: async (mutation) => {
        const draft = { ...global, version: SETTINGS_VERSION }
        mutation(draft)
        Object.assign(global, draft)
      },
      projectPath: "/nowhere/art.json",
      onError: () => {},
    },
    { pack: "pinned", dim: 25 },
  )
  assert.deepEqual(store.project(), { pack: "pinned", dim: 25 })
  await store.setDim(60)
  assert.equal(global.dim, 60)
  assert.equal(store.effective().dim, 25)
  assert.equal(store.project().dim, 25)
})
