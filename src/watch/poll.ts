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

/**
 * Directory mtimes alone miss edits inside a pack (file content does not move
 * the directory mtime), so every manifest and frame is stat'ed by name.
 */
export async function scanSignature(roots: readonly string[]): Promise<string> {
  const parts: string[] = []
  for (const root of roots) {
    const rootInfo = await stat(root).catch(() => null)
    if (!rootInfo?.isDirectory()) {
      parts.push(`${root}:missing`)
      continue
    }
    const packs = await readdir(root, { withFileTypes: true }).catch(() => [])
    for (const pack of packs) {
      if (!pack.isDirectory()) continue
      const packDir = path.join(root, pack.name)
      parts.push(`${packDir}:${(await stat(packDir)).mtimeMs}`)
      const entries = await readdir(packDir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const full = path.join(packDir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== "frames") continue
          parts.push(`${full}:${(await stat(full).catch(() => null))?.mtimeMs ?? 0}`)
          const frames = await readdir(full, { withFileTypes: true }).catch(() => [])
          for (const frame of frames) {
            if (!frame.isFile()) continue
            const info = await stat(path.join(full, frame.name)).catch(() => null)
            parts.push(`${full}/${frame.name}:${info?.size ?? 0}:${info?.mtimeMs ?? 0}`)
          }
        } else if (entry.isFile()) {
          const info = await stat(full).catch(() => null)
          parts.push(`${full}:${info?.size ?? 0}:${info?.mtimeMs ?? 0}`)
        }
        if (parts.length > MAX_ENTRIES) {
          parts.push("truncated")
          break
        }
      }
    }
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
