import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { PACK_ID_PATTERN } from "../art/types.ts"
import type { GlyphFrame } from "./pipeline.ts"
import { nearestIndex, rgbToHex, type Rgb } from "./quantize.ts"

export interface PackWriteOptions {
  readonly dir: string
  readonly name: string
  readonly description?: string
  readonly author?: string
  readonly license?: string
  readonly fps: number
  readonly cols: number
  readonly rows: number
  readonly ramp: string
  readonly kind: "canvas" | "frames"
  readonly frames: readonly GlyphFrame[]
  readonly palette?: readonly Rgb[]
  readonly declaredPalette?: readonly Rgb[]
  readonly source: { type: string; file: string; note: string }
}

function characterAt(frame: GlyphFrame, index: number): string {
  return frame.chars[index] ?? " "
}

function sidecar(frame: GlyphFrame, palette: readonly Rgb[]): string {
  if (!frame.colors) return ""
  const cache = new Map<number, number>()
  const lines: string[] = []
  for (let y = 0; y < frame.rows; y++) {
    let line = ""
    let active = -1
    for (let x = 0; x < frame.cols; x++) {
      const index = y * frame.cols + x
      const char = characterAt(frame, index)
      if (char === " ") {
        if (active !== -1) {
          line += "\x1b[0m"
          active = -1
        }
        line += " "
        continue
      }
      const r = frame.colors[index * 3]
      const g = frame.colors[index * 3 + 1]
      const b = frame.colors[index * 3 + 2]
      const key = (r << 16) | (g << 8) | b
      let stop = cache.get(key)
      if (stop === undefined) {
        stop = nearestIndex(palette, r, g, b)
        cache.set(key, stop)
      }
      if (stop !== active) {
        const color = palette[stop] ?? { r, g, b }
        line += `\x1b[38;2;${color.r};${color.g};${color.b}m`
        active = stop
      }
      line += char
    }
    if (active !== -1) line += "\x1b[0m"
    lines.push(line)
  }
  return lines.join("\n")
}

function frameText(frame: GlyphFrame): string {
  const lines: string[] = []
  for (let y = 0; y < frame.rows; y++) lines.push(frame.chars.slice(y * frame.cols, (y + 1) * frame.cols))
  return lines.join("\n")
}

export async function writePack(options: PackWriteOptions): Promise<string> {
  const id = path.basename(path.resolve(options.dir))
  if (!PACK_ID_PATTERN.test(id)) {
    throw new Error(
      `output folder "${id}" is not a valid pack id: use lowercase letters, digits, "_" or "-", starting with a letter or digit`,
    )
  }
  if (!options.frames[0]) throw new Error("nothing to bake")
  await mkdir(options.dir, { recursive: true })

  if (options.kind === "frames") {
    await rm(path.join(options.dir, "frames"), { recursive: true, force: true })
    await rm(path.join(options.dir, "canvas.txt"), { force: true })
    await rm(path.join(options.dir, "canvas.ans"), { force: true })
    const framesDir = path.join(options.dir, "frames")
    await mkdir(framesDir, { recursive: true })
    for (let index = 0; index < options.frames.length; index++) {
      const frame = options.frames[index]
      const base = String(index).padStart(3, "0")
      await writeFile(path.join(framesDir, `${base}.txt`), frameText(frame), "utf8")
      if (frame.colors && options.palette?.length) {
        await writeFile(path.join(framesDir, `${base}.ans`), sidecar(frame, options.palette), "utf8")
      }
    }
    // Remove a stale sidecar if a later mono bake reused the folder.
    const entries = await readdir(framesDir)
    for (const name of entries) {
      if (!name.endsWith(".ans")) continue
      const base = name.slice(0, -4)
      if (!options.frames.some((frame) => frame.colors) || !(options.palette?.length)) {
        await rm(path.join(framesDir, name), { force: true })
      } else if (!entries.includes(`${base}.txt`)) {
        await rm(path.join(framesDir, name), { force: true })
      }
    }
  } else {
    await rm(path.join(options.dir, "frames"), { recursive: true, force: true })
    const frame = options.frames[0]
    await writeFile(path.join(options.dir, "canvas.txt"), frameText(frame), "utf8")
    if (frame.colors && options.palette?.length) {
      await writeFile(path.join(options.dir, "canvas.ans"), sidecar(frame, options.palette), "utf8")
    } else {
      await rm(path.join(options.dir, "canvas.ans"), { force: true })
    }
  }

  const hasColor = options.frames.some((frame) => frame.colors) && (options.palette?.length ?? 0) > 0
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    id,
    name: options.name,
    fps: options.fps,
    cols: options.cols,
    rows: options.rows,
    defaultStyle: hasColor ? "original" : "mono",
    ramp: options.ramp,
    ...(options.description ? { description: options.description } : {}),
    ...(options.author ? { author: options.author } : {}),
    ...(options.license ? { license: options.license } : {}),
    ...(options.declaredPalette && options.declaredPalette.length >= 2 && options.declaredPalette.length <= 32
      ? { palette: options.declaredPalette.map(rgbToHex) }
      : {}),
    ...(options.kind === "frames" ? { frames: "frames" } : { canvas: "canvas.txt" }),
    source: options.source,
  }
  await writeFile(path.join(options.dir, "art.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return id
}
