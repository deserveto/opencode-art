import path from "node:path"
import { CAPS, EFFECT_TYPES, FIT_MODES, PACK_ID_PATTERN, SCHEMA_VERSION, STYLE_NAMES } from "./types.ts"
import type {
  EffectSpec,
  EffectType,
  FitMode,
  Manifest,
  PackError,
  PackErrorCode,
  PackSource,
  StyleName,
} from "./types.ts"
import { describeChar, isWidthOne } from "./grid.ts"
import { readTextFile } from "./fsutil.ts"

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const DEFAULT_RAMP = " .:-=+*#%@"
const FORMATS = /\p{Cf}/u

const KNOWN_FIELDS = new Set([
  "schemaVersion",
  "id",
  "name",
  "description",
  "author",
  "license",
  "homepage",
  "fps",
  "cols",
  "rows",
  "defaultStyle",
  "fit",
  "ramp",
  "palette",
  "frames",
  "canvas",
  "effects",
  "source",
])

const KNOWN_EFFECT_FIELDS = new Set(["type", "intensity", "speed", "seed", "axis"])

type Dict = Record<string, unknown>

function asRecord(value: unknown): Dict | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Dict) : null
}

function charLength(value: string): number {
  return [...value].length
}

export function isPrintableText(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return false
    if (code === 0x2028 || code === 0x2029 || FORMATS.test(char)) return false
  }
  return true
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

function parseEffect(
  value: unknown,
  index: number,
  fail: (code: PackErrorCode, message: string) => void,
  warnings: string[],
): EffectSpec | undefined {
  const field = `effects[${index}]`
  const record = asRecord(value)
  if (record === null) {
    fail("effects", `"${field}": must be an object`)
    return undefined
  }
  for (const key of Object.keys(record)) {
    if (!KNOWN_EFFECT_FIELDS.has(key)) warnings.push(`art.json: unknown field "${field}.${key}" ignored`)
  }
  const rawType = record.type
  const type = typeof rawType === "string" ? EFFECT_TYPES.find((name) => name === rawType) : undefined
  if (type === undefined) {
    fail("effects", `"${field}.type": must be one of ${EFFECT_TYPES.join(", ")}`)
    return undefined
  }
  const spec: {
    type: EffectType
    intensity?: number
    speed?: number
    seed?: number
    axis?: "x" | "y"
  } = { type }

  if (record.intensity !== undefined) {
    if (typeof record.intensity !== "number" || !Number.isFinite(record.intensity) || record.intensity < 0 || record.intensity > 1) {
      fail("effects", `"${field}.intensity": must be a number between 0 and 1`)
    } else {
      spec.intensity = record.intensity
    }
  }
  if (record.speed !== undefined) {
    if (typeof record.speed !== "number" || !Number.isFinite(record.speed) || record.speed < 0 || record.speed > 4) {
      fail("effects", `"${field}.speed": must be a number between 0 and 4`)
    } else {
      spec.speed = record.speed
    }
  }
  if (record.seed !== undefined) {
    if (typeof record.seed !== "number" || !Number.isSafeInteger(record.seed)) {
      fail("effects", `"${field}.seed": must be an integer`)
    } else {
      spec.seed = record.seed
    }
  }
  if (record.axis !== undefined) {
    if (record.axis !== "x" && record.axis !== "y") {
      fail("effects", `"${field}.axis": must be "x" or "y"`)
    } else {
      spec.axis = record.axis
    }
  }
  return spec
}

/** Validate a parsed `art.json` value and apply defaults. Pure. */
export function parseManifest(
  raw: unknown,
  folderName: string,
): { manifest?: Manifest; errors: PackError[]; warnings: string[] } {
  const errors: PackError[] = []
  const warnings: string[] = []
  const fail = (code: PackErrorCode, message: string): void => {
    errors.push({ file: "art.json", code, message })
  }

  const record = asRecord(raw)
  if (record === null) {
    fail("schema", "art.json must contain a JSON object")
    return { errors, warnings }
  }
  for (const key of Object.keys(record)) {
    if (!KNOWN_FIELDS.has(key)) warnings.push(`art.json: unknown field "${key}" ignored`)
  }

  let schemaVersion = 0
  if (typeof record.schemaVersion !== "number" || !Number.isInteger(record.schemaVersion) || record.schemaVersion < 1) {
    fail("field", `"schemaVersion": must be ${SCHEMA_VERSION}`)
  } else if (record.schemaVersion > SCHEMA_VERSION) {
    fail("schema", "pack requires a newer opencode-art; update the plugin")
  } else {
    schemaVersion = record.schemaVersion
  }

  let id = ""
  if (typeof record.id !== "string") {
    fail("id", `"id" is required and must be a string`)
  } else if (!PACK_ID_PATTERN.test(record.id)) {
    fail("id", `"id": must match ${PACK_ID_PATTERN.source}`)
  } else if (record.id !== folderName) {
    fail("id", `"id": "${record.id}" does not match the folder name "${folderName}"`)
  } else {
    id = record.id
  }

  let name = ""
  if (typeof record.name !== "string") {
    fail("field", `"name" is required and must be a string`)
  } else if (charLength(record.name) < 1 || charLength(record.name) > CAPS.nameLength) {
    fail("field", `"name": must be 1-${CAPS.nameLength} characters`)
  } else if (!isPrintableText(record.name)) {
    fail("field", `"name": must contain printable characters only`)
  } else {
    name = record.name
  }

  const textField = (field: string, value: unknown, maxLength: number, printableOnly: boolean): string | undefined => {
    if (value === undefined) return undefined
    if (typeof value !== "string") {
      fail("field", `"${field}": must be a string`)
      return undefined
    }
    if (charLength(value) > maxLength) {
      fail("field", `"${field}": must be at most ${maxLength} characters`)
      return undefined
    }
    if (printableOnly && !isPrintableText(value)) {
      fail("field", `"${field}": must contain printable characters only`)
      return undefined
    }
    return value
  }

  const description = textField("description", record.description, CAPS.descriptionLength, true)
  const author = textField("author", record.author, CAPS.authorLength, true)
  const license = textField("license", record.license, CAPS.licenseLength, true)

  let homepage: string | undefined
  if (record.homepage !== undefined) {
    if (typeof record.homepage !== "string") {
      fail("field", `"homepage": must be a string`)
    } else if (charLength(record.homepage) > CAPS.homepageLength) {
      fail("field", `"homepage": must be at most ${CAPS.homepageLength} characters`)
    } else if (!record.homepage.startsWith("https://") || !isHttpsUrl(record.homepage)) {
      fail("field", `"homepage": must be an https:// URL`)
    } else {
      homepage = record.homepage
    }
  }

  let fps = 0
  if (typeof record.fps !== "number" || !Number.isFinite(record.fps) || record.fps < 1 || record.fps > CAPS.fps) {
    fail("field", `"fps": must be a number between 1 and ${CAPS.fps}`)
  } else {
    fps = record.fps
  }

  let cols = 0
  if (!isIntegerInRange(record.cols, 1, CAPS.cols)) {
    fail("field", `"cols": must be an integer between 1 and ${CAPS.cols}`)
  } else {
    cols = record.cols
  }

  let rows = 0
  if (!isIntegerInRange(record.rows, 1, CAPS.rows)) {
    fail("field", `"rows": must be an integer between 1 and ${CAPS.rows}`)
  } else {
    rows = record.rows
  }

  let defaultStyle: StyleName = "mono"
  if (record.defaultStyle !== undefined) {
    const rawStyle = record.defaultStyle
    const style = typeof rawStyle === "string" ? STYLE_NAMES.find((name) => name === rawStyle) : undefined
    if (style === undefined) {
      fail("field", `"defaultStyle": must be one of ${STYLE_NAMES.join(", ")}`)
    } else {
      defaultStyle = style
    }
  }

  let fit: FitMode | undefined
  if (record.fit !== undefined) {
    const rawFit = record.fit
    const parsedFit = typeof rawFit === "string" ? FIT_MODES.find((mode) => mode === rawFit) : undefined
    if (parsedFit === undefined) {
      fail("field", `"fit": must be one of ${FIT_MODES.join(", ")}`)
    } else {
      fit = parsedFit
    }
  }

  let ramp = DEFAULT_RAMP
  if (record.ramp !== undefined) {
    if (typeof record.ramp !== "string") {
      fail("field", `"ramp": must be a string`)
    } else {
      const glyphs = [...record.ramp]
      if (glyphs.length < 2 || glyphs.length > CAPS.rampGlyphs) {
        fail("cap", `"ramp": must have 2-${CAPS.rampGlyphs} glyphs`)
      } else {
        const seen = new Set<string>()
        let valid = true
        for (const glyph of glyphs) {
          if (!isWidthOne(glyph)) {
            fail("field", `"ramp": ${describeChar(glyph)} is not a width-1 printable character`)
            valid = false
            break
          }
          if (seen.has(glyph)) {
            fail("field", `"ramp": glyph ${JSON.stringify(glyph)} is duplicated`)
            valid = false
            break
          }
          seen.add(glyph)
        }
        if (valid) ramp = record.ramp
      }
    }
  }

  let palette: readonly string[] | undefined
  if (record.palette !== undefined) {
    if (!Array.isArray(record.palette)) {
      fail("field", `"palette": must be an array of #rrggbb colors`)
    } else if (record.palette.length < 2 || record.palette.length > CAPS.paletteStops) {
      fail("cap", `"palette": must have 2-${CAPS.paletteStops} stops`)
    } else {
      const stops: string[] = []
      let valid = true
      for (const stop of record.palette) {
        if (typeof stop !== "string" || !COLOR_PATTERN.test(stop)) {
          fail("field", `"palette": every stop must be a #rrggbb color`)
          valid = false
          break
        }
        stops.push(stop)
      }
      if (valid) palette = stops
    }
  }

  let frames: string | undefined
  if (record.frames !== undefined) {
    if (typeof record.frames !== "string" || record.frames.length === 0) {
      fail("field", `"frames": must be a non-empty relative directory`)
    } else {
      frames = record.frames
    }
  }

  let canvas: string | undefined
  if (record.canvas !== undefined) {
    if (typeof record.canvas !== "string" || record.canvas.length === 0) {
      fail("field", `"canvas": must be a non-empty relative .txt file`)
    } else if (!record.canvas.endsWith(".txt")) {
      fail("field", `"canvas": must point at a .txt file`)
    } else {
      canvas = record.canvas
    }
  }

  if ((frames === undefined) === (canvas === undefined)) {
    fail("field", `exactly one of "frames" or "canvas" is required`)
  }

  let effects: readonly EffectSpec[] = []
  if (record.effects !== undefined) {
    if (frames !== undefined) fail("effects", `"effects" is only valid with "canvas", not "frames"`)
    if (!Array.isArray(record.effects)) {
      fail("field", `"effects": must be an array`)
    } else {
      if (record.effects.length > CAPS.effects) {
        fail("cap", `"effects": at most ${CAPS.effects} effects are allowed`)
      }
      const specs: EffectSpec[] = []
      for (let index = 0; index < record.effects.length; index++) {
        const spec = parseEffect(record.effects[index], index, fail, warnings)
        if (spec !== undefined) specs.push(spec)
      }
      effects = specs
    }
  }

  let source: PackSource | undefined
  const rawSource = asRecord(record.source)
  if (rawSource !== null) {
    const parsed: { type?: string; file?: string; note?: string } = {}
    if (typeof rawSource.type === "string") parsed.type = rawSource.type
    if (typeof rawSource.file === "string") parsed.file = rawSource.file
    if (typeof rawSource.note === "string") parsed.note = rawSource.note
    if (parsed.type !== undefined || parsed.file !== undefined || parsed.note !== undefined) source = parsed
  }

  if (errors.length > 0) return { errors, warnings }

  return {
    manifest: {
      schemaVersion,
      id,
      name,
      description,
      author,
      license,
      homepage,
      fps,
      cols,
      rows,
      defaultStyle,
      ...(fit !== undefined ? { fit } : {}),
      ramp,
      palette,
      frames,
      canvas,
      effects,
      source,
    },
    errors,
    warnings,
  }
}

function jsonError(text: string, cause: unknown): PackError {
  const message = cause instanceof Error ? cause.message : String(cause)
  let line: number | undefined
  const lineMatch = /\bline (\d+) column (\d+)/.exec(message)
  if (lineMatch) {
    line = Number(lineMatch[1])
  } else {
    const positionMatch = /position (\d+)/.exec(message)
    if (positionMatch) line = text.slice(0, Number(positionMatch[1])).split("\n").length
  }
  return { file: "art.json", line, code: "json", message: `invalid JSON: ${message}` }
}

/** Read and validate `art.json` from a pack directory. Never throws. */
export async function readManifest(
  dir: string,
  folderName: string,
): Promise<{ manifest?: Manifest; errors: PackError[]; warnings: string[]; bytes: number }> {
  const read = await readTextFile(path.join(dir, "art.json"), "art.json", CAPS.frameBytes)
  if (read.error !== undefined) return { errors: [read.error], warnings: [], bytes: read.size }
  const text = read.text ?? ""
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (cause) {
    return { errors: [jsonError(text, cause)], warnings: [], bytes: read.size }
  }
  const parsed = parseManifest(raw, folderName)
  return { ...parsed, bytes: read.size }
}
