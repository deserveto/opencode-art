import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { scanSignature, startPolling } from "../src/watch/poll.ts"

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "opencode-art-watch-"))
}

test("signature changes when a frame's contents change", async () => {
  const root = await tempRoot()
  try {
    const frames = path.join(root, "demo", "frames")
    await mkdir(frames, { recursive: true })
    const file = path.join(frames, "000.txt")
    await writeFile(file, "a\n")
    const first = await scanSignature([root])
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(file, "ab\n")
    const second = await scanSignature([root])
    assert.notEqual(first, second)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("polling reports a debounced change and stops cleanly", async () => {
  const root = await tempRoot()
  let changes = 0
  let stop: (() => void) | undefined
  try {
    await mkdir(path.join(root, "demo"), { recursive: true })
    await writeFile(path.join(root, "demo", "art.json"), "{}")
    stop = startPolling({
      roots: () => [root],
      intervalMs: 25,
      debounceMs: 30,
      onChanged: () => {
        changes++
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 80))
    await writeFile(path.join(root, "demo", "art.json"), '{"x":1}')
    const started = Date.now()
    while (changes === 0 && Date.now() - started < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.ok(changes > 0, "expected a change callback")
    stop()
    stop = undefined
    const settled = changes
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(changes, settled, "no callbacks after stop")
  } finally {
    stop?.()
    await rm(root, { recursive: true, force: true })
  }
})

test("missing roots are handled as a signature, not a throw", async () => {
  const signature = await scanSignature([path.join(tmpdir(), "opencode-art-does-not-exist")])
  assert.match(signature, /missing/)
})
