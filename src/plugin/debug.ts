import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const file = path.join(tmpdir(), "opencode-art-debug.log")

/** Temporary diagnostic sink. Never allowed to break the TUI. */
export function debug(message: string): void {
  try {
    appendFileSync(file, `${new Date().toISOString()} pid=${process.pid} ${message}\n`)
  } catch {
    // ignore
  }
}
