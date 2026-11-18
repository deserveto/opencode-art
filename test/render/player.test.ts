import assert from "node:assert/strict"
import test from "node:test"
import { Player } from "../../src/render/player.ts"

const animated = (frameCount = 4, fps = 10): Player =>
  new Player({ frameCount, fps, animated: true, staticCanvas: false })

test("advance accumulates until one frame interval", () => {
  const player = animated()
  assert.equal(player.advance(50), false)
  assert.equal(player.index, 0)
  assert.ok(Math.abs(player.time - 0.05) < 1e-9)
  assert.equal(player.advance(50), true)
  assert.equal(player.index, 1)
  assert.ok(Math.abs(player.time - 0.1) < 1e-9)
})

test("advance skips whole frames instead of queuing them", () => {
  const player = animated()
  assert.equal(player.advance(2550), true)
  assert.equal(player.index, 1)
  assert.ok(Math.abs(player.time - 2.55) < 1e-9)

  // 2550 % 100 = 50 ms remain, so one more 50 ms tick advances once.
  assert.equal(player.advance(50), true)
  assert.equal(player.index, 2)
})

test("frames wrap", () => {
  const player = animated(3)
  player.advance(100)
  player.advance(100)
  player.advance(100)
  assert.equal(player.index, 0)
})

test("static canvas never advances and never accrues time", () => {
  const player = new Player({ frameCount: 1, fps: 10, animated: true, staticCanvas: true })
  assert.equal(player.advance(10_000), false)
  assert.equal(player.index, 0)
  assert.equal(player.time, 0)
})

test("animations false freezes frame and clock", () => {
  const player = new Player({ frameCount: 4, fps: 10, animated: false, staticCanvas: false })
  assert.equal(player.advance(10_000), false)
  assert.equal(player.index, 0)
  assert.equal(player.time, 0)
})

test("a single-frame animated player accrues time without changing frames", () => {
  const player = animated(1, 10)
  assert.equal(player.advance(500), false)
  assert.equal(player.index, 0)
  assert.ok(Math.abs(player.time - 0.5) < 1e-9)
  assert.equal(player.advance(500), false)
  assert.ok(Math.abs(player.time - 1) < 1e-9)
})

test("reset returns to frame zero and time zero", () => {
  const player = animated()
  player.advance(300)
  player.reset()
  assert.equal(player.index, 0)
  assert.equal(player.time, 0)
  assert.equal(player.advance(50), false)
})

test("setFps changes the interval without losing time and clamps", () => {
  const player = animated(4, 10)
  player.advance(60)
  player.setFps(60)
  assert.equal(player.fps, 30)
  assert.equal(player.advance(40), true)
  player.setFps(0)
  assert.equal(player.fps, 1)
  player.setFps(Number.NaN)
  assert.equal(player.fps, 10)
})

test("non-positive deltas are ignored", () => {
  const player = animated()
  assert.equal(player.advance(-5), false)
  assert.equal(player.advance(Number.NaN), false)
  assert.equal(player.time, 0)
  assert.equal(player.index, 0)
})
