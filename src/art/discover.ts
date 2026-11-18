import { readdir, stat } from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"
import { CAPS } from "./types.ts"
import type { Manifest, PackCandidate, PackError, PackIndex, PackProblem, Scope } from "./types.ts"
import { readManifest } from "./manifest.ts"
import { safeResolve } from "./paths.ts"
import { error, fileSize, pathExists } from "./fsutil.ts"
import { packSizeError, scanFrames } from "./load.ts"

const compareNames = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

interface ScopeScan {
  readonly candidates: PackCandidate[]
  readonly problems: PackProblem[]
}

async function checkCandidate(
  dir: string,
  manifest: Manifest,
  manifestBytes: number,
): Promise<{ frameCount: number; errors: PackError[] }> {
  const errors: PackError[] = []
  if (manifest.frames !== undefined) {
    const rel = manifest.frames
    const framesDir = safeResolve(dir, rel)
    if (framesDir === null) {
      return {
        frameCount: 0,
        errors: [error("art.json", "path", `"frames": "${rel}" resolves outside the pack root`)],
      }
    }
    const scan = await scanFrames(framesDir, rel)
    errors.push(...scan.errors)
    const total = manifestBytes + scan.bytes
    if (total > CAPS.packBytes) errors.push(packSizeError(total))
    return { frameCount: scan.frames.length, errors }
  }

  const rel = manifest.canvas
  if (rel === undefined) {
    return { frameCount: 0, errors: [error("art.json", "field", `"canvas" is required`)] }
  }
  const file = safeResolve(dir, rel)
  if (file === null) {
    return {
      frameCount: 0,
      errors: [error("art.json", "path", `"canvas": "${rel}" resolves outside the pack root`)],
    }
  }
  const size = await fileSize(file)
  if (size === null) return { frameCount: 0, errors: [error(rel, "io", `${rel}: not found`)] }

  let sidecarBytes = 0
  const sidecarRel = rel.replace(/\.txt$/, ".ans")
  const sidecarAbs = safeResolve(dir, sidecarRel)
  if (sidecarAbs === null) {
    errors.push(error(sidecarRel, "path", `${sidecarRel}: resolves outside the pack root`))
  } else {
    const sidecarSize = await fileSize(sidecarAbs)
    if (sidecarSize !== null) {
      sidecarBytes = sidecarSize
      if (sidecarSize > CAPS.frameBytes) {
        errors.push(
          error(sidecarRel, "cap", `${sidecarRel}: ${sidecarSize} bytes exceeds the ${CAPS.frameBytes}-byte cap`),
        )
      }
    }
  }
  const total = manifestBytes + size + sidecarBytes
  if (total > CAPS.packBytes) errors.push(packSizeError(total))
  return { frameCount: 1, errors }
}

/** Cheap validation of one scope: manifests plus stat-only frame checks. */
async function scanScope(root: string, scope: Scope): Promise<ScopeScan> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return { candidates: [], problems: [] }
  }
  const candidates: PackCandidate[] = []
  const problems: PackProblem[] = []
  for (const entry of [...entries].sort((a, b) => compareNames(a.name, b.name))) {
    const dir = path.join(root, entry.name)
    if (!entry.isDirectory()) {
      if (!entry.isSymbolicLink() || !(await stat(dir).catch(() => null))?.isDirectory()) continue
    }
    if (!(await pathExists(path.join(dir, "art.json")))) continue
    const read = await readManifest(dir, entry.name)
    if (read.errors.length > 0 || read.manifest === undefined) {
      problems.push({
        id: entry.name,
        dir,
        scope,
        errors: read.errors.length > 0 ? read.errors : [error("art.json", "schema", "art.json: manifest missing")],
      })
      continue
    }
    const check = await checkCandidate(dir, read.manifest, read.bytes)
    if (check.errors.length > 0) {
      problems.push({ id: entry.name, dir, scope, errors: check.errors })
      continue
    }
    candidates.push({
      id: read.manifest.id,
      dir,
      scope,
      manifest: read.manifest,
      animated: read.manifest.frames !== undefined,
      frameCount: check.frameCount,
      warnings: read.warnings,
    })
  }
  return { candidates, problems }
}

async function discoverUnsafe(projectRoot: string, globalRoot: string, bundledRoot: string): Promise<PackIndex> {
  const roots: readonly { scope: Scope; root: string }[] = [
    { scope: "project", root: path.join(projectRoot, ".opencode", "arts") },
    { scope: "user", root: globalRoot },
    { scope: "bundled", root: bundledRoot },
  ]
  const candidates: PackCandidate[] = []
  const problems: PackProblem[] = []
  const claimed = new Set<string>()

  for (const { scope, root } of roots) {
    const scan = await scanScope(root, scope)
    scan.candidates.sort((a, b) => compareNames(a.id, b.id))
    const local = new Set<string>()
    for (const candidate of scan.candidates) {
      if (claimed.has(candidate.id)) continue
      if (local.has(candidate.id)) {
        problems.push({
          id: candidate.id,
          dir: candidate.dir,
          scope,
          errors: [
            error(
              "art.json",
              "id",
              `duplicate pack id "${candidate.id}" in the ${scope} scope; ${candidate.dir} was ignored`,
            ),
          ],
        })
        continue
      }
      local.add(candidate.id)
      candidates.push(candidate)
    }
    for (const id of local) claimed.add(id)
    problems.push(...scan.problems)
  }

  return { candidates, problems }
}

/**
 * Scan the three arts roots. Missing roots are skipped; directories without
 * `art.json` are ignored; frame bodies are never read.
 */
export async function discoverPacks(
  projectRoot: string,
  globalRoot: string,
  bundledRoot: string,
): Promise<PackIndex> {
  try {
    return await discoverUnsafe(projectRoot, globalRoot, bundledRoot)
  } catch {
    return { candidates: [], problems: [] }
  }
}
