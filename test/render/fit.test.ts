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

test("fitGrid explicit stretch matches default behavior", () => {
  const source = makeGrid(["ab", "cd"], [10, 20, 30])
  assert.deepEqual(fitGrid(source, 5, 3, "stretch"), fitGrid(source, 5, 3))
})

test("fitGrid contain preserves aspect ratio and pads with spaces and black colors", () => {
  const source = {
    cols: 2,
    rows: 2,
    chars: "abcd",
    colors: new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
  }
  const fitted = fitGrid(source, 6, 2, "contain")
  assert.equal(fitted.cols, 6)
  assert.equal(fitted.rows, 2)
  assert.equal(fitted.chars, "  ab    cd  ")
  assert.deepEqual(colorAt(fitted, 0, 0), [0, 0, 0])
  assert.deepEqual(colorAt(fitted, 1, 0), [0, 0, 0])
  assert.deepEqual(colorAt(fitted, 2, 0), [10, 20, 30])
  assert.deepEqual(colorAt(fitted, 3, 0), [40, 50, 60])
  assert.deepEqual(colorAt(fitted, 4, 0), [0, 0, 0])
  assert.deepEqual(colorAt(fitted, 2, 1), [70, 80, 90])
  assert.deepEqual(colorAt(fitted, 3, 1), [100, 110, 120])

  const vertical = fitGrid(source, 2, 6, "contain")
  assert.equal(vertical.chars, "    abcd    ")
  assert.deepEqual(colorAt(vertical, 0, 0), [0, 0, 0])
  assert.deepEqual(colorAt(vertical, 0, 2), [10, 20, 30])
  assert.deepEqual(colorAt(vertical, 1, 3), [100, 110, 120])
  assert.deepEqual(colorAt(vertical, 1, 5), [0, 0, 0])

  const down = fitGrid(makeGrid(["1122", "1122", "3344", "3344"]), 2, 4, "contain")
  assert.equal(down.chars, "  1234  ")
})

test("fitGrid cover fills the box and crops the overflow axis", () => {
  const source = {
    cols: 4,
    rows: 2,
    chars: "abcdABCD",
    colors: new Uint8Array([
      1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0,
      5, 0, 0, 6, 0, 0, 7, 0, 0, 8, 0, 0,
    ]),
  }
  const fitted = fitGrid(source, 4, 4, "cover")
  assert.equal(fitted.cols, 4)
  assert.equal(fitted.rows, 4)
  // scale = max(1, 2) = 2 -> virt 8x4, cropX = 2, cropY = 0 -> middle two source columns repeated 2x each
  assert.equal(fitted.chars, "bbccbbccBBCCBBCC")
  assert.deepEqual(colorAt(fitted, 0, 0), [2, 0, 0])
  assert.deepEqual(colorAt(fitted, 3, 0), [3, 0, 0])
  assert.deepEqual(colorAt(fitted, 0, 3), [6, 0, 0])
  assert.deepEqual(colorAt(fitted, 3, 3), [7, 0, 0])

  const tall = fitGrid(makeGrid(["aa", "bb", "cc", "dd"]), 4, 4, "cover")
  assert.equal(tall.chars, "bbbbbbbbcccccccc")
})

test("fitGrid center places 1:1 with padding or center-crops when larger", () => {
  const small = {
    cols: 2,
    rows: 2,
    chars: "abcd",
    colors: new Uint8Array([10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]),
  }
  const padded = fitGrid(small, 4, 4, "center")
  assert.equal(padded.chars, "     ab  cd     ")
  assert.deepEqual(colorAt(padded, 0, 0), [0, 0, 0])
  assert.deepEqual(colorAt(padded, 1, 1), [10, 0, 0])
  assert.deepEqual(colorAt(padded, 2, 1), [20, 0, 0])
  assert.deepEqual(colorAt(padded, 1, 2), [30, 0, 0])
  assert.deepEqual(colorAt(padded, 2, 2), [40, 0, 0])
  assert.deepEqual(colorAt(padded, 3, 3), [0, 0, 0])

  const large = makeGrid(["0123", "4567", "89ab", "cdef"], [9, 8, 7])
  const cropped = fitGrid(large, 2, 2, "center")
  assert.equal(cropped.chars, "569a")
  assert.deepEqual(colorAt(cropped, 0, 0), [9, 8, 7])

  const mixed = fitGrid(makeGrid(["012345", "abcdef"]), 4, 4, "center")
  assert.equal(mixed.chars, "    1234bcde    ")
})
