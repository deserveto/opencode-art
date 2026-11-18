import { readdir, stat } from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"
import { CAPS } from "./types.ts"
import type { Frame, Manifest, Pack, PackCandidate, PackError, Result } from "./types.ts"
import { parseGrid } from "./grid.ts"
import { parseSidecar } from "./ansi.ts"
import { readManifest } from "./manifest.ts"
import { safeResolve } from "./paths.ts"
import { describeFsError, error, fileSize, readTextFile } from "./fsutil.ts"

const compareNames = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const joinRel = (dir: string, name: string): string => `${dir.replace(/[\\/]+$/, "")}/${name}`
const fail = (errors: readonly PackError[]): Result<Pack, readonly PackError[]> => ({ ok: false, error: errors })

export function packSizeError(total: number): PackError {
  return error("art.json", "cap", `pack is ${total} bytes, over the ${CAPS.packBytes}-byte (20 MB) cap`)
}

export interface FrameScan {
  readonly frames: readonly string[]
  readonly sidecars: readonly string[]
  readonly bytes: number
  readonly errors: readonly PackError[]
}

/**
 * Stat-only scan of a frames directory: names, count, sizes, and sidecar
 * presence. Frame contents are never read here.
 */
export async function scanFrames(dir: string, rel: string): Promise<FrameScan> {
  let info
  try {
    info = await stat(dir)
  } catch (cause) {
    return { frames: [], sidecars: [], bytes: 0, errors: [error(rel, "io", `${rel}: ${describeFsError(cause)}`)] }
  }
  if (!info.isDirectory()) {
    return { frames: [], sidecars: [], bytes: 0, errors: [error(rel, "io", `${rel}: not a directory`)] }
  }
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (cause) {
    return { frames: [], sidecars: [], bytes: 0, errors: [error(rel, "io", `${rel}: ${describeFsError(cause)}`)] }
  }

  const frames: string[] = []
  const sidecars: string[] = []
  const errors: PackError[] = []
  let bytes = 0
  for (const entry of [...entries].sort((a, b) => compareNames(a.name, b.name))) {
    if (entry.isDirectory()) continue
    if (!entry.name.endsWith(".txt") && !entry.name.endsWith(".ans")) continue
    const fileRel = joinRel(rel, entry.name)
    const file = safeResolve(dir, entry.name)
    if (file === null) {
      errors.push(error(fileRel, "path", `${fileRel}: resolves outside the pack root`))
      continue
    }
    let size: number
    try {
      const fileInfo = await stat(file)
      if (!fileInfo.isFile()) continue
      size = fileInfo.size
    } catch (cause) {
      errors.push(error(fileRel, "io", `${fileRel}: ${describeFsError(cause)}`))
      continue
    }
    bytes += size
    if (size > CAPS.frameBytes) {
      errors.push(error(fileRel, "cap", `${fileRel}: ${size} bytes exceeds the ${CAPS.frameBytes}-byte cap`))
    }
    if (entry.name.endsWith(".txt")) frames.push(entry.name)
    else sidecars.push(entry.name)
  }

  if (frames.length === 0) {
    errors.push(error(rel, "frames", `${rel}: no .txt frames found`))
  } else if (frames.length > CAPS.frames) {
    errors.push(error(rel, "cap", `${rel}: ${frames.length} frames exceeds the ${CAPS.frames}-frame cap`))
  }
  if (sidecars.length > 0) {
    const colored = new Set(sidecars)
    for (const name of frames) {
      const sidecar = name.replace(/\.txt$/, ".ans")
      if (!colored.has(sidecar)) {
        errors.push(
          error(joinRel(rel, name), "sidecar", `${joinRel(rel, name)}: missing color sidecar ${sidecar}`),
        )
      }
    }
  }
  return { frames, sidecars, bytes, errors }
}

async function loadFramePack(
  root: string,
  manifest: Manifest,
  manifestBytes: number,
  warnings: readonly string[],
): Promise<Result<Pack, readonly PackError[]>> {
  const rel = manifest.frames
  if (rel === undefined) return fail([error("art.json", "field", `"frames" is required`)])
  const dir = safeResolve(root, rel)
  if (dir === null) {
    return fail([error("art.json", "path", `"frames": "${rel}" resolves outside the pack root`)])
  }
  const scan = await scanFrames(dir, rel)
  if (scan.errors.length > 0) return fail(scan.errors)
  const total = manifestBytes + scan.bytes
  if (total > CAPS.packBytes) return fail([packSizeError(total)])

  const frames: Frame[] = []
  const errors: PackError[] = []
  for (const name of scan.frames) {
    const frameRel = joinRel(rel, name)
    const read = await readTextFile(path.join(dir, name), frameRel, CAPS.frameBytes)
    if (read.error !== undefined) {
      errors.push(read.error)
      continue
    }
    const parsed = parseGrid(read.text ?? "", manifest.cols, manifest.rows, frameRel)
    if (parsed.errors.length > 0 || parsed.grid === undefined) {
      errors.push(...parsed.errors)
      continue
    }
    frames.push(parsed.grid)
  }
  if (errors.length > 100) {
    const more = errors.length - 100
    errors.length = 100
    errors.push(error(rel, "frame", `...and ${more} more errors; fix the first ones and validate again`))
  }
  if (errors.length > 0) return fail(errors)

  const sidecarWarnings: string[] = []
  if (scan.sidecars.length > 0) {
    const available = new Set(scan.sidecars)
    for (let index = 0; index < frames.length; index++) {
      const sidecar = scan.frames[index].replace(/\.txt$/, ".ans")
      if (!available.has(sidecar)) continue
      const sidecarRel = joinRel(rel, sidecar)
      const sidecarPath = safeResolve(dir, sidecar)
      if (sidecarPath === null) {
        errors.push(error(sidecarRel, "path", `${sidecarRel}: resolves outside the pack root`))
        continue
      }
      const read = await readTextFile(sidecarPath, sidecarRel, CAPS.frameBytes)
      if (read.error !== undefined) {
        errors.push(read.error)
        continue
      }
      const parsed = parseSidecar(read.text ?? "", frames[index], sidecarRel)
      sidecarWarnings.push(...parsed.warnings)
      if (parsed.errors.length > 0) {
        errors.push(...parsed.errors)
        continue
      }
      if (parsed.colors !== undefined) frames[index] = { ...frames[index], colors: parsed.colors }
    }
  }
  if (errors.length > 0) return fail(errors)

  return {
    ok: true,
    value: {
      id: manifest.id,
      dir: root,
      manifest,
      kind: "frames",
      frames,
      warnings: [...warnings, ...sidecarWarnings],
    },
  }
}

async function loadCanvasPack(
  root: string,
  manifest: Manifest,
  manifestBytes: number,
  warnings: readonly string[],
): Promise<Result<Pack, readonly PackError[]>> {
  const rel = manifest.canvas
  if (rel === undefined) return fail([error("art.json", "field", `"canvas" is required`)])
  const file = safeResolve(root, rel)
  if (file === null) {
    return fail([error("art.json", "path", `"canvas": "${rel}" resolves outside the pack root`)])
  }
  const read = await readTextFile(file, rel, CAPS.frameBytes)
  if (read.error !== undefined) return fail([read.error])
  const parsed = parseGrid(read.text ?? "", manifest.cols, manifest.rows, rel)
  if (parsed.errors.length > 0 || parsed.grid === undefined) return fail(parsed.errors)
  const grid = parsed.grid

  let colors: Uint8Array | null = null
  let sidecarBytes = 0
  const sidecarWarnings: string[] = []
  const sidecarRel = rel.replace(/\.txt$/, ".ans")
  const sidecarAbs = safeResolve(root, sidecarRel)
  if (sidecarAbs === null) {
    return fail([error(sidecarRel, "path", `${sidecarRel}: resolves outside the pack root`)])
  }
  if (sidecarAbs !== null) {
    const size = await fileSize(sidecarAbs)
    if (size !== null) {
      sidecarBytes = size
      const sidecar = await readTextFile(sidecarAbs, sidecarRel, CAPS.frameBytes)
      if (sidecar.error !== undefined) return fail([sidecar.error])
      const parsedSidecar = parseSidecar(sidecar.text ?? "", grid, sidecarRel)
      sidecarWarnings.push(...parsedSidecar.warnings)
      if (parsedSidecar.errors.length > 0) return fail(parsedSidecar.errors)
      colors = parsedSidecar.colors ?? null
    }
  }

  const total = manifestBytes + read.size + sidecarBytes
  if (total > CAPS.packBytes) return fail([packSizeError(total)])

  return {
    ok: true,
    value: {
      id: manifest.id,
      dir: root,
      manifest,
      kind: "canvas",
      frames: [{ ...grid, colors }],
      warnings: [...warnings, ...sidecarWarnings],
    },
  }
}

async function loadPackUnsafe(dir: string): Promise<Result<Pack, readonly PackError[]>> {
  const root = path.resolve(dir)
  const read = await readManifest(root, path.basename(root))
  if (read.errors.length > 0) return fail(read.errors)
  if (read.manifest === undefined) return fail([error("art.json", "schema", "art.json: manifest missing")])
  const manifest = read.manifest
  return manifest.frames !== undefined
    ? loadFramePack(root, manifest, read.bytes, read.warnings)
    : loadCanvasPack(root, manifest, read.bytes, read.warnings)
}

/** Load and fully validate a pack. A bad pack never throws: every failure is a PackError. */
export async function loadPack(dir: string): Promise<Result<Pack, readonly PackError[]>> {
  try {
    return await loadPackUnsafe(dir)
  } catch (cause) {
    return fail([error("art.json", "io", `failed to load pack: ${describeFsError(cause)}`)])
  }
}

export function loadCandidate(candidate: PackCandidate): Promise<Result<Pack, readonly PackError[]>> {
  return loadPack(candidate.dir)
}

/** Deep validation: every error that blocks a pack, or an empty array when valid. */
export async function validatePackDir(dir: string): Promise<readonly PackError[]> {
  const result = await loadPack(dir)
  return result.ok ? [] : result.error
}
