import assert from "node:assert/strict"
import test from "node:test"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadPack } from "../src/art/load.ts"
import type { Pack } from "../src/art/types.ts"
import { fitDialogWidth, previewBox } from "../src/commands/layout.ts"
import { buildPreview, previewText } from "../src/commands/preview.ts"
import type { ResolvedStyle } from "../src/render/types.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const mono: ResolvedStyle = {
  requested: "mono",
  effective: "mono",
  stops: [[255, 255, 255, 255]],
  original: false,
}

test("fitDialogWidth stays inside the host xlarge bounds", () => {
  assert.equal(fitDialogWidth(188), 112)
  assert.equal(fitDialogWidth(120), 112)
  assert.equal(fitDialogWidth(80), 74)
  assert.equal(fitDialogWidth(40), 40)
})

test("previewBox fits wide and stacked dialogs", () => {
  assert.deepEqual(previewBox(188, { cols: 180, rows: 50 }), { width: 64, height: 18, wide: true })
  assert.deepEqual(previewBox(80, { cols: 180, rows: 50 }), { width: 64, height: 14, wide: false })
  assert.deepEqual(previewBox(80, null), { width: 64, height: 12, wide: false })
})

test("buildPreview fits a pack frame to the requested box", async () => {
  const result = await loadPack(path.join(root, "frames", "fool"))
  assert.ok(result.ok)
  const preview = buildPreview(result.value, mono, 20, 8)
  assert.equal(preview.length, 8)
  for (const line of preview) {
    assert.equal(
      line.map((run) => run.text).join("").length,
      20,
    )
  }
})

test("buildPreview keeps sidecar colors in original style", async () => {
  const result = await loadPack(path.join(root, "frames", "fool"))
  assert.ok(result.ok)
  const original: ResolvedStyle = { ...mono, requested: "original", effective: "original", original: true }
  const preview = buildPreview(result.value, original, 12, 4)
  assert.equal(preview.length, 4)
  assert.ok(preview.some((line) => line.some((run) => run.color !== null)))
  assert.equal(previewText(preview).split("\n").length, 4)
})

test("buildPreview splits runs at color changes instead of painting rows flat", () => {
  const pack: Pack = {
    id: "runs",
    dir: "runs",
    kind: "canvas",
    manifest: {
      schemaVersion: 1,
      id: "runs",
      name: "Runs",
      fps: 10,
      cols: 4,
      rows: 1,
      defaultStyle: "theme",
      ramp: " .:-=+*#%@",
      effects: [],
    },
    frames: [{ cols: 4, rows: 1, chars: "aab ", colors: null }],
    warnings: [],
  }
  const theme: ResolvedStyle = {
    requested: "theme",
    effective: "theme",
    stops: [
      [10, 10, 10, 255],
      [20, 20, 20, 255],
      [30, 30, 30, 255],
    ],
    original: false,
  }
  const preview = buildPreview(pack, theme, 4, 1)
  assert.equal(preview.length, 1)
  const runs = preview[0] ?? []
  assert.deepEqual(runs.map((run) => run.text), ["aab", " "])
  assert.deepEqual(runs[0]?.color, [20, 20, 20, 255])
  assert.deepEqual(runs[1]?.color, [10, 10, 10, 255])
})

test("buildPreview respects pack fit mode, frameIndex, animations, lightLift, and dim", () => {
  const pack: Pack = {
    id: "fx",
    dir: "fx",
    kind: "canvas",
    manifest: {
      schemaVersion: 1,
      id: "fx",
      name: "FX",
      fps: 10,
      cols: 2,
      rows: 2,
      defaultStyle: "mono",
      fit: "contain",
      ramp: " .:-=+*#%@",
      effects: [{ type: "drift", intensity: 1, speed: 1, axis: "x" }],
    },
    frames: [{ cols: 2, rows: 2, chars: "@.@@", colors: null }],
    warnings: [],
  }
  const contained = buildPreview(pack, mono, 6, 2)
  assert.equal(previewText(contained), "  @.  \n  @@  ")

  const animated = buildPreview(pack, mono, 6, 2, { animations: true, time: 0.5, fps: 10 })
  assert.notEqual(previewText(animated), previewText(contained))

  const framesPack: Pack = {
    ...pack,
    kind: "frames",
    manifest: { ...pack.manifest, fit: "stretch", effects: [] },
    frames: [
      { cols: 2, rows: 2, chars: "aaaa", colors: null },
      { cols: 2, rows: 2, chars: "bbbb", colors: null },
    ],
  }
  assert.equal(previewText(buildPreview(framesPack, mono, 2, 2, { frameIndex: 1 })), "bb\nbb")
  assert.equal(previewText(buildPreview(framesPack, mono, 2, 2, { frameIndex: 99 })), "bb\nbb")

  const dimmedMono = buildPreview(framesPack, mono, 2, 2, {
    dim: 50,
    background: [0, 0, 0, 255],
  })
  assert.deepEqual(dimmedMono[0]?.[0]?.color, [128, 128, 128, 255])

  const originalPack: Pack = {
    ...framesPack,
    frames: [{ cols: 1, rows: 1, chars: "#", colors: new Uint8Array([220, 220, 220]) }],
  }
  const liftedOriginal: ResolvedStyle = {
    requested: "original",
    effective: "original",
    stops: [],
    original: true,
    lightLift: true,
  }
  const lifted = buildPreview(originalPack, liftedOriginal, 1, 1, {
    foreground: [0, 0, 0, 255],
    background: [255, 255, 255, 255],
  })
  const liftedRgb = lifted[0]?.[0]?.color
  assert.ok(liftedRgb)
  assert.ok(liftedRgb[0] < 220)
})
