import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { TestContext } from "node:test"

export const FIXTURES = path.join(import.meta.dirname, "..", "fixtures", "packs")

export function fixture(name: string): string {
  return path.join(FIXTURES, name)
}

export async function tempRoot(t: TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-art-"))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

export async function writeFiles(root: string, files: Record<string, string | Uint8Array>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
}

/** Create `<temp>/<name>/` with the given pack-relative files. */
export async function makePack(
  t: TestContext,
  name: string,
  files: Record<string, string | Uint8Array>,
): Promise<string> {
  const root = await tempRoot(t)
  const dir = path.join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFiles(dir, files)
  return dir
}

export const CANVAS = "abcd\nefgh\n"

/** Build an art.json body; a pack gets `canvas.txt` unless it declares frames. */
export function art(overrides: Record<string, unknown> = {}): string {
  const base = { schemaVersion: 1, id: "tiny", name: "Tiny", fps: 10, cols: 4, rows: 2 }
  const body = "frames" in overrides ? { ...base, ...overrides } : { ...base, canvas: "canvas.txt", ...overrides }
  return JSON.stringify(body, null, 2)
}
