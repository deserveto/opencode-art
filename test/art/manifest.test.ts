import assert from "node:assert/strict"
import test from "node:test"
import { FIT_MODES, parseManifest } from "../../src/art/index.ts"
import { isPrintableText } from "../../src/art/manifest.ts"

const base: Record<string, unknown> = {
  schemaVersion: 1,
  id: "tiny",
  name: "Tiny",
  fps: 10,
  cols: 4,
  rows: 2,
  canvas: "canvas.txt",
}

const run = (overrides: Record<string, unknown> = {}, folder = "tiny") =>
  parseManifest({ ...base, ...overrides }, folder)

const messages = (errors: readonly { message: string }[]): string => errors.map((entry) => entry.message).join("\n")

test("minimal manifest is valid and applies defaults", () => {
  const result = run()
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
  assert.ok(result.manifest)
  assert.equal(result.manifest.defaultStyle, "mono")
  assert.equal(result.manifest.id, "tiny")
  assert.equal(result.manifest.schemaVersion, 1)
  assert.ok(result.manifest.ramp.length >= 2)
  assert.deepEqual(result.manifest.effects, [])
})

test("a non-object manifest is rejected", () => {
  assert.match(messages(parseManifest([], "tiny").errors), /JSON object/)
  assert.match(messages(parseManifest("nope", "tiny").errors), /JSON object/)
  assert.match(messages(parseManifest(null, "tiny").errors), /JSON object/)
})

test("schemaVersion must be exactly 1", () => {
  assert.match(messages(run({ schemaVersion: undefined }).errors), /schemaVersion/)
  assert.match(messages(run({ schemaVersion: 0 }).errors), /schemaVersion/)
  assert.match(messages(run({ schemaVersion: 1.5 }).errors), /schemaVersion/)
  assert.match(messages(run({ schemaVersion: "1" }).errors), /schemaVersion/)
})

test("a future schemaVersion asks the user to update the plugin", () => {
  assert.match(messages(run({ schemaVersion: 2 }).errors), /requires a newer opencode-art; update the plugin/)
  assert.match(messages(run({ schemaVersion: 7 }).errors), /newer opencode-art/)
})

test("id is required, lowercase, and must equal the folder name", () => {
  assert.match(messages(run({ id: undefined }).errors), /"id"/)
  assert.match(messages(run({ id: "Tiny" }).errors), /"id"/)
  assert.match(messages(run({ id: "-tiny" }).errors), /"id"/)
  assert.match(messages(run({ id: "tiny", }, "other").errors), /does not match the folder name "other"/)
  assert.match(messages(run({ id: "a".repeat(33) }).errors), /"id"/)
  assert.deepEqual(run({ id: "a".repeat(32) }, "a".repeat(32)).errors, [])
})

test("name is required, 1-80 printable characters", () => {
  assert.match(messages(run({ name: undefined }).errors), /"name"/)
  assert.match(messages(run({ name: "" }).errors), /"name"/)
  assert.match(messages(run({ name: "n".repeat(81) }).errors), /"name"/)
  assert.match(messages(run({ name: "bad\u0007name" }).errors), /printable/)
  assert.deepEqual(run({ name: "n".repeat(80) }).errors, [])
})

test("optional text fields have length and printability caps", () => {
  assert.match(messages(run({ description: "d".repeat(501) }).errors), /description/)
  assert.match(messages(run({ description: "line\nbreak" }).errors), /printable/)
  assert.match(messages(run({ author: "a".repeat(81) }).errors), /author/)
  assert.match(messages(run({ license: "l".repeat(41) }).errors), /license/)
  assert.match(messages(run({ description: 5 }).errors), /"description": must be a string/)
  assert.deepEqual(
    run({ description: "d".repeat(500), author: "a".repeat(80), license: "l".repeat(40) }).errors,
    [],
  )
})

test("homepage must be a short https:// URL", () => {
  assert.match(messages(run({ homepage: "http://example.com" }).errors), /https/)
  assert.match(messages(run({ homepage: "example.com" }).errors), /https/)
  assert.match(messages(run({ homepage: `https://example.com/${"x".repeat(190)}` }).errors), /homepage/)
  assert.match(messages(run({ homepage: 3 }).errors), /homepage/)
  assert.deepEqual(run({ homepage: "https://example.com/art" }).errors, [])
})

test("fps is a finite number from 1 to 30", () => {
  assert.match(messages(run({ fps: 0 }).errors), /"fps"/)
  assert.match(messages(run({ fps: 31 }).errors), /"fps"/)
  assert.match(messages(run({ fps: "10" }).errors), /"fps"/)
  assert.deepEqual(run({ fps: 1.5 }).errors, [])
  assert.deepEqual(run({ fps: 30 }).errors, [])
})

test("cols and rows are integers within their caps", () => {
  assert.match(messages(run({ cols: 0 }).errors), /"cols"/)
  assert.match(messages(run({ cols: 401 }).errors), /"cols"/)
  assert.match(messages(run({ cols: 2.5 }).errors), /"cols"/)
  assert.match(messages(run({ cols: "4" }).errors), /"cols"/)
  assert.match(messages(run({ rows: 0 }).errors), /"rows"/)
  assert.match(messages(run({ rows: 201 }).errors), /"rows"/)
  assert.deepEqual(run({ cols: 400, rows: 200 }).errors, [])
})

test("defaultStyle is a known style and defaults to mono", () => {
  assert.match(messages(run({ defaultStyle: "fancy" }).errors), /defaultStyle/)
  assert.equal(run({ defaultStyle: "palette" }).manifest?.defaultStyle, "palette")
  assert.equal(run({ defaultStyle: "original" }).manifest?.defaultStyle, "original")
  assert.equal(run({ defaultStyle: undefined }).manifest?.defaultStyle, "mono")
})

test("ramp needs 2-64 unique width-1 glyphs", () => {
  assert.match(messages(run({ ramp: "x" }).errors), /ramp/)
  assert.match(messages(run({ ramp: "x".repeat(65) }).errors), /ramp/)
  assert.match(messages(run({ ramp: "abca" }).errors), /duplicated/)
  assert.match(messages(run({ ramp: "a\u{1F600}" }).errors), /width-1/)
  assert.match(messages(run({ ramp: "a\tb" }).errors), /width-1/)
  assert.deepEqual(run({ ramp: " .:-=+*#%@" }).errors, [])
  assert.equal(run({ ramp: " .:-=+*#%@" }).manifest?.ramp, " .:-=+*#%@")
})

test("palette needs 2-32 #rrggbb stops", () => {
  assert.match(messages(run({ palette: ["#000000"] }).errors), /palette/)
  assert.match(messages(run({ palette: Array.from({ length: 33 }, () => "#000000") }).errors), /palette/)
  assert.match(messages(run({ palette: ["#000000", "blue"] }).errors), /#rrggbb/)
  assert.match(messages(run({ palette: ["#000000", "#fff"] }).errors), /#rrggbb/)
  assert.match(messages(run({ palette: "#000000" }).errors), /palette/)
  assert.deepEqual(run({ palette: ["#000000", "#AABBCC"] }).errors, [])
})

test("exactly one of frames and canvas is required", () => {
  assert.match(messages(run({ frames: "frames" }).errors), /exactly one/)
  assert.match(messages(run({ canvas: undefined }).errors), /exactly one/)
})

test("canvas must point at a .txt file", () => {
  assert.match(messages(run({ canvas: "canvas.png" }).errors), /\.txt/)
  assert.match(messages(run({ canvas: "" }).errors), /canvas/)
  assert.match(messages(run({ canvas: 7 }).errors), /canvas/)
})

test("effects are forbidden with frames", () => {
  const result = run({ canvas: undefined, frames: "frames", effects: [{ type: "shimmer", intensity: 0.2 }] })
  assert.match(messages(result.errors), /only valid with "canvas"/)
})

test("effects are capped at four", () => {
  const effects = Array.from({ length: 5 }, () => ({ type: "shimmer" }))
  assert.match(messages(run({ effects }).errors), /at most 4|effects/)
})

test("effect types are known and parameters are in range", () => {
  assert.match(messages(run({ effects: [{ type: "zoom" }] }).errors), /effects\[0\]\.type/)
  assert.match(messages(run({ effects: [{}] }).errors), /effects\[0\]\.type/)
  assert.match(messages(run({ effects: ["shimmer"] }).errors), /effects\[0\]/)
  assert.match(messages(run({ effects: [{ type: "wave", intensity: 1.1 }] }).errors), /intensity/)
  assert.match(messages(run({ effects: [{ type: "wave", intensity: -0.1 }] }).errors), /intensity/)
  assert.match(messages(run({ effects: [{ type: "wave", intensity: "x" }] }).errors), /intensity/)
  assert.match(messages(run({ effects: [{ type: "wave", speed: 4.1 }] }).errors), /speed/)
  assert.match(messages(run({ effects: [{ type: "wave", axis: "z" }] }).errors), /axis/)
  assert.match(messages(run({ effects: [{ type: "shimmer", seed: 1.5 }] }).errors), /seed/)
  assert.match(messages(run({ effects: "shimmer" }).errors), /effects/)
})

test("a fully specified effect is preserved", () => {
  const effect = { type: "drift", intensity: 0.75, speed: 2, seed: 3, axis: "y" }
  const result = run({ effects: [effect] })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.manifest?.effects, [effect])
})

test("unknown top-level fields warn but do not reject", () => {
  const result = run({ mystery: true, another: { deep: 1 } })
  assert.deepEqual(result.errors, [])
  assert.equal(result.warnings.length, 2)
  assert.match(result.warnings.join("\n"), /unknown field "mystery"/)
  assert.ok(result.manifest)
  assert.equal("mystery" in result.manifest, false)
})

test("source is accepted, string fields kept, unknown subfields ignored", () => {
  const stringSource = run({ source: "baked" })
  assert.deepEqual(stringSource.errors, [])
  assert.equal(stringSource.manifest?.source, undefined)

  const objectSource = run({ source: { type: "scene", file: "scene.mjs", extra: 1 } })
  assert.deepEqual(objectSource.errors, [])
  assert.deepEqual(objectSource.manifest?.source, { type: "scene", file: "scene.mjs" })
})

test("fit is omitted when unspecified and validated against FIT_MODES when set", () => {
  const omitted = run()
  assert.deepEqual(omitted.errors, [])
  assert.ok(omitted.manifest)
  assert.equal("fit" in omitted.manifest, false)

  for (const fit of FIT_MODES) {
    const result = run({ fit })
    assert.deepEqual(result.errors, [], fit)
    assert.equal(result.manifest?.fit, fit)
  }

  const invalid = run({ fit: "fill" })
  assert.match(messages(invalid.errors), /"fit": must be one of stretch, contain, cover, center/)
  const nonString = run({ fit: 42 })
  assert.match(messages(nonString.errors), /"fit": must be one of stretch, contain, cover, center/)
})

test("unknown fields inside effects emit warnings and are dropped", () => {
  const result = run({
    effects: [{ type: "shimmer", intensity: 0.4, bogus: true, extraDepth: 3 }],
  })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.manifest?.effects, [{ type: "shimmer", intensity: 0.4 }])
  assert.deepEqual(result.warnings, [
    'art.json: unknown field "effects[0].bogus" ignored',
    'art.json: unknown field "effects[0].extraDepth" ignored',
  ])
})

test("isPrintableText rejects bidi overrides, format characters, and line separators", () => {
  assert.equal(isPrintableText("CC-BY-4.0 — valid text"), true)
  for (const bad of [
    "bad\u202Eoverride",
    "zero\u200Bwidth",
    "rtl\u200Fmark",
    "isolate\u2066text",
    "bom\uFEFFchar",
    "line\u2028sep",
    "para\u2029sep",
    "ctrl\u0007bell",
    "del\u007fchar",
    "c1\u009bcsi",
  ]) {
    assert.equal(isPrintableText(bad), false, JSON.stringify(bad))
  }
})

test("license and other text fields reject bidi overrides and non-printable characters", () => {
  assert.match(messages(run({ license: "MIT\u202Etxt" }).errors), /"license": must contain printable/)
  assert.match(messages(run({ license: "MIT\nApache" }).errors), /"license": must contain printable/)
  assert.match(messages(run({ license: "MIT\u2028" }).errors), /"license": must contain printable/)
  assert.match(messages(run({ name: "art\u202E" }).errors), /"name": must contain printable/)
  assert.match(messages(run({ description: "a\u2029b" }).errors), /"description": must contain printable/)
  assert.match(messages(run({ author: "a\u200Bb" }).errors), /"author": must contain printable/)
})
