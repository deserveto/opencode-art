import assert from "node:assert/strict"
import test from "node:test"
import { clamp, drift, lerp, loadCanvas, noise, shimmer, scanline, twinkle, wave, type SceneGrid } from "../../src/scene/index.ts"

function grid(): SceneGrid {
  return {
    chars: ["..........", ".########.", ".########.", ".........."],
    colors: [
      [null, null, null, null, null, null, null, null, null, null],
      [null, "#ff0000", "#ff0000", "#00ff00", "#00ff00", "#0000ff", "#0000ff", "#ffff00", "#ffff00", null],
      [null, "#ff0000", "#ff0000", "#00ff00", "#00ff00", "#0000ff", "#0000ff", "#ffff00", "#ffff00", null],
      [null, null, null, null, null, null, null, null, null, null],
    ],
  }
}

function dims(value: SceneGrid): string {
  const widths = new Set(value.chars.map((line) => line.length))
  return `${value.chars.length}x${[...widths].join(",")}`
}

test("clamp and lerp", () => {
  assert.equal(clamp(-1), 0)
  assert.equal(clamp(2), 1)
  assert.equal(clamp(0.5, 0, 0.4), 0.4)
  assert.equal(lerp(10, 20, 0.25), 12.5)
})

test("noise is deterministic and in range", () => {
  const first = noise(7)
  const second = noise(7)
  for (let index = 0; index < 50; index++) {
    const value = first(index)
    assert.equal(value, second(index))
    assert.ok(value >= 0 && value < 1)
  }
})

test("loadCanvas enforces exact dimensions", () => {
  assert.deepEqual(loadCanvas("ab\ncd\n", 2, 2), { chars: ["ab", "cd"] })
  assert.throws(() => loadCanvas("ab\nc\n", 2, 2), /expected 2 columns/)
  assert.throws(() => loadCanvas("ab\n", 2, 2), /expected 2 rows/)
})

test("every helper preserves dimensions, colors, and determinism", () => {
  const helpers = [
    (value: SceneGrid) => wave(value, 0.3, { axis: "y", amplitude: 1 }),
    (value: SceneGrid) => shimmer(value, 0.3, { seed: 4, intensity: 0.5 }),
    (value: SceneGrid) => drift(value, 0.3, { axis: "x", speed: 1 }),
    (value: SceneGrid) => twinkle(value, 0.3, { seed: 2, intensity: 0.5 }),
    (value: SceneGrid) => scanline(value, 0.3, { axis: "y", speed: 1 }),
  ]
  for (const helper of helpers) {
    const first = helper(grid())
    const second = helper(grid())
    assert.equal(dims(first), "4x10")
    assert.deepEqual(first, second)
    assert.ok(first.colors)
    assert.equal(first.colors.length, 4)
    assert.ok(first.colors.every((row) => row.length === 10))
    assert.ok(first.colors.flat().some((color) => color !== null), "colors should travel with cells")
  }
})

test("helpers do not mutate their input", () => {
  const source = grid()
  const copy = JSON.parse(JSON.stringify(source)) as SceneGrid
  wave(source, 1)
  shimmer(source, 1)
  drift(source, 1)
  twinkle(source, 1)
  scanline(source, 1)
  assert.deepEqual(source, copy)
})
