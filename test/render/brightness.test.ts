import assert from "node:assert/strict"
import test from "node:test"
import { brightnessAt, densityBucket, glyphBrightness } from "../../src/render/brightness.ts"
import { makeGrid } from "./fixtures.ts"

const RAMP = " .:-=+*#%@"

test("ramp rank defines brightness", () => {
  assert.equal(glyphBrightness(" ", RAMP), 0)
  assert.equal(glyphBrightness(".", RAMP), 1 / 9)
  assert.equal(glyphBrightness(":", RAMP), 2 / 9)
  assert.equal(glyphBrightness("@", RAMP), 1)
  assert.equal(glyphBrightness("+", RAMP), 5 / 9)
})

test("space is 0 even when a ramp orders it differently", () => {
  assert.equal(glyphBrightness(" ", ".@"), 0)
})

test("glyphs outside the ramp fall back to the density table", () => {
  assert.equal(glyphBrightness("A", RAMP), 0.6)
  assert.equal(glyphBrightness("|", RAMP), 0.33)
  assert.equal(glyphBrightness("\u0416", RAMP), 0.5)
})

test("brightnessAt reads the grid and clamps out-of-bounds to 0.5", () => {
  const grid = makeGrid([".@", " #"])
  assert.equal(brightnessAt(grid, RAMP, 0, 0), 1 / 9)
  assert.equal(brightnessAt(grid, RAMP, 1, 0), 1)
  assert.equal(brightnessAt(grid, RAMP, 1, 1), 7 / 9)
  assert.equal(brightnessAt(grid, RAMP, -1, 0), 0.5)
  assert.equal(brightnessAt(grid, RAMP, 2, 0), 0.5)
})

test("density buckets coarsen brightness", () => {
  assert.equal(densityBucket(0), 0)
  assert.equal(densityBucket(0.24), 0)
  assert.equal(densityBucket(0.25), 1)
  assert.equal(densityBucket(0.5), 2)
  assert.equal(densityBucket(1), 3)
  assert.equal(densityBucket(Number.NaN), 2)
})
