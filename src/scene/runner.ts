// Scene runner. Executed only by the authoring CLI in a child process.
// Loads one untrusted scene module, samples fixed timesteps, and writes JSON
// for the parent to validate and turn into a pack.
import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { isWidthOne } from "../art/grid.ts"
import * as helpers from "./index.ts"

const MAX_COLS = 400
const MAX_ROWS = 200
const MAX_FRAMES = 600
const MAX_FPS = 30

interface SceneMeta {
  fps: number
  cols: number
  rows: number
  loop: number
  name?: string
}

interface SceneResult {
  chars: string[]
  colors?: Array<Array<string | null>>
}

function fail(message: string): never {
  throw new Error(message)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function positiveInt(value: unknown, fallback: number, label: string, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    fail(`${label} must be an integer from 1 to ${max}`)
  }
  return value
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === "" || value === "-") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalize(result: unknown, cols: number, rows: number): SceneResult {
  if (Array.isArray(result)) {
    return { chars: validateChars(result, cols, rows) }
  }
  const record = asRecord(result)
  if (record === null || !Array.isArray(record.chars)) {
    fail("scene() must return string[] or { chars: string[], colors?: ... }")
  }
  const chars = validateChars(record.chars, cols, rows)
  if (record.colors === undefined) return { chars }
  if (!Array.isArray(record.colors) || record.colors.length !== rows) {
    fail(`colors must be an array of ${rows} rows`)
  }
  const colors: Array<Array<string | null>> = []
  for (let y = 0; y < rows; y++) {
    const row = record.colors[y]
    if (!Array.isArray(row) || row.length !== cols) fail(`colors[${y}] must have ${cols} entries`)
    colors.push(
      row.map((cell: unknown) => {
        if (cell === null || cell === undefined) return null
        if (typeof cell !== "string" || !/^#[0-9a-fA-F]{6}$/.test(cell)) {
          fail(`colors[${y}] must contain #rrggbb strings or null`)
        }
        return cell.toLowerCase()
      }),
    )
  }
  return { chars, colors }
}

function validateChars(value: unknown[], cols: number, rows: number): string[] {
  if (value.length !== rows) fail(`scene returned ${value.length} rows, expected ${rows}`)
  const lines: string[] = []
  for (let y = 0; y < rows; y++) {
    const line = value[y]
    if (typeof line !== "string") fail(`row ${y + 1} must be a string`)
    if (line.length !== cols) fail(`row ${y + 1} has ${line.length} columns, expected ${cols}`)
    for (const char of line) {
      if (!isWidthOne(char)) fail(`row ${y + 1} contains a non-width-1 character ${JSON.stringify(char)}`)
    }
    lines.push(line)
  }
  return lines
}

async function main(): Promise<void> {
  const [scenePath, outPath, fpsArg, colsArg, rowsArg, loopArg, paletteArg] = process.argv.slice(2)
  if (!scenePath || !outPath) fail("runner usage: runner.ts <scene> <out.json> [fps cols rows loop palette]")

  const module = (await import(pathToFileURL(scenePath).href)) as Record<string, unknown>
  const rawMeta = asRecord(module.meta)
  if (rawMeta === null) fail("scene.mjs must export const meta = { fps, cols, rows }")
  const meta: SceneMeta = {
    fps: positiveInt(optionalNumber(fpsArg) ?? rawMeta.fps, 10, "fps", MAX_FPS),
    cols: positiveInt(optionalNumber(colsArg) ?? rawMeta.cols, 180, "cols", MAX_COLS),
    rows: positiveInt(optionalNumber(rowsArg) ?? rawMeta.rows, 50, "rows", MAX_ROWS),
    loop: optionalNumber(loopArg) ?? (typeof rawMeta.loop === "number" ? rawMeta.loop : 6),
    name: typeof rawMeta.name === "string" ? rawMeta.name : undefined,
  }
  if (!(meta.loop > 0) || !Number.isFinite(meta.loop)) fail("loop must be a positive number of seconds")

  const scene = module.scene
  if (typeof scene !== "function") fail("scene.mjs must export function scene(t, ctx)")

  const total = Math.min(MAX_FRAMES, Math.max(1, Math.round(meta.loop * meta.fps)))
  const palette = (paletteArg ?? "")
    .split(",")
    .map((stop) => stop.trim())
    .filter(Boolean)
  const frames: SceneResult[] = []
  for (let frame = 0; frame < total; frame++) {
    const context = {
      cols: meta.cols,
      rows: meta.rows,
      frame,
      fps: meta.fps,
      palette,
      seed: 0,
      helpers,
    }
    const result = await (scene as (t: number, ctx: unknown) => unknown)(frame / meta.fps, context)
    frames.push(normalize(result, meta.cols, meta.rows))
  }

  writeFileSync(outPath, JSON.stringify({ meta, frames }), "utf8")
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
