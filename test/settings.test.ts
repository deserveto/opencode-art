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
