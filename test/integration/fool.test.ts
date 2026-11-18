import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { loadPack } from "../../src/art/index.ts"

const root = fileURLToPath(new URL("../..", import.meta.url))

test("the bundled Fool pack loads, has 60 frames, and carries color", async () => {
  const result = await loadPack(path.join(root, "frames", "fool"))
  assert.equal(result.ok, true, result.ok ? "" : result.error.map((error) => error.message).join("\n"))
  if (!result.ok) return
  const pack = result.value
  assert.equal(pack.id, "fool")
  assert.equal(pack.kind, "frames")
  assert.equal(pack.frames.length, 60)
  assert.equal(pack.manifest.cols, 180)
  assert.equal(pack.manifest.rows, 50)
  assert.equal(pack.frames[0]?.chars.length, 180 * 50)
  assert.equal(pack.frames[0]?.colors?.length, 180 * 50 * 3)

  const colors = new Set<string>()
  const frame = pack.frames[0]
  if (frame?.colors) {
    for (let cell = 0; cell < 180 * 50; cell++) {
      colors.add(`${frame.colors[cell * 3]},${frame.colors[cell * 3 + 1]},${frame.colors[cell * 3 + 2]}`)
    }
  }
  assert.ok(colors.size > 8, `expected a color sidecar, found ${colors.size} colors`)
  assert.equal(pack.warnings.length, 0)
})
