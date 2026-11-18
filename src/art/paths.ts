import { realpathSync } from "node:fs"
import path from "node:path"

const DRIVE = /^[A-Za-z]:/
const SEPARATORS = /[\\/]+/

function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

/**
 * Resolve a manifest-relative path inside `root`. Returns null for absolute
 * paths, drive letters, `..`, and symlinks whose real path leaves the root.
 * Missing targets keep their lexical path so callers can report a missing
 * file instead of a path error.
 */
export function safeResolve(root: string, relative: string): string | null {
  try {
    if (relative.length === 0 || relative.includes("\u0000")) return null
    if (path.isAbsolute(relative) || DRIVE.test(relative) || relative.startsWith("\\")) return null
    const segments = relative.split(SEPARATORS).filter((segment) => segment !== "" && segment !== ".")
    if (segments.some((segment) => segment === "..")) return null
    const rootPath = path.resolve(root)
    const resolved = path.resolve(rootPath, ...segments)
    if (!inside(rootPath, resolved)) return null
    try {
      if (!inside(realpathSync(rootPath), realpathSync(resolved))) return null
    } catch {
      // The target (or the root) does not exist yet: the lexical check stands.
    }
    return resolved
  } catch {
    return null
  }
}
