import assert from "node:assert/strict"
import test from "node:test"
import * as render from "../../src/render/index.ts"

test("render barrel exposes the public API", () => {
  assert.equal(typeof render.fitGrid, "function")
  assert.equal(typeof render.brightnessAt, "function")
  assert.equal(typeof render.resolveStyle, "function")
  assert.equal(typeof render.detectCapabilities, "function")
  assert.equal(typeof render.Player, "function")
  assert.equal(typeof render.ArtRenderable, "function")
  assert.equal(typeof render.applyEffects, "function")
  assert.equal(typeof render.hexToRgba4, "function")
  assert.equal(typeof render.nearestAnsi256, "function")
  assert.equal(typeof render.quantizeForCapability, "function")
  assert.equal(typeof render.contrastAdjust, "function")
})
