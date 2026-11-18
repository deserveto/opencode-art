import { readFile, stat } from "node:fs/promises"
import type { PackError, PackErrorCode } from "./types.ts"

export function error(file: string, code: PackErrorCode, message: string, line?: number): PackError {
  return line === undefined ? { file, code, message } : { file, line, code, message }
}

export function describeFsError(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause)
  const code = (cause as { code?: unknown }).code
  if (code === "ENOENT") return "not found"
  if (code === "EACCES" || code === "EPERM") return "permission denied"
  if (code === "EISDIR") return "is a directory"
  if (code === "ENOTDIR") return "not a directory"
  return typeof code === "string" ? `${code}: ${cause.message}` : cause.message
}

/** Strict decode: a replacement character would silently corrupt the grid. */
export function decodeUtf8(buffer: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer)
  } catch {
    return null
  }
}

export interface TextFile {
  readonly text?: string
  readonly size: number
  readonly error?: PackError
}

/** Stat before read, decode strictly, and report every failure as a PackError. */
export async function readTextFile(file: string, rel: string, maxBytes: number): Promise<TextFile> {
  let size = 0
  try {
    const info = await stat(file)
    if (!info.isFile()) return { size: 0, error: error(rel, "io", `${rel}: not a file`) }
    size = info.size
  } catch (cause) {
    return { size: 0, error: error(rel, "io", `${rel}: ${describeFsError(cause)}`) }
  }
  if (size > maxBytes) {
    return { size, error: error(rel, "cap", `${rel}: ${size} bytes exceeds the ${maxBytes}-byte cap`) }
  }
  let buffer: Uint8Array
  try {
    buffer = await readFile(file)
  } catch (cause) {
    return { size, error: error(rel, "io", `${rel}: ${describeFsError(cause)}`) }
  }
  const text = decodeUtf8(buffer)
  if (text === null) return { size, error: error(rel, "io", `${rel}: not valid UTF-8`) }
  return { text, size }
}

export async function pathExists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

/** Size of an existing regular file, or null when missing or not a file. */
export async function fileSize(file: string): Promise<number | null> {
  try {
    const info = await stat(file)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}
