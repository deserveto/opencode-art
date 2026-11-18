import assert from "node:assert/strict"
import test from "node:test"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const skip = new Set([".git", "node_modules", "dist"])

async function tsxFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (skip.has(entry.name)) continue
      files.push(...(await tsxFiles(full)))
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full)
    }
  }
  return files
}

test("every TSX source selects the OpenTUI JSX runtime", async () => {
  const files = await tsxFiles(root)
  assert.ok(files.length >= 3)
  for (const file of files) {
    const first = (await readFile(file, "utf8")).split(/\r?\n/, 1)[0] ?? ""
    assert.match(
      first,
      /@jsxImportSource @opentui\/solid/,
      `${path.relative(root, file)} must start with the OpenTUI JSX pragma`,
    )
  }
})
