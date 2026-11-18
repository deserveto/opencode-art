import assert from "node:assert/strict"
import test from "node:test"
import type { EffectSpec, Pack } from "../../src/art/types.ts"
import { computePaintArea, displayFrame, fitFrame, stopIndexFor } from "../../src/render/frame.ts"
import { ArtRenderable } from "../../src/render/renderable.ts"
import { columnColoredGrid, makeGrid, makePack } from "./fixtures.ts"

const ROWS = ["0123456789abcdef", "fedcba9876543210", " .:-=+*#%@.+-=*#%"]

test("stopIndexFor floors and clamps", () => {
  assert.equal(stopIndexFor(0, 3), 0)
  assert.equal(stopIndexFor(0.33, 3), 0)
  assert.equal(stopIndexFor(0.34, 3), 1)
  assert.equal(stopIndexFor(0.99, 2), 1)
  assert.equal(stopIndexFor(1, 3), 2)
  assert.equal(stopIndexFor(Number.NaN, 3), 1)
  assert.equal(stopIndexFor(0.5, 0), 0)
})

test("displayFrame picks the requested frame of a frame pack", () => {
  const frames = [makeGrid(["aa", "aa"]), makeGrid(["bb", "bb"])]
  const pack = makePack({ kind: "frames", frames })
  assert.equal(displayFrame(pack, 0, 4, 2, 0, 10, true)?.chars, "aaaa".repeat(2))
  assert.equal(displayFrame(pack, 1, 4, 2, 0, 10, true)?.chars, "bbbb".repeat(2))
  // Out-of-range indexes clamp to the last frame.
  assert.equal(displayFrame(pack, 99, 4, 2, 0, 10, true)?.chars, "bbbb".repeat(2))
})

test("displayFrame animates canvas effects at display size", () => {
  const effects: readonly EffectSpec[] = [{ type: "drift", intensity: 1, speed: 1, axis: "x" }]
  const pack = makePack({ kind: "canvas", frames: [columnColoredGrid(ROWS)], effects })
  const start = displayFrame(pack, 0, 8, 3, 0, 10, true)
  const later = displayFrame(pack, 0, 8, 3, 1, 10, true)
  assert.ok(start)
  assert.ok(later)
  assert.equal(start.cols, 8)
  assert.equal(start.rows, 3)
  assert.notDeepEqual(start, later)
})

test("animations false freezes the canvas at t = 0", () => {
  const effects: readonly EffectSpec[] = [{ type: "drift", intensity: 1, speed: 1 }]
  const pack = makePack({ kind: "canvas", frames: [columnColoredGrid(ROWS)], effects })
  const frozen = displayFrame(pack, 0, 8, 3, 9, 10, false)
  assert.deepEqual(frozen, fitFrame(pack, 0, 8, 3))
})

test("displayFrame handles empty packs", () => {
  const empty: Pack = { ...makePack(), frames: [] }
  assert.equal(displayFrame(empty, 0, 8, 3, 0, 10, true), null)
  assert.equal(fitFrame(empty, 0, 8, 3), null)
})

test("computePaintArea clips cells to the buffer and paint origin", () => {
  assert.deepEqual(computePaintArea(8, 3, 0, 0, 10, 5), {
    startX: 0,
    startY: 0,
    endX: 8,
    endY: 3,
  })
  assert.deepEqual(computePaintArea(8, 3, -2, -1, 10, 5), {
    startX: 2,
    startY: 1,
    endX: 8,
    endY: 3,
  })
  assert.deepEqual(computePaintArea(8, 3, 5, 2, 10, 5), {
    startX: 0,
    startY: 0,
    endX: 5,
    endY: 3,
  })
  assert.equal(computePaintArea(8, 3, 100, 100, 10, 5), null)
  assert.equal(computePaintArea(0, 3, 0, 0, 10, 5), null)
  assert.equal(computePaintArea(8, 3, 0, 0, 0, 0), null)
})

test("ArtRenderable is importable without a renderer", () => {
  assert.equal(typeof ArtRenderable, "function")
  const prototype = ArtRenderable.prototype as unknown as Record<string, unknown>
  assert.equal(typeof prototype.onAnimationTick, "function")
  assert.equal(typeof prototype.renderSelf, "function")
})
