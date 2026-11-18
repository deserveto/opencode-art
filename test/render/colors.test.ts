import assert from "node:assert/strict"
import test from "node:test"
import {
  ansi256ToRgba4,
  contrastAdjust,
  contrastRatio,
  hexToRgba4,
  nearestAnsi256,
  quantizeForCapability,
  relativeLuminance,
} from "../../src/render/colors.ts"
import { ANSI16_CAPS, ANSI256_CAPS, MONO_CAPS, RGB_CAPS } from "./fixtures.ts"

test("hexToRgba4 parses long, short, and invalid input", () => {
  assert.deepEqual(hexToRgba4("#ff8000"), [255, 128, 0, 255])
  assert.deepEqual(hexToRgba4("ff8000"), [255, 128, 0, 255])
  assert.deepEqual(hexToRgba4("#f80"), [255, 136, 0, 255])
  assert.deepEqual(hexToRgba4("#12345678"), [18, 52, 86, 255])
  assert.deepEqual(hexToRgba4("nope"), [0, 0, 0, 255])
  assert.deepEqual(hexToRgba4(""), [0, 0, 0, 255])
})

test("nearestAnsi256 finds exact cube and grayscale entries", () => {
  assert.equal(nearestAnsi256([255, 0, 0]), 196)
  assert.equal(nearestAnsi256([255, 255, 255]), 231)
  assert.equal(nearestAnsi256([0, 0, 0]), 16)
  assert.equal(nearestAnsi256([128, 128, 128]), 244)
})

test("ansi256ToRgba4 expands the xterm palette", () => {
  assert.deepEqual(ansi256ToRgba4(196), [255, 0, 0, 255])
  assert.deepEqual(ansi256ToRgba4(244), [128, 128, 128, 255])
  assert.deepEqual(ansi256ToRgba4(-5), ansi256ToRgba4(0))
  assert.deepEqual(ansi256ToRgba4(999), ansi256ToRgba4(255))
})

test("quantizeForCapability keeps truecolor and quantizes lower tiers", () => {
  const color: [number, number, number, number] = [255, 0, 0, 255]
  assert.deepEqual(quantizeForCapability(color, RGB_CAPS), color)

  const quantized256 = quantizeForCapability(color, ANSI256_CAPS)
  assert.deepEqual(quantized256, ansi256ToRgba4(nearestAnsi256(color)))

  const quantized16 = quantizeForCapability(color, ANSI16_CAPS)
  assert.deepEqual(quantized16, [255, 0, 0, 255])

  const mono = quantizeForCapability([12, 34, 56, 255], MONO_CAPS)
  assert.deepEqual(mono, [12, 34, 56, 255])
})

test("contrastRatio matches WCAG extremes", () => {
  assert.ok(Math.abs(contrastRatio([255, 255, 255, 255], [0, 0, 0, 255]) - 21) < 1e-9)
  assert.ok(Math.abs(contrastRatio([0, 0, 0, 255], [0, 0, 0, 255]) - 1) < 1e-9)
  assert.equal(relativeLuminance([255, 255, 255, 255]), 1)
  assert.equal(relativeLuminance([0, 0, 0, 255]), 0)
})

test("contrastAdjust leaves passing colors alone", () => {
  const result = contrastAdjust([255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255])
  assert.deepEqual(result.color, [255, 255, 255, 255])
  assert.equal(result.reached, true)
  assert.ok(result.ratio >= 3)
})

test("contrastAdjust lifts a low-contrast color toward the foreground", () => {
  const result = contrastAdjust([40, 40, 40, 255], [255, 255, 255, 255], [0, 0, 0, 255])
  assert.equal(result.reached, true)
  assert.ok(result.ratio >= 3)
  assert.ok(result.color[0] > 40)
})

test("contrastAdjust reports when the blend cap cannot reach the target", () => {
  const result = contrastAdjust([0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255])
  assert.equal(result.reached, false)
  assert.equal(result.ratio, 1)
  assert.deepEqual(result.color, [0, 0, 0, 255])
})
