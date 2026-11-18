import assert from "node:assert/strict"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { discoverPacks } from "../../src/art/index.ts"
import type { Scope } from "../../src/art/index.ts"
import { CANVAS, art, tempRoot, writeFiles } from "./tmp.ts"

interface Roots {
  readonly project: string
  readonly user: string
  readonly bundled: string
  readonly projectArts: string
}

async function roots(t: Parameters<typeof tempRoot>[0]): Promise<Roots> {
  const root = await tempRoot(t)
  return {
    project: path.join(root, "project"),
    user: path.join(root, "user"),
    bundled: path.join(root, "bundled"),
    projectArts: path.join(root, "project", ".opencode", "arts"),
  }
}

async function addPack(
  scopeRoot: string,
  name: string,
  overrides: Record<string, unknown> = {},
  files: Record<string, string | Uint8Array> = {},
): Promise<string> {
  const dir = path.join(scopeRoot, name)
  await writeFiles(dir, {
    "art.json": art({ id: name, ...overrides }),
    "canvas.txt": CANVAS,
    ...files,
  })
  return dir
}

const labels = (candidates: readonly { scope: Scope; id: string }[]): string[] =>
  candidates.map((candidate) => `${candidate.scope}:${candidate.id}`)

test("missing roots yield an empty index", async (t) => {
  const root = await tempRoot(t)
  const index = await discoverPacks(
    path.join(root, "project"),
    path.join(root, "user"),
    path.join(root, "bundled"),
  )
  assert.deepEqual(index, { candidates: [], problems: [] })
})

test("candidates are ordered by scope precedence then id", async (t) => {
  const r = await roots(t)
  await addPack(r.projectArts, "alpha")
  await addPack(r.user, "beta")
  await addPack(r.user, "alpha")
  await addPack(r.bundled, "alpha")
  await addPack(r.bundled, "gamma")
  await addPack(r.bundled, "zeta")

  const index = await discoverPacks(r.project, r.user, r.bundled)
  assert.deepEqual(labels(index.candidates), [
    "project:alpha",
    "user:beta",
    "bundled:gamma",
    "bundled:zeta",
  ])
  assert.deepEqual(index.problems, [])
})

test("a higher scope silently shadows the same id in a lower scope", async (t) => {
  const r = await roots(t)
  await addPack(r.user, "same")
  await addPack(r.bundled, "same")
  const index = await discoverPacks(r.project, r.user, r.bundled)
  assert.deepEqual(labels(index.candidates), ["user:same"])
  assert.deepEqual(index.problems, [])
})

test("an invalid higher-scope pack does not hide a valid lower-scope pack", async (t) => {
  const r = await roots(t)
  await addPack(r.projectArts, "broken", { id: "not-broken" })
  await addPack(r.bundled, "broken")
  const index = await discoverPacks(r.project, r.user, r.bundled)
  assert.deepEqual(labels(index.candidates), ["bundled:broken"])
  assert.equal(index.problems.length, 1)
  assert.equal(index.problems[0].scope, "project")
})

test("an invalid pack is listed in problems with its errors", async (t) => {
  const r = await roots(t)
  await addPack(r.bundled, "bad", { id: "wrong-id" })
  const index = await discoverPacks(r.project, r.user, r.bundled)
  assert.deepEqual(index.candidates, [])
  assert.equal(index.problems.length, 1)
  const problem = index.problems[0]
  assert.equal(problem.id, "bad")
  assert.equal(problem.scope, "bundled")
  assert.ok(problem.errors.some((entry) => entry.code === "id"))
})

test("a second directory claiming the same id is reported, not silently dropped", async (t) => {
  const r = await roots(t)
  await addPack(r.bundled, "twin")
  await addPack(r.bundled, "twin-copy", { id: "twin" })
  const index = await discoverPacks(r.project, r.user, r.bundled)
  assert.deepEqual(labels(index.candidates), ["bundled:twin"])
  assert.equal(index.problems.length, 1)
  assert.equal(index.problems[0].id, "twin-copy")
  assert.match(index.problems[0].errors[0].message, /does not match the folder name/)
})

test("a directory without art.json is ignored silently", async (t) => {
  const r = await roots(t)
  await writeFiles(path.join(r.bundled, "notes"), { "note.md": "just notes\n" })
  const index = await discoverPacks(r.project, r.user, r.bundled)
  assert.deepEqual(index, { candidates: [], problems: [] })
})

test("loose files in a root are ignored", async (t) => {
  const r = await roots(t)
  await writeFiles(r.bundled, { "README.md": "not a pack\n" })
  const index = await discoverPacks(r.project, r.user, r.bundled)
  assert.deepEqual(index, { candidates: [], problems: [] })
})

test("invalid JSON and a non-file art.json become problems", async (t) => {
  const r = await roots(t)
  await writeFiles(path.join(r.bundled, "broken-json"), { "art.json": "{" })
  await writeFiles(path.join(r.bundled, "json-dir"), { "art.json/keep": "x" })
  const index = await discoverPacks(r.project, r.user, r.bundled)
  assert.equal(index.candidates.length, 0)
  assert.equal(index.problems.length, 2)
  assert.ok(index.problems.some((problem) => problem.errors[0].code === "json"))
  assert.ok(index.problems.some((problem) => problem.errors[0].code === "io"))
})

test("path escapes and partial sidecars are problems", async (t) => {
  const r = await roots(t)
  await addPack(r.bundled, "escape", { frames: "../outside" })
  await addPack(
    r.bundled,
    "partial",
    { frames: "frames" },
    {
      "frames/000.txt": CANVAS,
      "frames/000.ans": `\u001b[32m${CANVAS}`,
      "frames/001.txt": CANVAS,
    },
  )
  const index = await discoverPacks(r.project, r.user, r.bundled)
  assert.equal(index.candidates.length, 0)
  const codes = index.problems.flatMap((problem) => problem.errors.map((entry) => entry.code))
  assert.ok(codes.includes("path"), codes.join(","))
  assert.ok(codes.includes("sidecar"), codes.join(","))
})

test("an oversized frame is a problem", async (t) => {
  const r = await roots(t)
  await addPack(
    r.bundled,
    "oversized",
    { frames: "frames", cols: 400, rows: 200 },
    { "frames/000.txt": "A".repeat(1_100_000) },
  )
  const index = await discoverPacks(r.project, r.user, r.bundled)
  assert.equal(index.candidates.length, 0)
  assert.ok(index.problems[0].errors.some((entry) => entry.code === "cap"))
})

test("discovery never reads frame bodies", async (t) => {
  const r = await roots(t)
  await addPack(
    r.bundled,
    "opaque",
    { frames: "frames" },
    { "frames/000.txt": new Uint8Array([0xff, 0xfe, 0x00, 0x01]) },
  )
  const index = await discoverPacks(r.project, r.user, r.bundled)
  assert.equal(index.problems.length, 0)
  assert.equal(index.candidates.length, 1)
  assert.equal(index.candidates[0].animated, true)
  assert.equal(index.candidates[0].frameCount, 1)
})

test("candidates carry manifest warnings and frame counts", async (t) => {
  const r = await roots(t)
  await addPack(r.bundled, "canvas-pack", { mystery: true })
  await addPack(
    r.bundled,
    "frame-pack",
    { frames: "frames" },
    { "frames/000.txt": CANVAS, "frames/001.txt": CANVAS },
  )
  const index = await discoverPacks(r.project, r.user, r.bundled)
  const canvas = index.candidates.find((candidate) => candidate.id === "canvas-pack")
  const frames = index.candidates.find((candidate) => candidate.id === "frame-pack")
  assert.ok(canvas)
  assert.ok(frames)
  assert.equal(canvas.animated, false)
  assert.equal(canvas.frameCount, 1)
  assert.match(canvas.warnings.join("\n"), /mystery/)
  assert.equal(frames.animated, true)
  assert.equal(frames.frameCount, 2)
})

test("symlinked pack directories are discovered while file and broken symlinks are ignored", async (t) => {
  const r = await roots(t)
  const external = path.join(path.dirname(r.project), "shared-packs")
  const targetDir = await addPack(external, "linked-pack")
  await mkdir(r.projectArts, { recursive: true })
  const linkDir = path.join(r.projectArts, "linked-pack")
  try {
    await symlink(targetDir, linkDir, "dir")
  } catch {
    if (process.platform === "win32") {
      try {
        await symlink(targetDir, linkDir, "junction")
      } catch {
        t.skip("directory symlinks are not permitted on this machine")
        return
      }
    } else {
      t.skip("directory symlinks are not permitted on this machine")
      return
    }
  }

  const looseFile = path.join(external, "loose.txt")
  await writeFile(looseFile, "ignored\n")
  try {
    await symlink(looseFile, path.join(r.projectArts, "file-link"))
    await symlink(path.join(external, "does-not-exist"), path.join(r.projectArts, "broken-link"), "dir")
  } catch {
    // Ignore if file or dangling symlinks are restricted; directory link still tests discovery.
  }

  const index = await discoverPacks(r.project, r.user, r.bundled)
  assert.deepEqual(labels(index.candidates), ["project:linked-pack"])
  assert.deepEqual(index.problems, [])
})
