import assert from "node:assert/strict"
import { rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { discoverPacks, loadCandidate, loadPack, validatePackDir } from "../../src/art/index.ts"
import type { PackError } from "../../src/art/index.ts"
import { CANVAS, art, fixture, makePack, tempRoot, writeFiles } from "./tmp.ts"

const messages = (errors: readonly PackError[]): string => errors.map((entry) => entry.message).join("\n")

test("valid-frames loads all frames with color sidecars", async (t) => {
  const result = await loadPack(fixture("valid-frames"))
  assert.ok(result.ok, result.ok ? "" : messages(result.error))
  const pack = result.value
  assert.equal(pack.id, "valid-frames")
  assert.equal(pack.kind, "frames")
  assert.equal(pack.frames.length, 3)
  assert.equal(pack.frames[0].cols, 5)
  assert.equal(pack.frames[0].rows, 3)
  assert.equal(pack.frames[0].chars, ".-'`-|   |`-.-'")
  assert.match(pack.frames[1].chars, /o/)
  const colors = pack.frames[0].colors
  assert.ok(colors)
  assert.deepEqual(Array.from(colors.slice(0, 3)), [137, 180, 250])
  assert.deepEqual(pack.warnings, [])
})

test("valid-canvas loads effects and canvas color", async (t) => {
  const result = await loadPack(fixture("valid-canvas"))
  assert.ok(result.ok)
  const pack = result.value
  assert.equal(pack.kind, "canvas")
  assert.equal(pack.frames.length, 1)
  assert.equal(pack.frames[0].chars, "+---+| . |+---+")
  assert.deepEqual(pack.manifest.effects, [{ type: "shimmer", intensity: 0.25, speed: 1, seed: 7 }])
  assert.deepEqual(pack.manifest.palette, ["#313244", "#89b4fa", "#f5c2e7"])
  const colors = pack.frames[0].colors
  assert.ok(colors)
  assert.deepEqual(Array.from(colors.slice(0, 3)), [49, 50, 68])
})

test("unknown top-level fields load with warnings", async (t) => {
  const result = await loadPack(fixture("unknown-field-warning"))
  assert.ok(result.ok)
  assert.equal(result.value.warnings.length, 2)
  assert.match(result.value.warnings.join("\n"), /futureField/)
})

const badFixtures: readonly (readonly [string, string])[] = [
  ["bad-manifest-id", "id"],
  ["future-schema", "schema"],
  ["path-traversal", "path"],
  ["sidecar-partial", "sidecar"],
  ["sidecar-invariant-violation", "sidecar"],
  ["bad-width", "frame"],
  ["bad-dims", "frame"],
  ["oversized", "cap"],
  ["effects-with-frames", "effects"],
]

for (const [name, code] of badFixtures) {
  test(`bad fixture ${name} is skipped with a ${code} error`, async (t) => {
    const result = await loadPack(fixture(name))
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(
      result.error.some((entry) => entry.code === code),
      `${name}: ${messages(result.error)}`,
    )
  })
}

test("bad-width reports both the emoji and the tab", async (t) => {
  const result = await loadPack(fixture("bad-width"))
  assert.equal(result.ok, false)
  if (result.ok) return
  const text = messages(result.error)
  assert.match(text, /U\+1F600/)
  assert.match(text, /U\+0009/)
})

test("bad-dims reports the row and column mismatch", async (t) => {
  const result = await loadPack(fixture("bad-dims"))
  assert.equal(result.ok, false)
  if (result.ok) return
  const text = messages(result.error)
  assert.match(text, /expected 3 rows, found 2/)
  assert.match(text, /expected 5 columns, found 4/)
})

test("a missing art.json is an io error, not a throw", async (t) => {
  const dir = await makePack(t, "not-a-pack", {})
  const result = await loadPack(dir)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error[0].code, "io")
  assert.match(result.error[0].message, /not found/)
})

test("a missing pack directory is an io error, not a throw", async (t) => {
  const root = await tempRoot(t)
  const result = await loadPack(path.join(root, "gone"))
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error[0].code, "io")
})

test("invalid JSON reports a line", async (t) => {
  const dir = await makePack(t, "broken-json", {
    "art.json": '{\n  "schemaVersion": 1,\n  oops\n}',
  })
  const result = await loadPack(dir)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error[0].code, "json")
  assert.equal(result.error[0].line, 3)
})

test("a non-object manifest is rejected", async (t) => {
  const dir = await makePack(t, "array-manifest", { "art.json": "[]" })
  const errors = await validatePackDir(dir)
  assert.equal(errors[0].code, "schema")
})

test("all manifest errors are returned together", async (t) => {
  const dir = await makePack(t, "many-errors", {
    "art.json": art({ id: "many-errors", fps: 0, cols: 0, name: "" }),
  })
  const errors = await validatePackDir(dir)
  assert.ok(errors.length >= 3)
})

test("a missing canvas file is reported", async (t) => {
  const dir = await makePack(t, "no-canvas", { "art.json": art({ id: "no-canvas" }) })
  const result = await loadPack(dir)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error[0].code, "io")
  assert.match(result.error[0].message, /canvas\.txt/)
})

test("a missing frames directory is reported", async (t) => {
  const dir = await makePack(t, "no-frames", { "art.json": art({ id: "no-frames", frames: "frames" }) })
  const result = await loadPack(dir)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error[0].code, "io")
})

test("a frames path that is a file is reported", async (t) => {
  const dir = await makePack(t, "frames-file", {
    "art.json": art({ id: "frames-file", frames: "frames" }),
    "frames": "not a directory",
  })
  const errors = await validatePackDir(dir)
  assert.match(messages(errors), /not a directory/)
})

test("an empty frames directory is reported", async (t) => {
  const dir = await makePack(t, "empty-frames", {
    "art.json": art({ id: "empty-frames", frames: "frames" }),
    "frames/notes.md": "notes\n",
  })
  const errors = await validatePackDir(dir)
  assert.match(messages(errors), /no \.txt frames/)
})

test("more than 600 frames is a cap error", async (t) => {
  const files: Record<string, string> = {
    "art.json": art({ id: "too-many", frames: "frames" }),
  }
  for (let i = 0; i < 601; i++) files[`frames/${String(i).padStart(3, "0")}.txt`] = CANVAS
  const dir = await makePack(t, "too-many", files)
  const errors = await validatePackDir(dir)
  assert.ok(errors.some((entry) => entry.code === "cap" && /600/.test(entry.message)), messages(errors))
})

test("a pack over 20 MB is rejected after statting", async (t) => {
  const files: Record<string, string> = {
    "art.json": art({ id: "huge-pack", frames: "frames" }),
  }
  const chunk = "A".repeat(1_000_000)
  for (let i = 0; i < 21; i++) files[`frames/${String(i).padStart(3, "0")}.txt`] = chunk
  const dir = await makePack(t, "huge-pack", files)
  const errors = await validatePackDir(dir)
  assert.ok(errors.some((entry) => entry.code === "cap" && /20 MB/.test(entry.message)), messages(errors))
})

test("frames play in lexicographic order", async (t) => {
  const dir = await makePack(t, "ordered", {
    "art.json": art({ id: "ordered", frames: "frames" }),
    "frames/2.txt": "2222\n2222\n",
    "frames/10.txt": "1111\n1111\n",
  })
  const result = await loadPack(dir)
  assert.ok(result.ok)
  assert.equal(result.value.frames[0].chars, "11111111")
  assert.equal(result.value.frames[1].chars, "22222222")
})

test("non-.txt files and .txt directories are ignored", async (t) => {
  const dir = await makePack(t, "ignored", {
    "art.json": art({ id: "ignored", frames: "frames" }),
    "frames/000.txt": CANVAS,
    "frames/notes.md": "notes\n",
    "frames/sub.txt/keep.md": "keep\n",
  })
  const result = await loadPack(dir)
  assert.ok(result.ok)
  assert.equal(result.value.frames.length, 1)
})

test("CRLF and trailing spaces survive loading", async (t) => {
  const dir = await makePack(t, "crlf", {
    "art.json": art({ id: "crlf" }),
    "canvas.txt": "ab  \r\ncd  \r\n",
  })
  const result = await loadPack(dir)
  assert.ok(result.ok)
  assert.equal(result.value.frames[0].chars, "ab  cd  ")
})

test("frames with different dimensions are rejected", async (t) => {
  const dir = await makePack(t, "mixed-dims", {
    "art.json": art({ id: "mixed-dims", frames: "frames" }),
    "frames/000.txt": CANVAS,
    "frames/001.txt": "abc\n",
  })
  const errors = await validatePackDir(dir)
  assert.match(messages(errors), /expected 4 columns, found 3/)
})

test("a frame that is not valid UTF-8 is rejected", async (t) => {
  const dir = await makePack(t, "bad-utf8", {
    "art.json": art({ id: "bad-utf8", frames: "frames" }),
    "frames/000.txt": new Uint8Array([0xff, 0xfe, 0x00]),
  })
  const errors = await validatePackDir(dir)
  assert.match(messages(errors), /UTF-8/)
})

test("a sidecar that is not valid UTF-8 is rejected", async (t) => {
  const dir = await makePack(t, "bad-utf8-ans", {
    "art.json": art({ id: "bad-utf8-ans" }),
    "canvas.txt": CANVAS,
    "canvas.ans": new Uint8Array([0xff, 0xfe]),
  })
  const errors = await validatePackDir(dir)
  assert.match(messages(errors), /UTF-8/)
})

test("an optional canvas sidecar may be absent", async (t) => {
  const dir = await makePack(t, "mono-canvas", {
    "art.json": art({ id: "mono-canvas" }),
    "canvas.txt": CANVAS,
  })
  const result = await loadPack(dir)
  assert.ok(result.ok)
  assert.equal(result.value.frames[0].colors, null)
})

test("sidecar warnings surface on the loaded pack", async (t) => {
  const dir = await makePack(t, "warned", {
    "art.json": art({ id: "warned" }),
    "canvas.txt": CANVAS,
    "canvas.ans": "\u001b[41m" + CANVAS,
  })
  const result = await loadPack(dir)
  assert.ok(result.ok)
  assert.equal(result.value.frames[0].colors, null)
  assert.match(result.value.warnings.join("\n"), /unsupported SGR/)
})

test("absolute, drive-letter and parent paths are rejected", async (t) => {
  const cases = ["/tmp/evil.txt", "C:\\evil.txt", "../evil.txt", "sub/../../evil.txt"]
  for (const canvas of cases) {
    const name = `escape-${cases.indexOf(canvas)}`
    const dir = await makePack(t, name, {
      "art.json": art({ id: name, canvas }),
    })
    const errors = await validatePackDir(dir)
    assert.ok(errors.some((entry) => entry.code === "path"), `${canvas}: ${messages(errors)}`)
  }
})

test("a canvas symlink that escapes the pack root is rejected", async (t) => {
  const dir = await makePack(t, "linked-out", { "art.json": art({ id: "linked-out" }) })
  const outside = path.join(path.dirname(dir), "outside.txt")
  await writeFile(outside, CANVAS)
  try {
    await symlink(outside, path.join(dir, "canvas.txt"))
  } catch {
    t.skip("symlinks are not permitted on this machine")
    return
  }
  const errors = await validatePackDir(dir)
  assert.ok(errors.some((entry) => entry.code === "path"), messages(errors))
})

test("a canvas symlink inside the pack root loads", async (t) => {
  const dir = await makePack(t, "linked-in", {
    "art.json": art({ id: "linked-in" }),
    "real.txt": CANVAS,
  })
  try {
    await symlink(path.join(dir, "real.txt"), path.join(dir, "canvas.txt"))
  } catch {
    t.skip("symlinks are not permitted on this machine")
    return
  }
  const result = await loadPack(dir)
  assert.ok(result.ok, result.ok ? "" : messages(result.error))
})

test("a frame symlink that escapes the pack root is rejected", async (t) => {
  const dir = await makePack(t, "linked-frame", {
    "art.json": art({ id: "linked-frame", frames: "frames" }),
    "frames/000.txt": CANVAS,
  })
  const outside = path.join(path.dirname(dir), "outside.txt")
  await writeFile(outside, CANVAS)
  await rm(path.join(dir, "frames", "000.txt"))
  try {
    await symlink(outside, path.join(dir, "frames", "000.txt"))
  } catch {
    t.skip("symlinks are not permitted on this machine")
    return
  }
  const errors = await validatePackDir(dir)
  assert.ok(errors.some((entry) => entry.code === "path"), messages(errors))
})

test("a sidecar symlink that escapes the pack root is rejected", async (t) => {
  const dir = await makePack(t, "linked-ans", {
    "art.json": art({ id: "linked-ans", frames: "frames" }),
    "frames/000.txt": CANVAS,
  })
  const outside = path.join(path.dirname(dir), "outside.ans")
  await writeFile(outside, "abcd\nefgh\n")
  try {
    await symlink(outside, path.join(dir, "frames", "000.ans"))
  } catch {
    t.skip("symlinks are not permitted on this machine")
    return
  }
  const errors = await validatePackDir(dir)
  assert.ok(errors.some((entry) => entry.code === "path"), messages(errors))
})

test("an oversized art.json is rejected before reading", async (t) => {
  const dir = await makePack(t, "huge-manifest", { "art.json": " ".repeat(1_100_000) })
  const errors = await validatePackDir(dir)
  assert.ok(errors.some((entry) => entry.code === "cap"), messages(errors))
})

test("validatePackDir returns an empty array for a valid pack", async (t) => {
  assert.deepEqual(await validatePackDir(fixture("valid-canvas")), [])
})

test("loadCandidate loads a pack discovered from a root", async (t) => {
  const root = await tempRoot(t)
  const bundled = path.join(root, "bundled")
  await writeFiles(path.join(bundled, "tiny"), {
    "art.json": art(),
    "canvas.txt": CANVAS,
  })
  const index = await discoverPacks(path.join(root, "project"), path.join(root, "user"), bundled)
  const candidate = index.candidates[0]
  assert.ok(candidate)
  const result = await loadCandidate(candidate)
  assert.ok(result.ok)
  assert.equal(result.value.id, "tiny")
})
