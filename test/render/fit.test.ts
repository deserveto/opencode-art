import assert from "node:assert/strict"
import test from "node:test"
import { fitGrid } from "../../src/render/fit.ts"
import { makeGrid } from "./fixtures.ts"

function colorAt(grid: { readonly colors: Uint8Array | null; readonly cols: number }, x: number, y: number): number[] {
  assert.ok(grid.colors)
  const index = (y * grid.cols + x) * 3
  return [grid.colors[index], grid.colors[index + 1], grid.colors[index + 2]]
}

test("fitGrid resamples chars and colors with the same mapping", () => {
  const source = {
    cols: 2,
    rows: 2,
    chars: "abcd",
    colors: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]),
  }
  const fitted = fitGrid(source, 4, 4)

  assert.equal(fitted.cols, 4)
  assert.equal(fitted.rows, 4)
  assert.equal(fitted.chars.length, 16)
  assert.equal(fitted.chars, "aabbaabbccddccdd")
  assert.ok(fitted.colors)
  assert.equal(fitted.colors.length, 16 * 3)

  // Every fitted cell's color must come from the same source cell as its char.
  const sourceColors: Record<string, number[]> = { a: [255, 0, 0], b: [0, 255, 0], c: [0, 0, 255], d: [255, 255, 255] }
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const char: string = fitted.chars[y * 4 + x]
      assert.deepEqual(colorAt(fitted, x, y), sourceColors[char])
    }
  }
})

test("fitGrid is deterministic", () => {
  const source = makeGrid([".:-=", "+*#@"])
  const a = fitGrid(source, 7, 3)
  const b = fitGrid(source, 7, 3)
  assert.deepEqual(a, b)
})

test("fitGrid repeats a 1x1 input without NaN", () => {
  const source = makeGrid(["X"], [12, 34, 56])
  const fitted = fitGrid(source, 3, 2)
  assert.equal(fitted.chars, "XXXXXX")
  assert.deepEqual([...fitted.colors ?? []], [12, 34, 56, 12, 34, 56, 12, 34, 56, 12, 34, 56, 12, 34, 56, 12, 34, 56])
})

test("fitGrid handles empty and zero-sized grids", () => {
  const empty = fitGrid(makeGrid([]), 4, 2)
  assert.equal(empty.chars, "        ")
  assert.equal(empty.cols, 4)
  assert.equal(empty.rows, 2)

  const zero = fitGrid(makeGrid([]), 0, 0)
  assert.equal(zero.chars, "")
  assert.equal(zero.colors, null)

  const colored = fitGrid(makeGrid([], [1, 2, 3]), 2, 2)
  assert.equal(colored.chars, "    ")
  assert.deepEqual([...colored.colors ?? []], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
})

test("fitGrid handles non-finite sizes without NaN", () => {
  const source = makeGrid(["ab", "cd"])
  const fitted = fitGrid(source, Number.NaN, 3)
  assert.equal(fitted.cols, 0)
  assert.equal(fitted.rows, 3)
  assert.equal(fitted.chars, "")
  assert.equal(fitGrid(source, 2, Number.POSITIVE_INFINITY).rows, 0)
})

test("fitGrid preserves trailing spaces", () => {
  const source = makeGrid(["a   ", "b   "])
  const fitted = fitGrid(source, 4, 2)
  assert.equal(fitted.chars, "a   b   ")
})

test("fitGrid downsamples to the nearest source cell", () => {
  const source = makeGrid(["0123", "4567", "89ab", "cdef"])
  const fitted = fitGrid(source, 1, 1)
  // Centre sampling: floor(0.5 * 4 / 1) = 2.
  assert.equal(fitted.chars, "a")
})
