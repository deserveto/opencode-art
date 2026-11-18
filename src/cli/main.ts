import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CAPS, FIT_MODES, PACK_ID_PATTERN, isWidthOne, loadPack, validatePackDir } from "../art/index.ts"
import type { FitMode, Pack } from "../art/types.ts"
import { fitGrid } from "../render/fit.ts"
import { flagBool, flagString, parseArgs, unknownFlags, type FlagValue } from "./args.ts"
import { runChild } from "./child.ts"
import { decodeAnimation, decodeStill, extensionOf } from "./media.ts"
import { imageToFrame, sampleAnimation, type GlyphFrame, type GridOptions } from "./pipeline.ts"
import { buildPalette, hexToRgb, type Rgb } from "./quantize.ts"
import { writePack } from "./write.ts"
import { decodeVideo } from "./video.ts"

const BIN = "opencode-art"
const DEFAULT_RAMP = " .:-=+*#%@"
const DEFAULT_COLS = 180
const DEFAULT_ROWS = 50
const DEFAULT_FPS = 10
const DEFAULT_LOOP = 6
const DEFAULT_COLORS = 64
const DEFAULT_ASPECT = 0.5
const DEFAULT_TIMEOUT_S = 60
const SCENE_BUDGET_CELLS = 20_000_000

class CliError extends Error {
  readonly code: number
  constructor(message: string, code = 1) {
    super(message)
    this.code = code
  }
}

const HELP = `opencode-art — author, bake, and validate ASCII art packs

Usage:
  opencode-art init <dir> [--force]
  opencode-art bake <input> --out <dir> [options]
  opencode-art validate <dir>
  opencode-art preview <dir> [--frame N] [--width N] [--animate] [--loops N]
  opencode-art help

Bake input:
  .png .jpg .jpeg .webp   static canvas
  .gif .mp4 .webm .mov    frame sequence (video needs ffmpeg on PATH)
  .mjs .js                deterministic scene, baked in a child process

Bake options:
  --out <dir>       output pack (required)
  --cols <n>        grid width, 1-${CAPS.cols} (default ${DEFAULT_COLS})
  --rows <n>        grid height, 1-${CAPS.rows} (default ${DEFAULT_ROWS})
  --fps <n>         frames per second, 1-${CAPS.fps} (default ${DEFAULT_FPS})
  --loop <s>        seconds for scene, GIF, or video (default ${DEFAULT_LOOP})
  --charset <s>     glyph ramp, low to high density (alias: --ramp)
  --palette <list>  comma-separated #rrggbb stops for color output
  --colors <n>      quantize colors to N entries, 2-256 (default ${DEFAULT_COLORS})
  --dither          Floyd-Steinberg dithering; implies a mono pack
  --mono            force a mono pack (no color sidecars)
  --invert          invert luminance
  --aspect <n>      source aspect correction (default ${DEFAULT_ASPECT})
  --fit <mode>      fit mode: ${FIT_MODES.join(", ")} (default stretch)
  --seed <n>        integer seed passed to scene ctx.seed (default 0)
  --timeout <s>     scene timeout, seconds (default ${DEFAULT_TIMEOUT_S})
  --force           overwrite an output directory that is not a pack

Preview options:
  --frame <n>       frame index to print (default 0)
  --width <n>       output width in columns, 1-${CAPS.cols} (default 80)
  --animate         play all frames in the terminal
  --loops <n>       loop count for --animate, 1-20 (default 1)

Preview prints a still frame (or animates with --animate) to stdout. Validate prints every error with file
and line. Exit codes: 0 success, 1 validation or user error, 2 unexpected.
The plugin never runs scene code; only this CLI does, in a child process.`

function titleCase(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ")
}

function expandHome(value: string): string {
  if (value === "~") return process.env.USERPROFILE ?? process.env.HOME ?? value
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(process.env.USERPROFILE ?? process.env.HOME ?? "~", value.slice(2))
  }
  return value
}

function parseInteger(flags: ReadonlyMap<string, FlagValue>, name: string, fallback: number, min: number, max: number): number {
  const raw = flags.get(name)
  if (raw === undefined) return fallback
  if (typeof raw !== "string" || raw.trim() === "") throw new CliError(`--${name} needs a number`)
  const value = Number(raw)
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new CliError(`--${name} must be an integer from ${min} to ${max}`)
  }
  return value
}

function parseNumber(flags: ReadonlyMap<string, FlagValue>, name: string, fallback: number, min: number, max: number): number {
  const raw = flags.get(name)
  if (raw === undefined) return fallback
  if (typeof raw !== "string" || raw.trim() === "") throw new CliError(`--${name} needs a number`)
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new CliError(`--${name} must be a number from ${min} to ${max}`)
  }
  return value
}

function parseRamp(flags: ReadonlyMap<string, FlagValue>): string {
  const raw = flagString(flags, "ramp") ?? flagString(flags, "charset") ?? DEFAULT_RAMP
  const chars = [...raw]
  if (chars.length < 2 || chars.length > CAPS.rampGlyphs) {
    throw new CliError(`--ramp must contain 2-${CAPS.rampGlyphs} glyphs`)
  }
  if (new Set(chars).size !== chars.length) throw new CliError("--ramp must not repeat a glyph")
  for (const char of chars) {
    if (!isWidthOne(char)) throw new CliError(`--ramp contains a non-width-1 character ${JSON.stringify(char)}`)
  }
  return raw
}

function parseFit(flags: ReadonlyMap<string, FlagValue>): FitMode | undefined {
  const raw = flags.get("fit")
  if (raw === undefined) return undefined
  if (typeof raw !== "string" || !FIT_MODES.includes(raw as FitMode)) {
    throw new CliError(`--fit must be one of ${FIT_MODES.join(", ")}`)
  }
  return raw as FitMode
}

function parsePalette(flags: ReadonlyMap<string, FlagValue>): readonly Rgb[] | undefined {
  const raw = flagString(flags, "palette")
  if (raw === undefined) return undefined
  const stops = raw
    .split(",")
    .map((stop) => stop.trim())
    .filter(Boolean)
  if (stops.length < 2 || stops.length > CAPS.paletteStops) {
    throw new CliError(`--palette needs 2-${CAPS.paletteStops} comma-separated #rrggbb stops`)
  }
  const palette: Rgb[] = []
  for (const stop of stops) {
    const color = hexToRgb(stop)
    if (!color) throw new CliError(`--palette entry "${stop}" is not #rrggbb`)
    palette.push(color)
  }
  return palette
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  )
}

async function prepareOutput(dir: string, force: boolean): Promise<void> {
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true })
    return
  }
  const entries = await readdir(dir)
  if (entries.length === 0 || force) return
  try {
    const manifest = JSON.parse(await readFile(path.join(dir, "art.json"), "utf8")) as { id?: unknown }
    if (manifest.id === path.basename(path.resolve(dir))) return
  } catch {
    // Fall through to the refusal below.
  }
  throw new CliError(`"${dir}" is not empty and is not an opencode-art pack; use --force to overwrite`)
}

function checkFlags(flags: ReadonlyMap<string, FlagValue>, allowed: readonly string[]): void {
  const unknown = unknownFlags(flags, allowed)
  if (unknown.length > 0) throw new CliError(`unknown option${unknown.length > 1 ? "s" : ""}: ${unknown.map((name) => `--${name}`).join(", ")}`)
}

function requirePositional(positionals: readonly string[], index: number, usage: string): string {
  const value = positionals[index]
  if (!value) throw new CliError(`missing argument. Usage: ${usage}`)
  return value
}

function safeText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
}

function formatError(error: { file: string; line?: number; message: string }): string {
  return `${safeText(error.file)}${error.line ? `:${error.line}` : ""}: ${safeText(error.message)}`
}

async function commandInit(positionals: readonly string[], flags: ReadonlyMap<string, FlagValue>): Promise<number> {
  checkFlags(flags, ["force"])
  const dir = path.resolve(expandHome(requirePositional(positionals, 0, "opencode-art init <dir> [--force]")))
  const id = path.basename(dir)
  if (!PACK_ID_PATTERN.test(id)) {
    throw new CliError(
      `folder "${id}" is not a valid pack id. Rename it to lowercase letters, digits, "_" or "-", starting with a letter or digit.`,
    )
  }
  const force = flagBool(flags, "force")
  if (await exists(dir)) {
    const entries = await readdir(dir)
    if (entries.length > 0 && !force) {
      throw new CliError(`"${dir}" is not empty; use --force to replace it`)
    }
    await rm(path.join(dir, "frames"), { recursive: true, force: true })
    await rm(path.join(dir, "canvas.ans"), { force: true })
  }
  await mkdir(dir, { recursive: true })

  const lines = [
    "                                        ",
    "   .------------------------------.     ",
    "   |                              |     ",
    "   |     o p e n c o d e          |     ",
    "   |              a r t           |     ",
    "   |                              |     ",
    "   '------------------------------'     ",
    "        .  .  .  .  .  .  .  .          ",
    "                                        ",
    "                                        ",
  ].map((line) => line.padEnd(40).slice(0, 40))

  const manifest = {
    schemaVersion: 1,
    id,
    name: titleCase(id),
    description: "A new opencode-art pack.",
    license: "CC-BY-4.0",
    fps: 10,
    cols: 40,
    rows: 10,
    defaultStyle: "mono",
    ramp: DEFAULT_RAMP,
    canvas: "canvas.txt",
  }
  await writeFile(path.join(dir, "art.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  await writeFile(path.join(dir, "canvas.txt"), lines.join("\n"), "utf8")
  await writeFile(
    path.join(dir, "README.md"),
    [
      `# ${titleCase(id)}`,
      "",
      "An opencode-art pack.",
      "",
      "1. Edit `canvas.txt` (exactly 40x10) or replace it with a `scene.mjs`.",
      "2. Bake it: `opencode-art bake <input> --out .`",
      "3. Validate: `opencode-art validate .`",
      "4. Preview: `opencode-art preview .`",
      "5. Select it in OpenCode with `/art set " + id + "`.",
      "",
    ].join("\n"),
    "utf8",
  )

  const errors = await validatePackDir(dir)
  if (errors.length > 0) {
    for (const error of errors) console.error(formatError(error))
    return 1
  }
  console.log(`Created pack "${safeText(id)}" in ${safeText(dir)}`)
  return 0
}

async function commandValidate(positionals: readonly string[], flags: ReadonlyMap<string, FlagValue>): Promise<number> {
  checkFlags(flags, [])
  const dir = path.resolve(expandHome(requirePositional(positionals, 0, "opencode-art validate <dir>")))
  const errors = await validatePackDir(dir)
  if (errors.length === 0) {
    console.log(`${safeText(dir)}: valid`)
    return 0
  }
  for (const error of errors) console.log(formatError(error))
  return 1
}

function formatPackFrame(pack: Pack, index: number, width: number): string[] {
  const frame = pack.frames[index]
  if (!frame) throw new CliError(`pack has no frame ${index}`)
  const rows = Math.max(1, Math.min(60, Math.round((pack.manifest.rows * width) / pack.manifest.cols)))
  const grid = fitGrid(frame, width, rows, pack.manifest.fit ?? "stretch")
  const lines: string[] = []
  for (let y = 0; y < grid.rows; y++) {
    lines.push(grid.chars.slice(y * grid.cols, (y + 1) * grid.cols))
  }
  return lines
}

function printPackFrame(pack: Pack, index: number, width: number): void {
  for (const line of formatPackFrame(pack, index, width)) {
    console.log(line)
  }
}

async function commandPreview(positionals: readonly string[], flags: ReadonlyMap<string, FlagValue>): Promise<number> {
  checkFlags(flags, ["frame", "width", "animate", "loops"])
  const dir = path.resolve(
    expandHome(requirePositional(positionals, 0, "opencode-art preview <dir> [--frame N] [--width N] [--animate] [--loops N]")),
  )
  const loaded = await loadPack(dir)
  if (!loaded.ok) {
    for (const error of loaded.error) console.log(formatError(error))
    return 1
  }
  const frame = clampIndex(parseInteger(flags, "frame", 0, -1_000_000, 1_000_000), loaded.value.frames.length)
  const width = parseInteger(flags, "width", 80, 1, CAPS.cols)
  const animate = flagBool(flags, "animate")
  const loops = parseInteger(flags, "loops", 1, 1, 20)
  if (!animate) {
    printPackFrame(loaded.value, frame, width)
    return 0
  }
  const frameCount = loaded.value.frames.length
  const delayMs = Math.max(1, Math.round(1000 / Math.max(1, loaded.value.manifest.fps)))
  for (let loop = 0; loop < loops; loop++) {
    for (let index = 0; index < frameCount; index++) {
      const lines = formatPackFrame(loaded.value, index, width)
      const isLast = loop === loops - 1 && index === frameCount - 1
      if (process.stdout.isTTY) {
        const prefix = loop === 0 && index === 0 ? "\x1b[2J\x1b[H" : "\x1b[H"
        process.stdout.write(`${prefix}${lines.join("\n")}${isLast ? "\n" : ""}`)
      } else {
        if (loop > 0 || index > 0) console.log("")
        console.log(`--- frame ${index + 1}/${frameCount} ---`)
        for (const line of lines) console.log(line)
      }
      if (!isLast) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
  return 0
}

function clampIndex(value: number, length: number): number {
  return Math.max(0, Math.min(Math.max(0, length - 1), value))
}

interface SceneOutput {
  readonly meta: { fps: number; cols: number; rows: number; loop: number; name?: string }
  readonly frames: Array<{ chars: string[]; colors?: Array<Array<string | null>> }>
}

async function bakeScene(
  input: string,
  flags: ReadonlyMap<string, FlagValue>,
  timeoutMs: number,
): Promise<{ frames: GlyphFrame[]; meta: SceneOutput["meta"]; palette?: readonly Rgb[] }> {
  const runner = fileURLToPath(new URL("../scene/runner.ts", import.meta.url))
  const stripHook = fileURLToPath(new URL("../../bin/strip-ts.cjs", import.meta.url))
  const temp = await mkdtemp(path.join(tmpdir(), "opencode-art-scene-"))
  const output = path.join(temp, "frames.json")
  const pass = (name: string): string => flagString(flags, name) ?? "-"
  const paletteArg = flagString(flags, "palette") ?? ""
  try {
    const result = await runChild(
      process.execPath,
      ["--require", stripHook, runner, input, output, pass("fps"), pass("cols"), pass("rows"), pass("loop"), paletteArg, pass("seed")],
      {
        timeoutMs,
        collectStdout: false,
        env: {
          ...process.env,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=512`.trim(),
        },
      },
    )
    if (result.timedOut) throw new CliError(`scene timed out after ${Math.round(timeoutMs / 1000)}s`)
    if (result.code !== 0) {
      const detail = result.stderr.trim().split("\n").filter(Boolean).slice(-3).join("\n")
      throw new CliError(`scene failed${detail ? `: ${detail}` : ""}`)
    }
    const outputInfo = await stat(output).catch(() => null)
    if (!outputInfo) throw new CliError("scene produced no output; it exited without writing frames")
    if (outputInfo.size > 64 * 1024 * 1024) throw new CliError("scene output is larger than 64 MB; reduce the grid or frames")
    let raw: SceneOutput
    try {
      raw = JSON.parse(await readFile(output, "utf8")) as SceneOutput
    } catch (error) {
      throw new CliError(`scene bake failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!raw.meta || !Array.isArray(raw.frames) || raw.frames.length === 0) throw new CliError("scene produced no frames")
    if (raw.frames.length > CAPS.frames) throw new CliError(`scene produced ${raw.frames.length} frames; the cap is ${CAPS.frames}`)
    if (raw.meta.cols * raw.meta.rows * raw.frames.length > SCENE_BUDGET_CELLS) {
      throw new CliError("scene grid is too large for the pack cap; reduce cols, rows, or loop")
    }

    const anyColors = raw.frames.some((frame) => frame.colors !== undefined)
    if (anyColors && !raw.frames.every((frame) => frame.colors !== undefined)) {
      throw new CliError("scene returned colors for some frames but not all; color sidecars are all-or-nothing")
    }
    const frames: GlyphFrame[] = raw.frames.map((frame) => {
      const chars = frame.chars.join("")
      if (chars.length !== raw.meta.cols * raw.meta.rows) throw new CliError("scene frame dimensions do not match meta")
      if (!frame.colors) return { cols: raw.meta.cols, rows: raw.meta.rows, chars, colors: null }
      const colors = new Uint8Array(raw.meta.cols * raw.meta.rows * 3)
      for (let y = 0; y < raw.meta.rows; y++) {
        const row: Array<string | null> | undefined = frame.colors[y]
        if (!row || row.length !== raw.meta.cols) throw new CliError("scene colors do not match meta")
        for (let x = 0; x < raw.meta.cols; x++) {
          const hex = row[x]
          if (!hex) continue
          const rgb = hexToRgb(hex)
          if (!rgb) throw new CliError(`scene returned an invalid color "${hex}"`)
          const index = (y * raw.meta.cols + x) * 3
          colors[index] = rgb.r
          colors[index + 1] = rgb.g
          colors[index + 2] = rgb.r === 0 && rgb.g === 0 && rgb.b === 0 ? 1 : rgb.b
        }
      }
      return { cols: raw.meta.cols, rows: raw.meta.rows, chars, colors }
    })
    return { frames, meta: raw.meta, palette: parsePalette(flags) }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

function collectSamples(frames: readonly GlyphFrame[]): Uint8Array {
  let cells = 0
  for (const frame of frames) {
    if (!frame.colors) continue
    for (let index = 0; index < frame.chars.length; index++) {
      if (frame.chars[index] === " ") continue
      if (frame.colors[index * 3] === 0 && frame.colors[index * 3 + 1] === 0 && frame.colors[index * 3 + 2] === 0) continue
      cells++
    }
  }
  const stride = Math.max(1, Math.floor(cells / 400_000))
  const sampleCount = Math.ceil(cells / stride)
  const samples = new Uint8Array(Math.max(3, sampleCount * 3))
  let offset = 0
  let seen = 0
  for (const frame of frames) {
    if (!frame.colors) continue
    for (let index = 0; index < frame.chars.length; index++) {
      if (frame.chars[index] === " ") continue
      const r = frame.colors[index * 3]
      const g = frame.colors[index * 3 + 1]
      const b = frame.colors[index * 3 + 2]
      if (r === 0 && g === 0 && b === 0) continue
      seen++
      if (seen % stride !== 0) continue
      if (offset + 3 > samples.length) break
      samples[offset] = r
      samples[offset + 1] = g
      samples[offset + 2] = b
      offset += 3
    }
  }
  return samples.slice(0, offset)
}

function sourceKind(input: string): "scene" | "image" | "gif" | "video" {
  const extension = extensionOf(input)
  if (extension === "mjs" || extension === "js") return "scene"
  if (extension === "gif") return "gif"
  if (extension === "mp4" || extension === "webm" || extension === "mov") return "video"
  if (extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "webp") return "image"
  throw new CliError(`unsupported input ".${extension}"; use PNG, JPEG, WebP, GIF, video, or a .mjs scene`)
}

async function attempt<T>(label: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function commandBake(positionals: readonly string[], flags: ReadonlyMap<string, FlagValue>): Promise<number> {
  checkFlags(flags, [
    "out",
    "cols",
    "rows",
    "fps",
    "loop",
    "charset",
    "ramp",
    "palette",
    "colors",
    "dither",
    "mono",
    "invert",
    "aspect",
    "force",
    "timeout",
    "seed",
    "fit",
  ])
  const input = path.resolve(expandHome(requirePositional(positionals, 0, "opencode-art bake <input> --out <dir>")))
  const outFlag = flagString(flags, "out")
  if (!outFlag) throw new CliError("missing --out <dir>")
  const out = path.resolve(expandHome(outFlag))
  const cols = parseInteger(flags, "cols", DEFAULT_COLS, 1, CAPS.cols)
  const rows = parseInteger(flags, "rows", DEFAULT_ROWS, 1, CAPS.rows)
  const fps = parseInteger(flags, "fps", DEFAULT_FPS, 1, CAPS.fps)
  const loop = parseNumber(flags, "loop", DEFAULT_LOOP, 0.1, 600)
  const colors = parseInteger(flags, "colors", DEFAULT_COLORS, 2, 256)
  const aspect = parseNumber(flags, "aspect", DEFAULT_ASPECT, 0.05, 4)
  parseInteger(flags, "seed", 0, -2_147_483_648, 2_147_483_647)
  const fit = parseFit(flags)
  const ramp = parseRamp(flags)
  const declaredPalette = parsePalette(flags)
  const dither = flagBool(flags, "dither")
  const mono = flagBool(flags, "mono") || dither
  if (mono && declaredPalette) throw new CliError("--mono and --dither produce a mono pack; remove --palette")
  const timeoutSeconds = parseNumber(flags, "timeout", DEFAULT_TIMEOUT_S, 1, 3600)
  const envTimeout = Number(process.env.OPENCODE_ART_SCENE_TIMEOUT_MS)
  const timeoutMs = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : timeoutSeconds * 1000
  if (!(await exists(input))) throw new CliError(`input "${input}" does not exist`)

  const kind = sourceKind(input)
  const gridOptions: GridOptions = { cols, rows, ramp, aspect, invert: flagBool(flags, "invert"), dither, color: !mono }
  let frames: GlyphFrame[]
  let name = titleCase(path.basename(out))
  let outputKind: "canvas" | "frames" = "canvas"
  let palette = declaredPalette
  let sceneMeta: SceneOutput["meta"] | null = null

  if (kind === "scene") {
    const baked = await bakeScene(input, flags, timeoutMs)
    frames = baked.frames
    sceneMeta = baked.meta
    if (baked.meta.name) name = baked.meta.name
    outputKind = "frames"
    palette = baked.palette ?? declaredPalette
    if (dither || mono) {
      frames = frames.map((frame) => ({ ...frame, colors: null }))
      palette = undefined
    }
  } else if (kind === "image") {
    const image = await attempt("could not decode the image", () => decodeStill(input))
    frames = [imageToFrame(image, gridOptions)]
    outputKind = "canvas"
  } else if (kind === "gif") {
    const animated = await attempt("could not decode the GIF", () => decodeAnimation(input))
    const sampled = sampleAnimation(animated.width, animated.height, animated.frames, animated.delays, fps, loop)
    frames = sampled.map((image) => imageToFrame(image, gridOptions))
    outputKind = "frames"
  } else {
    const images = await attempt("could not decode the video", () =>
      decodeVideo(input, { cols, rows, fps, loop, timeoutMs: Math.max(timeoutMs, 120_000) }),
    )
    frames = images.map((image) => imageToFrame(image, gridOptions))
    outputKind = "frames"
  }

  const actualCols = frames[0]?.cols ?? cols
  const actualRows = frames[0]?.rows ?? rows
  const actualFps = sceneMeta?.fps ?? fps
  if (frames.length > CAPS.frames) throw new CliError(`bake produced ${frames.length} frames; the cap is ${CAPS.frames}`)
  if (actualCols * actualRows * frames.length > SCENE_BUDGET_CELLS) {
    throw new CliError("output is too large for the pack cap; reduce cols, rows, or loop")
  }

  const hasColor = frames.some((frame) => frame.colors !== null)
  if (hasColor && !palette) {
    const samples = collectSamples(frames)
    palette = buildPalette(samples, colors)
  }
  if (!hasColor) palette = undefined

  // Prepare late so a failed decode or a cap breach leaves no empty output
  // directory behind.
  await prepareOutput(out, flagBool(flags, "force"))
  const id = await attempt("could not write the pack", () =>
    writePack({
      dir: out,
      name,
      description: sceneMeta ? "Baked by opencode-art." : undefined,
      fps: actualFps,
      cols: actualCols,
      rows: actualRows,
      ramp,
      fit,
      kind: outputKind,
      frames,
      palette,
      declaredPalette,
      source: {
        type: kind,
        file: path.basename(input),
        note: kind === "scene" ? "Baked by opencode-art in a child process" : "Converted by opencode-art",
      },
    }),
  )

  const errors = await validatePackDir(out)
  if (errors.length > 0) {
    for (const error of errors) console.error(formatError(error))
    return 1
  }
  console.log(
    `Baked ${frames.length} ${outputKind === "canvas" ? "canvas" : `frame${frames.length === 1 ? "" : "s"}`} ` +
      `(${actualCols}x${actualRows}, ${actualFps} fps${hasColor ? ", color" : ", mono"}) into ${safeText(out)} as "${safeText(id)}"`,
  )
  return 0
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    const args = parseArgs(argv)
    if (flagBool(args.flags, "help") || !args.command || args.command === "help") {
      console.log(HELP)
      return 0
    }
    switch (args.command) {
      case "init":
        return await commandInit(args.positionals, args.flags)
      case "bake":
        return await commandBake(args.positionals, args.flags)
      case "validate":
        return await commandValidate(args.positionals, args.flags)
      case "preview":
        return await commandPreview(args.positionals, args.flags)
      default:
        throw new CliError(`unknown command "${args.command}". Run opencode-art help.`)
    }
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`${BIN}: ${safeText(error.message)}`)
      return error.code
    }
    console.error(`${BIN}: ${safeText(error instanceof Error ? error.message : String(error))}`)
    return 2
  }
}
