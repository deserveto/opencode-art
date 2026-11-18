import assert from "node:assert/strict"
import test from "node:test"
import { parseArtCommand } from "../src/commands/parse.ts"

test("bare /art opens the dialog", () => {
  assert.deepEqual(parseArtCommand(undefined), { kind: "dialog" })
  assert.deepEqual(parseArtCommand("   "), { kind: "dialog" })
})

test("toggles and actions parse case-insensitively", () => {
  assert.deepEqual(parseArtCommand("ON"), { kind: "on" })
  assert.deepEqual(parseArtCommand("off"), { kind: "off" })
  assert.deepEqual(parseArtCommand("toggle"), { kind: "toggle" })
  assert.deepEqual(parseArtCommand("next"), { kind: "next" })
  assert.deepEqual(parseArtCommand("reload"), { kind: "reload" })
  assert.deepEqual(parseArtCommand("help"), { kind: "help" })
})

test("arguments are captured for set, style, fps, validate", () => {
  assert.deepEqual(parseArtCommand("set rainy-city"), { kind: "set", id: "rainy-city" })
  assert.deepEqual(parseArtCommand("style ORIGINAL"), { kind: "style", style: "original" })
  assert.deepEqual(parseArtCommand("fps 12"), { kind: "fps", value: "12" })
  assert.deepEqual(parseArtCommand("validate ./examples/logo"), { kind: "validate", target: "./examples/logo" })
  assert.deepEqual(parseArtCommand("validate"), { kind: "validate", target: undefined })
})

test("missing arguments stay undefined so the caller can show usage", () => {
  assert.deepEqual(parseArtCommand("set"), { kind: "set", id: undefined })
  assert.deepEqual(parseArtCommand("style"), { kind: "style", style: undefined })
  assert.deepEqual(parseArtCommand("fps"), { kind: "fps", value: undefined })
})

test("unknown subcommands are reported, not guessed", () => {
  assert.deepEqual(parseArtCommand("dance"), { kind: "unknown", input: "dance" })
})
