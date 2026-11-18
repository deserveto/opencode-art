import assert from "node:assert/strict"
import test from "node:test"
import { resolveStyle } from "../../src/render/styles.ts"
import { nearestAnsi256, ansi256ToRgba4 } from "../../src/render/colors.ts"
import { makeGrid, makePack } from "./fixtures.ts"
import { ANSI16_CAPS, ANSI256_CAPS, DARK_THEME, LIGHT_THEME, MONO_CAPS, RGB_CAPS } from "./fixtures.ts"
const PALETTE = ["#111111", "#888888", "#ffffff"]
const SIDECAR_PACK = makePack({ palette: PALETTE, frames: [makeGrid([".:.", "=+="], [240, 240, 240])] })
const PLAIN_PACK = makePack({ palette: PALETTE })

test("mono uses the faint theme stop", () => {
  const style = resolveStyle("mono", PLAIN_PACK, RGB_CAPS, DARK_THEME)
  assert.equal(style.effective, "mono")
  assert.equal(style.original, false)
  assert.deepEqual(style.stops, [DARK_THEME.faint])
  assert.equal(style.reason, undefined)
})

test("theme maps brightness to faint, muted, base", () => {
  const style = resolveStyle("theme", PLAIN_PACK, RGB_CAPS, DARK_THEME)
  assert.equal(style.effective, "theme")
  assert.deepEqual(style.stops, [DARK_THEME.faint, DARK_THEME.muted, DARK_THEME.base])
  assert.equal(style.reason, undefined)
})

test("palette uses the pack palette", () => {
  const style = resolveStyle("palette", PLAIN_PACK, RGB_CAPS, DARK_THEME)
  assert.equal(style.effective, "palette")
  assert.deepEqual(style.stops, [
    [17, 17, 17, 255],
    [136, 136, 136, 255],
    [255, 255, 255, 255],
  ])
})

test("palette without a pack palette falls back to theme with a reason", () => {
  const style = resolveStyle("palette", makePack(), RGB_CAPS, DARK_THEME)
  assert.equal(style.effective, "theme")
  assert.deepEqual(style.stops, [DARK_THEME.faint, DARK_THEME.muted, DARK_THEME.base])
  assert.equal(style.reason, "pack has no palette")
})

test("no color capability always degrades to mono with a reason", () => {
  for (const requested of ["theme", "palette", "original"] as const) {
    const style = resolveStyle(requested, SIDECAR_PACK, MONO_CAPS, DARK_THEME)
    assert.equal(style.effective, "mono")
    assert.equal(style.original, false)
    assert.deepEqual(style.stops, [DARK_THEME.faint])
    assert.equal(typeof style.reason, "string")
    assert.ok((style.reason ?? "").length > 0)
  }
  const mono = resolveStyle("mono", SIDECAR_PACK, MONO_CAPS, DARK_THEME)
  assert.equal(mono.reason, undefined)
})

test("original is kept on truecolor when sidecars exist", () => {
  const style = resolveStyle("original", SIDECAR_PACK, RGB_CAPS, DARK_THEME)
  assert.equal(style.effective, "original")
  assert.equal(style.original, true)
  assert.deepEqual(style.stops, [])
  assert.equal(style.reason, undefined)
})

test("original stays original but quantized on a 256-color terminal", () => {
  const style = resolveStyle("original", SIDECAR_PACK, ANSI256_CAPS, DARK_THEME)
  assert.equal(style.effective, "original")
  assert.equal(style.original, true)
  assert.equal(style.reason, undefined)
})

test("original without sidecars falls back to palette", () => {
  const style = resolveStyle("original", PLAIN_PACK, RGB_CAPS, DARK_THEME)
  assert.equal(style.effective, "palette")
  assert.equal(style.original, false)
  assert.equal(typeof style.reason, "string")
})

test("original without sidecars or palette falls back to theme", () => {
  const style = resolveStyle("original", makePack(), RGB_CAPS, DARK_THEME)
  assert.equal(style.effective, "theme")
  assert.equal(typeof style.reason, "string")
})

test("original on a 16-color terminal falls back to palette", () => {
  const style = resolveStyle("original", SIDECAR_PACK, ANSI16_CAPS, DARK_THEME)
  assert.equal(style.effective, "palette")
  assert.equal(typeof style.reason, "string")
  assert.deepEqual(style.stops[0], [0, 0, 0, 255])
  assert.deepEqual(style.stops[2], [255, 255, 255, 255])
})

test("palette stops are quantized for 256 colors", () => {
  const style = resolveStyle("palette", PLAIN_PACK, ANSI256_CAPS, DARK_THEME)
  assert.deepEqual(style.stops[0], ansi256ToRgba4(nearestAnsi256([17, 17, 17])))
  assert.deepEqual(style.stops[1], ansi256ToRgba4(nearestAnsi256([136, 136, 136])))
})

test("theme stops are quantized for 16 colors", () => {
  const style = resolveStyle("theme", PLAIN_PACK, ANSI16_CAPS, DARK_THEME)
  const baseColors = new Set([
    "0,0,0",
    "128,0,0",
    "0,128,0",
    "128,128,0",
    "0,0,128",
    "128,0,128",
    "0,128,128",
    "192,192,192",
    "128,128,128",
    "255,0,0",
    "0,255,0",
    "255,255,0",
    "0,0,255",
    "255,0,255",
    "0,255,255",
    "255,255,255",
  ])
  assert.equal(style.stops.length, 3)
  for (const stop of style.stops) {
    assert.ok(baseColors.has(`${stop[0]},${stop[1]},${stop[2]}`))
  }
})

test("light theme keeps dark authored colors", () => {
  const pack = makePack({ palette: PALETTE, frames: [makeGrid(["##", "@@"], [20, 20, 20])] })
  const style = resolveStyle("original", pack, RGB_CAPS, LIGHT_THEME)
  assert.equal(style.effective, "original")
})

test("light theme accepts a slight lift within 25 percent", () => {
  const pack = makePack({ palette: PALETTE, frames: [makeGrid(["..", ".."], [180, 180, 180])] })
  const style = resolveStyle("original", pack, RGB_CAPS, LIGHT_THEME)
  assert.equal(style.effective, "original")
})

test("light theme falls back when authored colors cannot reach contrast", () => {
  const pack = makePack({ palette: PALETTE, frames: [makeGrid(["..", ".."], [240, 240, 240])] })
  const style = resolveStyle("original", pack, RGB_CAPS, LIGHT_THEME)
  assert.notEqual(style.effective, "original")
  assert.equal(style.effective, "palette")
  assert.match(style.reason ?? "", /colors adjusted for light theme/)
})

test("a reason is present exactly when the effective style differs", () => {
  const changed = resolveStyle("theme", PLAIN_PACK, MONO_CAPS, DARK_THEME)
  assert.notEqual(changed.effective, changed.requested)
  assert.ok(changed.reason)

  const same = resolveStyle("palette", PLAIN_PACK, RGB_CAPS, DARK_THEME)
  assert.equal(same.effective, same.requested)
  assert.equal(same.reason, undefined)
})
