import assert from "node:assert/strict"
import test from "node:test"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadPack } from "../src/art/load.ts"
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
