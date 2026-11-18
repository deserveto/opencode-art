import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { encode as encodePng } from "fast-png"
import { encode as encodeJpeg } from "jpeg-js"
import { encode as encodeWebp } from "@stacksjs/ts-webp"

const root = fileURLToPath(new URL("../..", import.meta.url))
const bin = path.join(root, "bin", "opencode-art.cjs")

interface RunResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

function run(args: readonly string[], env: NodeJS.ProcessEnv = {}): RunResult {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 180_000,
    env: { ...process.env, ...env },
  })
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

async function temp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "opencode-art-cli-"))
}

async function starter(dir: string): Promise<void> {
  const result = run(["init", dir])
  assert.equal(result.code, 0, result.stderr)
}

function rgba(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      data[index] = Math.round((255 * x) / Math.max(1, width - 1))
      data[index + 1] = Math.round((255 * y) / Math.max(1, height - 1))
      data[index + 2] = 128
      data[index + 3] = 255
    }
  }
  return data
}

const SCENE = `export const meta = { fps: 4, cols: 10, rows: 4, loop: 1, name: "Test Scene" }
export function scene(t, ctx) {
  const rows = []
  for (let y = 0; y < ctx.rows; y++) {
    let line = ""
    for (let x = 0; x < ctx.cols; x++) {
      line += ((x + y + Math.floor(t * 4)) % 5 === 0) ? "#" : (x % 3 === 0 ? ":" : " ")
    }
    rows.push(line)
  }
  return rows
}
`

test("init scaffolds a valid pack and preview prints the requested width", async () => {
  const dir = path.join(await temp(), "demo-pack")
  try {
    await starter(dir)
    assert.equal((await stat(path.join(dir, "art.json"))).isFile(), true)
    assert.equal(run(["validate", dir]).code, 0)

    const preview = run(["preview", dir, "--width", "20"])
    assert.equal(preview.code, 0, preview.stderr)
    const lines = preview.stdout.replace(/\n$/, "").split("\n")
    assert.equal(lines.length, 5)
    assert.ok(lines.every((line) => line.length === 20))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("init refuses a non-empty non-pack directory unless forced", async () => {
  const dir = path.join(await temp(), "taken")
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "notes.txt"), "hello")
    const refused = run(["init", dir])
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /not empty/)
    const forced = run(["init", dir, "--force"])
    assert.equal(forced.code, 0, forced.stderr)
    assert.equal(run(["validate", dir]).code, 0)
  } finally {
    await rm(path.dirname(dir), { recursive: true, force: true })
  }
})

test("init rejects an invalid folder name", async () => {
  const parent = await temp()
  try {
    const result = run(["init", path.join(parent, "Bad Name")])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /not a valid pack id/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test("validate prints every error and exits 1", async () => {
  const dir = path.join(await temp(), "broken")
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, "art.json"),
      JSON.stringify({ schemaVersion: 1, id: "broken", name: "Broken", fps: 5, cols: 4, rows: 2, canvas: "canvas.txt" }),
    )
    await writeFile(path.join(dir, "canvas.txt"), "abc\n")
    const result = run(["validate", dir])
    assert.equal(result.code, 1)
    assert.match(result.stdout, /expected 4 columns|expected 2 rows/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("bake converts a PNG to a colored canvas with a matching sidecar", async () => {
  const dir = await temp()
  try {
    const input = path.join(dir, "gradient.png")
    await writeFile(input, encodePng({ width: 16, height: 8, data: rgba(16, 8) }))
    const out = path.join(dir, "png-pack")
    const result = run(["bake", input, "--out", out, "--cols", "20", "--rows", "10", "--colors", "16"])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(run(["validate", out]).code, 0)

    const manifest = JSON.parse(await readFile(path.join(out, "art.json"), "utf8")) as { defaultStyle: string }
    assert.equal(manifest.defaultStyle, "original")
    const text = await readFile(path.join(out, "canvas.txt"), "utf8")
    const sidecar = await readFile(path.join(out, "canvas.ans"), "utf8")
    assert.equal(sidecar.replace(/\x1b\[[0-9;]*m/g, ""), text)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("bake converts JPEG and WebP", async () => {
  const dir = await temp()
  try {
    const pixels = rgba(8, 4)
    const jpeg = path.join(dir, "a.jpg")
    const webp = path.join(dir, "a.webp")
    await writeFile(jpeg, encodeJpeg({ width: 8, height: 4, data: Buffer.from(pixels) }, 90).data)
    await writeFile(webp, await encodeWebp({ width: 8, height: 4, data: pixels }, { lossless: 1 }))
    for (const [input, out] of [
      [jpeg, path.join(dir, "jpg-pack")],
      [webp, path.join(dir, "webp-pack")],
    ] as const) {
      const result = run(["bake", input, "--out", out, "--cols", "8", "--rows", "4"])
      assert.equal(result.code, 0, result.stderr)
      assert.equal(run(["validate", out]).code, 0)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("bake converts a GIF to a sampled frame sequence", async () => {
  const dir = await temp()
  try {
    const out = path.join(dir, "gif-pack")
    const result = run([
      "bake",
      path.join(root, "test", "fixtures", "media", "three-frame.gif"),
      "--out",
      out,
      "--cols",
      "16",
      "--rows",
      "8",
      "--loop",
      "0.6",
      "--fps",
      "10",
    ])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(run(["validate", out]).code, 0)
    const frames = (await readdir(path.join(out, "frames"))).filter((name) => name.endsWith(".txt"))
    assert.equal(frames.length, 6)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("bake runs a deterministic scene in a child process", async () => {
  const dir = await temp()
  try {
    const scene = path.join(dir, "scene.mjs")
    await writeFile(scene, SCENE)
    const first = path.join(dir, "one")
    const second = path.join(dir, "two")
    for (const out of [first, second]) {
      const result = run(["bake", scene, "--out", out])
      assert.equal(result.code, 0, result.stderr)
      assert.equal(run(["validate", out]).code, 0)
    }
    const one = path.join(first, "frames")
    const two = path.join(second, "frames")
    const names = (await readdir(one)).sort()
    assert.deepEqual(names, (await readdir(two)).sort())
    assert.equal(names.filter((name) => name.endsWith(".txt")).length, 4)
    for (const name of names) {
      assert.equal(await readFile(path.join(one, name), "utf8"), await readFile(path.join(two, name), "utf8"))
    }
    assert.equal(run(["preview", first, "--frame", "1", "--width", "10"]).code, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("bake keeps an initialized pack directory without --force and clears stale frames", async () => {
  const dir = await temp()
  try {
    const out = path.join(dir, "living")
    await starter(out)
    const scene = path.join(out, "scene.mjs")
    await writeFile(scene, SCENE)
    const first = run(["bake", scene, "--out", out, "--loop", "1", "--fps", "4"])
    assert.equal(first.code, 0, first.stderr)
    assert.equal((await readdir(path.join(out, "frames"))).filter((name) => name.endsWith(".txt")).length, 4)
    const second = run(["bake", scene, "--out", out, "--loop", "0.25", "--fps", "4"])
    assert.equal(second.code, 0, second.stderr)
    assert.equal((await readdir(path.join(out, "frames"))).filter((name) => name.endsWith(".txt")).length, 1)
    assert.equal(await stat(path.join(out, "canvas.txt")).then(() => true, () => false), false)
    assert.equal(run(["validate", out]).code, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a bad scene exits 1 with its validation error", async () => {
  const dir = await temp()
  try {
    const scene = path.join(dir, "bad.mjs")
    await writeFile(scene, "export const meta = { fps: 2, cols: 4, rows: 2, loop: 1 }\nexport function scene() { return [\"x\"] }\n")
    const result = run(["bake", scene, "--out", path.join(dir, "out")])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /scene failed/)
    assert.match(result.stderr, /scene returned 1 rows, expected 2|expected 2 rows|expected 4 columns/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a hanging scene times out and exits 1", async () => {
  const dir = await temp()
  try {
    const scene = path.join(dir, "hang.mjs")
    await writeFile(
      scene,
      "export const meta = { fps: 2, cols: 4, rows: 2, loop: 1 }\nexport function scene() { while (true) {} }\n",
    )
    const result = run(["bake", scene, "--out", path.join(dir, "out")], { OPENCODE_ART_SCENE_TIMEOUT_MS: "600" })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /timed out/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("bake rejects bad options", async () => {
  const dir = await temp()
  try {
    const input = path.join(dir, "a.png")
    await writeFile(input, encodePng({ width: 4, height: 2, data: rgba(4, 2) }))
    assert.equal(run(["bake", input, "--out", path.join(dir, "o1"), "--cols", "0"]).code, 1)
    assert.equal(run(["bake", input, "--out", path.join(dir, "o2"), "--dither", "--palette", "#000,#fff"]).code, 1)
    assert.equal(run(["bake", input, "--out", path.join(dir, "o3"), "--nope"]).code, 1)
    assert.match(run(["bake", input, "--out", path.join(dir, "o4"), "--palette", "red"]).stderr, /#rrggbb/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("video input reports a missing ffmpeg as a user error", async () => {
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" })
  if (probe.error === undefined) return
  const dir = await temp()
  try {
    const input = path.join(dir, "clip.mp4")
    await writeFile(input, "not a video")
    const result = run(["bake", input, "--out", path.join(dir, "out")])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /ffmpeg was not found/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
