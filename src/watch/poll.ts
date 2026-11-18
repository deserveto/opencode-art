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

async function scanDir(dir: string, depth: number, parts: string[]): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  if (entries.length === 0) return false
  const remaining = MAX_ENTRIES + 1 - parts.length
  if (remaining <= 0) {
    parts.push("truncated")
    return true
  }
  const truncated = entries.length > remaining
  const batch = truncated ? entries.slice(0, remaining) : entries
  const resolved = await Promise.all(
    batch.map(async (entry) => {
      const full = path.join(dir, entry.name)
      const info = await stat(full).catch(() => null)
      return { entry, full, info }
    }),
  )
  const subdirs: string[] = []
  for (const { entry, full, info } of resolved) {
    parts.push(`${full}:${info?.size ?? 0}:${info?.mtimeMs ?? 0}`)
    if (depth > 0 && (entry.isDirectory() || (entry.isSymbolicLink() && info?.isDirectory()))) {
      subdirs.push(full)
    }
  }
  if (truncated) {
    parts.push("truncated")
    return true
  }
  for (const sub of subdirs) {
    if (await scanDir(sub, depth - 1, parts)) return true
  }
  return false
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
    if (rootInfo?.isFile()) {
      parts.push(`${root}:${rootInfo.size}:${rootInfo.mtimeMs}`)
      continue
    }
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
