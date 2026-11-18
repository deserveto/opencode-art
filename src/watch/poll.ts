import { readdir, stat } from "node:fs/promises"
import path from "node:path"

export interface PollOptions {
  readonly roots: () => readonly string[]
  readonly onChanged: () => void | Promise<void>
  readonly onError?: (message: string) => void
  readonly intervalMs?: number
  readonly debounceMs?: number
}

const MAX_ENTRIES = 4000
// Entries up to six levels below each root are stat'ed, so a manifest may
// point `frames` at a directory nested several levels deep.
const MAX_DEPTH = 5

async function scanDir(dir: string, depth: number, parts: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (parts.length > MAX_ENTRIES) {
      parts.push("truncated")
      return
    }
    const full = path.join(dir, entry.name)
    const info = await stat(full).catch(() => null)
    parts.push(`${full}:${info?.size ?? 0}:${info?.mtimeMs ?? 0}`)
    if (entry.isDirectory() && depth > 0) await scanDir(full, depth - 1, parts)
  }
}

/**
 * Directory mtimes alone miss edits inside a pack, so every entry is stat'ed
 * by name. Pack subdirectories are walked (six levels) because a
 * manifest may point `frames` at any relative directory, not only `frames/`.
 */
export async function scanSignature(roots: readonly string[]): Promise<string> {
  const parts: string[] = []
  for (const root of roots) {
    const rootInfo = await stat(root).catch(() => null)
    if (!rootInfo?.isDirectory()) {
      parts.push(`${root}:missing`)
      continue
    }
    parts.push(`${root}:${rootInfo.mtimeMs}`)
    await scanDir(root, MAX_DEPTH, parts)
  }
  parts.sort()
  return parts.join("|")
}

/** Polls pack roots and calls `onChanged` after a debounced signature change. */
export function startPolling(options: PollOptions): () => void {
  const intervalMs = options.intervalMs ?? 2000
  const debounceMs = options.debounceMs ?? 500
  let last: string | null = null
  let busy = false
  let stopped = false
  let debounce: NodeJS.Timeout | undefined

  async function poll(): Promise<void> {
    if (stopped || busy) return
    busy = true
    try {
      const signature = await scanSignature(options.roots())
      if (last === null) {
        last = signature
      } else if (signature !== last) {
        last = signature
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          debounce = undefined
          if (stopped) return
          Promise.resolve(options.onChanged()).catch((error: unknown) => {
            options.onError?.(error instanceof Error ? error.message : String(error))
          })
        }, debounceMs)
      }
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : String(error))
    } finally {
      busy = false
    }
  }

  const interval = setInterval(() => void poll(), intervalMs)
  void poll()

  return () => {
    stopped = true
    clearInterval(interval)
    if (debounce) clearTimeout(debounce)
  }
}
