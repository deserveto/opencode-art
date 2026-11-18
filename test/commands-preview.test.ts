import assert from "node:assert/strict"
import test from "node:test"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadPack } from "../src/art/load.ts"
import { buildPreview, previewText } from "../src/commands/preview.ts"
import type { ResolvedStyle } from "../src/render/types.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const mono: ResolvedStyle = {
  requested: "mono",
  effective: "mono",
  stops: [[255, 255, 255, 255]],
  original: false,
}

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
