import assert from "node:assert/strict"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import test from "node:test"
import path from "node:path"
import { safeResolve } from "../../src/art/index.ts"
import { tempRoot } from "./tmp.ts"

test("safeResolve joins pack-relative paths", async (t) => {
  const root = await tempRoot(t)
  assert.equal(safeResolve(root, "canvas.txt"), path.join(root, "canvas.txt"))
  assert.equal(safeResolve(root, "frames/000.txt"), path.join(root, "frames", "000.txt"))
  assert.equal(safeResolve(root, "./frames/./000.txt"), path.join(root, "frames", "000.txt"))
})

test("safeResolve rejects escapes and absolute paths", async (t) => {
  const root = await tempRoot(t)
  assert.equal(safeResolve(root, "../x"), null)
  assert.equal(safeResolve(root, "frames/../../x"), null)
  assert.equal(safeResolve(root, "frames\\..\\..\\x"), null)
  assert.equal(safeResolve(root, "/etc/passwd"), null)
  assert.equal(safeResolve(root, "\\\\server\\share"), null)
  assert.equal(safeResolve(root, "C:\\art"), null)
  assert.equal(safeResolve(root, "C:art"), null)
  assert.equal(safeResolve(root, ""), null)
  assert.equal(safeResolve(root, "bad\u0000name"), null)
})

test("safeResolve accepts a child whose name starts with dots", async (t) => {
  const root = await tempRoot(t)
  assert.equal(safeResolve(root, "..foo"), path.join(root, "..foo"))
})

test("a missing target keeps its lexical path for a clear missing-file error", async (t) => {
  const root = await tempRoot(t)
  assert.equal(safeResolve(root, "missing/canvas.txt"), path.join(root, "missing", "canvas.txt"))
})

test("a symlink that escapes the pack root is rejected", async (t) => {
  const root = await tempRoot(t)
  const outside = path.join(root, "outside.txt")
  const pack = path.join(root, "pack")
  await mkdir(pack)
  await writeFile(outside, "abcd\n")
  try {
    await symlink(outside, path.join(pack, "canvas.txt"))
  } catch {
    t.skip("symlinks are not permitted on this machine")
    return
  }
  assert.equal(safeResolve(pack, "canvas.txt"), null)
})

test("a symlink that stays inside the pack root is accepted", async (t) => {
  const root = await tempRoot(t)
  const pack = path.join(root, "pack")
  await mkdir(pack)
  await writeFile(path.join(pack, "real.txt"), "abcd\n")
  try {
    await symlink(path.join(pack, "real.txt"), path.join(pack, "canvas.txt"))
  } catch {
    t.skip("symlinks are not permitted on this machine")
    return
  }
  assert.equal(safeResolve(pack, "canvas.txt"), path.join(pack, "canvas.txt"))
})
