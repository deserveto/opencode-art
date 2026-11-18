import assert from "node:assert/strict"
import test from "node:test"
import type { EffectSpec, Grid } from "../../src/art/types.ts"
import { applyEffects } from "../../src/effects/index.ts"
import { densityBucket, glyphBrightness } from "../../src/render/brightness.ts"
import { columnColoredGrid, makeGrid } from "./fixtures.ts"

const META = { fps: 10, seed: 0 }
const ROWS = [".:-=+*#%@.+-=*#%", "=+*#%@.+-=*#%@+*", "abcdefghijklmnop", "@%#*+=:-.@%#*+=:"]
const COLORED = columnColoredGrid(ROWS)
const PLAIN = makeGrid(ROWS)

const SPECS: readonly EffectSpec[] = [
  { type: "shimmer", intensity: 0.8, speed: 1, seed: 3 },
  { type: "wave", intensity: 0.7, speed: 1, axis: "x" },
  { type: "wave", intensity: 0.7, speed: 1, axis: "y" },
  { type: "drift", intensity: 0.8, speed: 1, axis: "x" },
  { type: "drift", intensity: 0.8, speed: 1, axis: "y" },
  { type: "twinkle", intensity: 0.8, speed: 1, seed: 2 },
  { type: "scanline", intensity: 0.8, speed: 1, axis: "x" },
  { type: "scanline", intensity: 0.8, speed: 1, axis: "y" },
]

function clone(grid: Grid): Grid {
  return { cols: grid.cols, rows: grid.rows, chars: grid.chars, colors: grid.colors ? grid.colors.slice() : null }
}

function pairCounts(grid: Grid): Map<string, number> {
  const counts = new Map<string, number>()
  const cells = grid.cols * grid.rows
  for (let index = 0; index < cells; index++) {
    const color = grid.colors
      ? `${grid.colors[index * 3]},${grid.colors[index * 3 + 1]},${grid.colors[index * 3 + 2]}`
      : "none"
    const key = `${grid.chars[index] ?? " "}|${color}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

test("every effect is deterministic and preserves dimensions", () => {
  for (const spec of SPECS) {
    const first = applyEffects(COLORED, [spec], 0.4, META)
    const second = applyEffects(COLORED, [spec], 0.4, META)
    assert.deepEqual(first, second, spec.type)
    assert.equal(first.cols, COLORED.cols)
    assert.equal(first.rows, COLORED.rows)
    assert.equal(first.chars.length, COLORED.cols * COLORED.rows)
    assert.equal(first.colors?.length, COLORED.cols * COLORED.rows * 3)
  }
})

test("t = 0 is a valid deterministic frame", () => {
  for (const spec of SPECS) {
    const a = applyEffects(COLORED, [spec], 0, META)
    const b = applyEffects(COLORED, [spec], 0, META)
    assert.deepEqual(a, b, spec.type)
    assert.equal(a.cols, COLORED.cols)
  }
})

test("effects do not mutate their input", () => {
  const before = clone(COLORED)
  for (const spec of SPECS) applyEffects(COLORED, [spec], 0.75, META)
  assert.deepEqual(COLORED, before)
})

test("mono grids keep colors null", () => {
  for (const spec of SPECS) {
    const output = applyEffects(PLAIN, [spec], 0.6, META)
    assert.equal(output.colors, null, spec.type)
    assert.equal(output.chars.length, PLAIN.chars.length)
  }
})

test("shimmer changes glyphs but keeps colors in place", () => {
  const spec: EffectSpec = { type: "shimmer", intensity: 1, speed: 1, seed: 5 }
  const output = applyEffects(COLORED, [spec], 0.5, META)
  assert.notEqual(output.chars, COLORED.chars)
  assert.deepEqual(output.colors, COLORED.colors)

  const off = applyEffects(COLORED, [{ ...spec, intensity: 0 }], 0.5, META)
  assert.deepEqual(off, COLORED)
})

test("shimmer swaps glyphs only within the same density bucket", () => {
  const spec: EffectSpec = { type: "shimmer", intensity: 1, speed: 1, seed: 5 }
  const output = applyEffects(PLAIN, [spec], 0.5, META)
  for (let index = 0; index < PLAIN.chars.length; index++) {
    const before = PLAIN.chars[index] ?? " "
    const after = output.chars[index] ?? " "
    if (before === after) continue
    assert.equal(densityBucket(glyphBrightness(after, "")), densityBucket(glyphBrightness(before, "")))
  }
})

test("wave is a permutation of glyph and color pairs", () => {
  const spec: EffectSpec = { type: "wave", intensity: 1, speed: 1, axis: "x" }
  const output = applyEffects(COLORED, [spec], 0.25, META)
  assert.notEqual(output.chars, COLORED.chars)
  assert.deepEqual(pairCounts(output), pairCounts(COLORED))

  const off = applyEffects(COLORED, [{ ...spec, intensity: 0 }], 0.25, META)
  assert.deepEqual(off, COLORED)
})

test("drift scrolls glyphs and colors together", () => {
  const spec: EffectSpec = { type: "drift", intensity: 1, speed: 1, axis: "x" }
  const output = applyEffects(COLORED, [spec], 1 / 6, META)
  assert.equal(output.chars[0 * 16 + 1], COLORED.chars[0 * 16 + 0])
  for (let channel = 0; channel < 3; channel++) {
    assert.equal(output.colors?.[(0 * 16 + 1) * 3 + channel], COLORED.colors?.[(0 * 16 + 0) * 3 + channel])
  }
  assert.deepEqual(pairCounts(output), pairCounts(COLORED))
})

test("drift on the y axis scrolls rows", () => {
  const spec: EffectSpec = { type: "drift", intensity: 1, speed: 1, axis: "y" }
  const output = applyEffects(COLORED, [spec], 1 / 6, META)
  assert.equal(output.chars[1 * 16 + 0], COLORED.chars[0 * 16 + 0])
})

test("drift with zero speed or intensity is a no-op", () => {
  for (const spec of [
    { type: "drift", intensity: 1, speed: 0 },
    { type: "drift", intensity: 0, speed: 1 },
  ] satisfies EffectSpec[]) {
    assert.deepEqual(applyEffects(PLAIN, [spec], 1.5, META), PLAIN)
  }
})

test("twinkle fades sparse cells to spaces and keeps colors", () => {
  const spec: EffectSpec = { type: "twinkle", intensity: 1, speed: 1, seed: 4 }
  const output = applyEffects(COLORED, [spec], 0.5, META)
  const spaces = (grid: Grid): number => (grid.chars.match(/ /g) ?? []).length
  assert.ok(spaces(output) > spaces(COLORED))
  assert.deepEqual(output.colors, COLORED.colors)

  const off = applyEffects(COLORED, [{ ...spec, intensity: 0 }], 0.5, META)
  assert.deepEqual(off, COLORED)
})

test("scanline dims colors inside the band", () => {
  const spec: EffectSpec = { type: "scanline", intensity: 1, speed: 1, axis: "x" }
  const output = applyEffects(COLORED, [spec], 0, META)
  const blue = 2
  assert.ok((output.colors?.[blue] ?? 0) < (COLORED.colors?.[blue] ?? 0))
  assert.equal(output.chars, COLORED.chars)
})

test("scanline dims glyph density on mono art", () => {
  const spec: EffectSpec = { type: "scanline", intensity: 1, speed: 1, axis: "x" }
  const output = applyEffects(PLAIN, [spec], 0, META)
  assert.notEqual(output.chars, PLAIN.chars)
})

test("scanline steps down along a custom ramp when supplied and falls back for unknown glyphs", () => {
  const spec: EffectSpec = { type: "scanline", intensity: 1, speed: 1, axis: "x" }
  const custom = makeGrid(["dddd", "dddd"])
  const defaultOutput = applyEffects(custom, [spec], 0, META)
  assert.equal(defaultOutput.chars, custom.chars)

  const customOutput = applyEffects(custom, [spec], 0, { ...META, ramp: "abcd" })
  assert.equal(customOutput.chars[0], "a")
  assert.notEqual(customOutput.chars, custom.chars)

  const mixed = makeGrid(["@@@@", "@@@@"])
  const fallbackOutput = applyEffects(mixed, [spec], 0, { ...META, ramp: "abcd" })
  assert.notEqual(fallbackOutput.chars[0], "@")
  assert.ok(" .:-=+*#%@".includes(fallbackOutput.chars[0]))

  const tooShort = applyEffects(custom, [spec], 0, { ...META, ramp: "d" })
  assert.equal(tooShort.chars, custom.chars)
})

test("effects compose in array order", () => {
  const effects: readonly EffectSpec[] = [
    { type: "wave", intensity: 0.8, speed: 1, axis: "x" },
    { type: "drift", intensity: 0.7, speed: 1, axis: "y" },
    { type: "scanline", intensity: 0.6, speed: 1, axis: "x" },
  ]
  const combined = applyEffects(COLORED, effects, 0.3, META)
  let chained = COLORED
  for (const effect of effects) chained = applyEffects(chained, [effect], 0.3, META)
  assert.deepEqual(combined, chained)
})

test("unknown effects and missing parameters are tolerated", () => {
  const unknown = applyEffects(PLAIN, [{ type: "nope" as EffectSpec["type"] }], 0.4, META)
  assert.deepEqual(unknown, PLAIN)

  const defaults = applyEffects(PLAIN, [{ type: "wave" }, { type: "scanline" }], 0.4, { fps: 10, seed: 0 })
  assert.equal(defaults.cols, PLAIN.cols)
  assert.equal(defaults.rows, PLAIN.rows)
})

test("degenerate time and sizes do not throw", () => {
  const spec: EffectSpec = { type: "shimmer", intensity: 1, speed: 1, seed: 1 }
  assert.equal(applyEffects(PLAIN, [spec], Number.NaN, META).cols, PLAIN.cols)
  assert.equal(applyEffects(PLAIN, [spec], -5, META).cols, PLAIN.cols)

  const empty = applyEffects({ cols: 0, rows: 0, chars: "", colors: null }, [spec], 1, META)
  assert.deepEqual(empty, { cols: 0, rows: 0, chars: "", colors: null })
})
