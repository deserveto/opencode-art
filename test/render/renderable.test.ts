import assert from "node:assert/strict"
import test from "node:test"
import type { OptimizedBuffer, RenderContext, RGBA } from "@opentui/core"
import type { EffectSpec, Pack } from "../../src/art/types.ts"
import { contrastAdjust } from "../../src/render/colors.ts"
import { computePaintArea, displayFrame, fitFrame, stopIndexFor } from "../../src/render/frame.ts"
import { ArtRenderable, type ArtRenderableOptions } from "../../src/render/renderable.ts"
import type { ResolvedStyle } from "../../src/render/types.ts"
import { columnColoredGrid, DARK_THEME, LIGHT_THEME, makeGrid, makePack } from "./fixtures.ts"

const ROWS = ["0123456789abcdef", "fedcba9876543210", " .:-=+*#%@.+-=*#%"]

interface MockNode {
  _sceneHandle?: number
  _paintLayout?: { width: number; height: number }
}

function createMockContext(width = 10, height = 4): {
  ctx: RenderContext
  renderRequests: number
  animationChanges: Array<number | undefined>
} {
  const noop = () => {}
  const state = {
    renderRequests: 0,
    animationChanges: [] as Array<number | undefined>,
  }
  const yogaHost = { assertMutable: noop, runMutation: (fn: () => unknown) => fn() }
  const nativeScene = {
    createNode(node: MockNode) {
      node._sceneHandle = 1
    },
    destroyNode(node: MockNode, cleanup?: () => void) {
      cleanup?.()
      node._sceneHandle = undefined
    },
    assertAlive: noop,
    setHooks: noop,
    setStyle: noop,
    getStyle: () => ({ unit: 0, value: 0 }),
    setPaint: noop,
    setFocus: noop,
    setMeasureFunc: noop,
    hasMeasureFunc: () => false,
    setPositions: noop,
    markDirty: noop,
    getLayout: () => ({ x: 0, y: 0, screenX: 0, screenY: 0, width, height }),
    observedLayoutRevision: 0,
    cleanupOwners: new Set(),
    driver: {
      renderLib: new Proxy(
        { getYogaHost: () => yogaHost },
        { get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : noop) },
      ),
    },
  }
  const ctx = {
    nativeScene,
    capabilities: { rgb: true, ansi256: true, unicode: "wcwidth" },
    requestRender: () => {
      state.renderRequests += 1
    },
    requestLive: noop,
    dropLive: noop,
    onAnimationTick: (fps: number) => {
      state.animationChanges.push(fps)
      return () => {
        state.animationChanges.push(undefined)
      }
    },
    registerLifecyclePass: noop,
    unregisterLifecyclePass: noop,
  } as unknown as RenderContext
  return {
    ctx,
    get renderRequests() {
      return state.renderRequests
    },
    get animationChanges() {
      return state.animationChanges
    },
  }
}

interface DrawTextCall {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly fg: RGBA
  readonly bg: RGBA
  readonly attributes: number
}

interface SetCellCall {
  readonly x: number
  readonly y: number
  readonly char: string
  readonly fg: RGBA
  readonly bg: RGBA
  readonly attributes: number
}

function createMockBuffer(width: number, height: number, withDrawText = true) {
  const drawTextCalls: DrawTextCall[] = []
  const setCellCalls: SetCellCall[] = []
  const buffer = {
    width,
    height,
    setCell(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes = 0) {
      setCellCalls.push({ x, y, char, fg, bg, attributes })
    },
    ...(withDrawText
      ? {
          drawText(text: string, x: number, y: number, fg: RGBA, bg: RGBA, attributes = 0) {
            drawTextCalls.push({ text, x, y, fg, bg, attributes })
          },
        }
      : {}),
  }
  return { buffer: buffer as unknown as OptimizedBuffer, drawTextCalls, setCellCalls }
}

function renderArt(renderable: ArtRenderable, buffer: OptimizedBuffer, delta = 16): void {
  const internal = renderable as unknown as {
    renderSelf(buf: OptimizedBuffer, dt: number): void
    _paintLayout?: { width: number; height: number }
  }
  internal._paintLayout = { width: buffer.width, height: buffer.height }
  internal.renderSelf(buffer, delta)
}

function createArt(options: ArtRenderableOptions = {}, width = 10, height = 4) {
  const mock = createMockContext(width, height)
  const art = new ArtRenderable(mock.ctx, { width, height, ...options })
  return { art, mock }
}

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

test("displayFrame forwards pack ramp to scanline and fitFrame uses manifest.fit", () => {
  const base = makePack({
    kind: "canvas",
    frames: [makeGrid(["dddd", "dddd"])],
    effects: [{ type: "scanline", intensity: 1, speed: 1, axis: "x" }],
    ramp: "abcd",
  })
  const pack: Pack = { ...base, manifest: { ...base.manifest, fit: "center" } }

  const fitted = fitFrame(pack, 0, 6, 4)
  assert.ok(fitted)
  assert.equal(fitted.chars, "       dddd  dddd       ")

  const displayed = displayFrame(pack, 0, 4, 2, 0, 10, true)
  assert.ok(displayed)
  assert.equal(displayed.chars[0], "a")
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

test("ArtRenderable groups contiguous same-fg runs via drawText and falls back to setCell", () => {
  const pack = makePack({ frames: [makeGrid([" .#@", "@#. "])] })
  const style: ResolvedStyle = {
    requested: "theme",
    effective: "theme",
    stops: [
      [10, 10, 10, 255],
      [120, 120, 120, 255],
      [240, 240, 240, 255],
    ],
    original: false,
  }
  const { art } = createArt({ pack, resolvedStyle: style, theme: DARK_THEME }, 4, 2)
  const withDraw = createMockBuffer(4, 2, true)
  renderArt(art, withDraw.buffer)
  assert.equal(withDraw.setCellCalls.length, 0)
  // Row 0: " ." -> stop 0 (" ."), "#" -> stop 2 ("#"), "@" -> stop 2 -> grouped as " ." then "#@"
  assert.equal(withDraw.drawTextCalls.length, 4)
  assert.equal(withDraw.drawTextCalls[0].text, " .")
  assert.equal(withDraw.drawTextCalls[0].x, 0)
  assert.equal(withDraw.drawTextCalls[0].y, 0)
  assert.equal(withDraw.drawTextCalls[1].text, "#@")
  assert.equal(withDraw.drawTextCalls[1].x, 2)
  assert.equal(withDraw.drawTextCalls[2].text, "@#")
  assert.equal(withDraw.drawTextCalls[2].y, 1)
  assert.equal(withDraw.drawTextCalls[3].text, ". ")

  // Fast mono paints entire row in a single drawText call without brightness lookup.
  const monoStyle: ResolvedStyle = {
    requested: "mono",
    effective: "mono",
    stops: [[100, 110, 120, 255]],
    original: false,
  }
  art.resolvedStyle = monoStyle
  const monoBuf = createMockBuffer(4, 2, true)
  renderArt(art, monoBuf.buffer)
  assert.equal(monoBuf.drawTextCalls.length, 2)
  assert.equal(monoBuf.drawTextCalls[0].text, " .#@")
  assert.equal(monoBuf.drawTextCalls[1].text, "@#. ")
  assert.deepEqual(monoBuf.drawTextCalls[0].fg.toInts(), [100, 110, 120, 255])

  // Without drawText, falls back to setCell.
  const noDraw = createMockBuffer(4, 2, false)
  renderArt(art, noDraw.buffer)
  assert.equal(noDraw.setCellCalls.length, 8)
  art.destroy()
})

test("ArtRenderable dim clamps to 0..80 and blends stops, sidecars, and fallback faint toward background", () => {
  const grid = {
    cols: 2,
    rows: 1,
    chars: "ab",
    colors: new Uint8Array([200, 100, 50, 0, 0, 0]),
  }
  const pack = makePack({ frames: [grid] })
  const monoStyle: ResolvedStyle = {
    requested: "mono",
    effective: "mono",
    stops: [[220, 220, 230, 255]],
    original: false,
  }
  const { art, mock } = createArt(
    { pack, resolvedStyle: monoStyle, theme: DARK_THEME, dim: 150 },
    2,
    1,
  )
  assert.equal(art.dim, 80)
  art.dim = -5
  assert.equal(art.dim, 0)
  art.dim = Number.NaN
  assert.equal(art.dim, 0)

  const beforeRequests = mock.renderRequests
  art.dim = 50
  assert.equal(art.dim, 50)
  assert.ok(mock.renderRequests > beforeRequests)

  const monoBuf = createMockBuffer(2, 1, true)
  renderArt(art, monoBuf.buffer)
  // 50% blend from [220, 220, 230] toward DARK_THEME.background [20, 20, 30] -> [120, 120, 130]
  assert.deepEqual(monoBuf.drawTextCalls[0].fg.toInts(), [120, 120, 130, 255])

  // Also test original colors + (0,0,0) faint fallback dimming.
  art.resolvedStyle = { requested: "original", effective: "original", stops: [], original: true }
  const origBuf = createMockBuffer(2, 1, true)
  renderArt(art, origBuf.buffer)
  assert.equal(origBuf.drawTextCalls.length, 2)
  // [200, 100, 50] -> 50% toward [20, 20, 30] = [110, 60, 40]
  assert.deepEqual(origBuf.drawTextCalls[0].fg.toInts(), [110, 60, 40, 255])
  // [0,0,0] uses DARK_THEME.faint [110, 110, 125] -> 50% toward [20, 20, 30] = [65, 65, 78]
  assert.deepEqual(origBuf.drawTextCalls[1].fg.toInts(), [65, 65, 78, 255])
  art.destroy()
})

test("ArtRenderable applies lightLift contrast adjustment in originalColor", () => {
  const pack = makePack({ frames: [makeGrid([".."], [180, 180, 180])] })
  const style: ResolvedStyle = {
    requested: "original",
    effective: "original",
    stops: [],
    original: true,
    lightLift: true,
  }
  const { art } = createArt({ pack, resolvedStyle: style, theme: LIGHT_THEME }, 2, 1)
  const buf = createMockBuffer(2, 1, true)
  renderArt(art, buf.buffer)
  const expected = contrastAdjust(
    [180, 180, 180, 255],
    LIGHT_THEME.base,
    LIGHT_THEME.background,
    3,
    0.25,
  ).color
  assert.deepEqual(buf.drawTextCalls[0].fg.toInts(), expected)
  art.destroy()
})

test("ArtRenderable calls onDestroy in destroySelf even if callback throws", () => {
  let called = 0
  const { art } = createArt({
    onDestroy: () => {
      called += 1
      throw new Error("boom")
    },
  })
  art.destroy()
  assert.equal(called, 1)
  assert.equal(art.isDestroyed, true)
})

test("ArtRenderable recover() and set pack / set enabled clear error stop state", () => {
  const pack1 = makePack({ kind: "frames", frames: [makeGrid(["aa"]), makeGrid(["bb"])], fps: 12 })
  const pack2 = makePack({ kind: "frames", frames: [makeGrid(["cc"]), makeGrid(["dd"])], fps: 12 })
  const errors: string[] = []
  const { art } = createArt({ pack: pack1, onError: (msg) => errors.push(msg) }, 2, 1)
  const throwingBuffer = {
    width: 2,
    height: 1,
    setCell() {
      throw new Error("paint failure")
    },
    drawText() {
      throw new Error("paint failure")
    },
  } as unknown as OptimizedBuffer

  for (let i = 0; i < 3; i++) renderArt(art, throwingBuffer)
  assert.equal(errors.length, 1)
  assert.equal(art.animationFps, undefined)

  // While stopped, a good buffer is blanked rather than painted with art.
  const good1 = createMockBuffer(2, 1, false)
  renderArt(art, good1.buffer)
  assert.equal(good1.setCellCalls.every((c) => c.char === " "), true)

  art.recover()
  assert.equal(art.animationFps, 12)
  const good2 = createMockBuffer(2, 1, true)
  renderArt(art, good2.buffer)
  assert.equal(good2.drawTextCalls[0]?.text, "aa")

  // Stopping again, then switching pack resets error stop.
  for (let i = 0; i < 3; i++) renderArt(art, throwingBuffer)
  assert.equal(art.animationFps, undefined)
  art.pack = pack2
  assert.equal(art.animationFps, 12)
  const good3 = createMockBuffer(2, 1, true)
  renderArt(art, good3.buffer)
  assert.equal(good3.drawTextCalls[0]?.text, "cc")

  // Stopping again, then toggling enabled false -> true resets error stop.
  for (let i = 0; i < 3; i++) renderArt(art, throwingBuffer)
  assert.equal(art.animationFps, undefined)
  art.enabled = false
  art.enabled = true
  assert.equal(art.animationFps, 12)
  const good4 = createMockBuffer(2, 1, true)
  renderArt(art, good4.buffer)
  assert.equal(good4.drawTextCalls[0]?.text, "cc")

  art.destroy()
})

test("ArtRenderable auto-degrades style and fps, fires specific callbacks, and resists state re-pushes", () => {
  const pack1 = makePack({
    kind: "frames",
    frames: [makeGrid(["ab"], [10, 200, 30]), makeGrid(["cd"], [40, 50, 220])],
    palette: ["#112233", "#ddeeff"],
    fps: 20,
  })
  const pack2 = makePack({ kind: "frames", frames: [makeGrid(["xy"], [1, 2, 3])] })
  const originalStyle: ResolvedStyle = {
    requested: "original",
    effective: "original",
    stops: [],
    original: true,
  }
  const styleDegrades: Array<{ style: ResolvedStyle; message: string }> = []
  const fpsDegrades: Array<{ fps: number; message: string }> = []
  const degrades: string[] = []

  const { art } = createArt(
    {
      pack: pack1,
      resolvedStyle: originalStyle,
      fps: 20,
      theme: DARK_THEME,
      onStyleDegrade: (style, message) => styleDegrades.push({ style, message }),
      onFpsDegrade: (fps, message) => fpsDegrades.push({ fps, message }),
      onDegrade: (message) => degrades.push(message),
    },
    2,
    1,
  )

  const buf = createMockBuffer(2, 1, true)
  const realNow = performance.now
  let fakeNow = 0
  try {
    // Each renderSelf calls performance.now() twice: +25ms per frame triggers >12ms style degrade after 30 frames.
    performance.now = () => {
      fakeNow += 25
      return fakeNow
    }
    for (let i = 0; i < 30; i++) renderArt(art, buf.buffer)
    assert.equal(styleDegrades.length, 1)
    assert.equal(styleDegrades[0].style.effective, "palette")
    assert.equal(art.resolvedStyle.effective, "palette")

    // Re-pushing a fresh ResolvedStyle with the same user-requested style ("original") must NOT revert.
    art.resolvedStyle = { requested: "original", effective: "original", stops: [], original: true }
    assert.equal(art.resolvedStyle.effective, "palette")

    // Next 30 very slow frames (>20ms) trigger fps degrade from 20 -> 10.
    for (let i = 0; i < 30; i++) renderArt(art, buf.buffer)
    assert.equal(fpsDegrades.length, 1)
    assert.equal(fpsDegrades[0].fps, 10)
    assert.equal(art.fps, 10)
    assert.equal(art.animationFps, 10)
    assert.equal(degrades.length, 2)

    // Rebinding the same un-degraded fps (20) or the degraded fps (10) keeps fps reduced.
    art.fps = 20
    assert.equal(art.fps, 10)
    art.fps = 10
    assert.equal(art.fps, 10)

    // An explicit new fps clears _fpsReduced and updates fps.
    art.fps = 24
    assert.equal(art.fps, 24)
    assert.equal(art.animationFps, 24)

    // An explicit new style ("theme") clears _degraded and switches style.
    const themeStyle: ResolvedStyle = {
      requested: "theme",
      effective: "theme",
      stops: [DARK_THEME.faint, DARK_THEME.muted, DARK_THEME.base],
      original: false,
    }
    art.resolvedStyle = themeStyle
    assert.equal(art.resolvedStyle.effective, "theme")

    // Degrade again on original, then switch pack: pack change clears _degraded so original works again.
    art.resolvedStyle = { requested: "original", effective: "original", stops: [], original: true }
    for (let i = 0; i < 30; i++) renderArt(art, buf.buffer)
    assert.equal(art.resolvedStyle.effective, "palette")
    art.pack = pack2
    art.resolvedStyle = { requested: "original", effective: "original", stops: [], original: true }
    assert.equal(art.resolvedStyle.effective, "original")
  } finally {
    performance.now = realNow
  }
  art.destroy()
})
