import assert from "node:assert/strict"
import test from "node:test"
import { detectCapabilities } from "../../src/render/capabilities.ts"

test("host capabilities win over the environment", () => {
  const caps = detectCapabilities({ rgb: true, ansi256: true, unicode: true }, {})
  assert.deepEqual(caps, { rgb: true, ansi256: true, unicode: true, color: true })

  const sixteen = detectCapabilities({ rgb: false, ansi256: false }, {})
  assert.deepEqual(sixteen, { rgb: false, ansi256: false, unicode: true, color: true })
})

test("NO_COLOR always forces mono", () => {
  const caps = detectCapabilities({ rgb: true, ansi256: true }, { NO_COLOR: "1" })
  assert.equal(caps.color, false)
  assert.equal(caps.rgb, false)
  assert.equal(caps.ansi256, false)
})

test("an empty NO_COLOR does not disable color", () => {
  const caps = detectCapabilities(undefined, { TERM: "xterm-256color", NO_COLOR: "" })
  assert.equal(caps.color, true)
})

test("TERM=dumb forces mono and no unicode", () => {
  const caps = detectCapabilities(undefined, { TERM: "dumb", COLORTERM: "truecolor" })
  assert.deepEqual(caps, { rgb: false, ansi256: false, unicode: false, color: false })
})

test("COLORTERM detects truecolor", () => {
  const caps = detectCapabilities(undefined, { TERM: "xterm", COLORTERM: "24bit" })
  assert.deepEqual(caps, { rgb: true, ansi256: true, unicode: true, color: true })
})

test("TERM detects 256 colors", () => {
  const caps = detectCapabilities(undefined, { TERM: "xterm-256color" })
  assert.deepEqual(caps, { rgb: false, ansi256: true, unicode: true, color: true })
})

test("a plain TERM means 16 colors", () => {
  const caps = detectCapabilities(undefined, { TERM: "xterm" })
  assert.deepEqual(caps, { rgb: false, ansi256: false, unicode: true, color: true })
})

test("no host capabilities and no environment means no color", () => {
  const caps = detectCapabilities(undefined, {})
  assert.deepEqual(caps, { rgb: false, ansi256: false, unicode: true, color: false })
})

test("unicode can be disabled explicitly", () => {
  const caps = detectCapabilities({ rgb: true, unicode: false }, {})
  assert.equal(caps.unicode, false)
})
