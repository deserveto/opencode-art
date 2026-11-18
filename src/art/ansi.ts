import { CAPS } from "./types.ts"
import type { Grid, PackError, RGB } from "./types.ts"

const BASE16: readonly RGB[] = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [192, 192, 192],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
]

const CUBE = [0, 95, 135, 175, 215, 255] as const

function xterm256(index: number): RGB {
  if (index < 16) return BASE16[index]
  if (index < 232) {
    const n = index - 16
    return [CUBE[Math.floor(n / 36)], CUBE[Math.floor(n / 6) % 6], CUBE[n % 6]]
  }
  const level = 8 + (index - 232) * 10
  return [level, level, level]
}

function isByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255
}

/**
 * Parse a `.ans` sidecar against its canonical grid. Only foreground SGR is
 * kept; everything else is stripped with a warning. The stripped characters
 * must equal `grid.chars` exactly.
 */
export function parseSidecar(
  text: string,
  grid: Grid,
  file: string,
): { colors?: Uint8Array; warnings: string[]; errors: PackError[] } {
  text = text.replace(/^\uFEFF/, "")
  const warnings: string[] = []
  const errors: PackError[] = []
  const warningSet = new Set<string>()
  const cellCount = grid.cols * grid.rows
  const colors = new Uint8Array(cellCount * 3)
  const chars: string[] = []
  const charLines: number[] = []
  const unique = new Set<number>()
  let current: RGB | null = null
  let sawColor = false
  let cell = 0
  let line = 1

  const warn = (message: string): void => {
    if (warningSet.has(message)) return
    warningSet.add(message)
    warnings.push(`${file}:${line}: ${message}`)
  }

  const apply = (r: number, g: number, b: number): void => {
    unique.add((r << 16) | (g << 8) | b)
    current = [r, g, b]
  }

  const applySgr = (params: string, sequence: string): void => {
    if (params === "0") {
      current = null
      return
    }
    const parts = params.split(";").map(Number)
    if (
      parts.length === 5 &&
      parts[0] === 38 &&
      parts[1] === 2 &&
      isByte(parts[2]) &&
      isByte(parts[3]) &&
      isByte(parts[4])
    ) {
      apply(parts[2], parts[3], parts[4])
      return
    }
    if (parts.length === 3 && parts[0] === 38 && parts[1] === 5 && isByte(parts[2])) {
      const rgb = xterm256(parts[2])
      apply(rgb[0], rgb[1], rgb[2])
      return
    }
    if (parts.length === 1) {
      const n = parts[0]
      if (n >= 30 && n <= 37) {
        const rgb = BASE16[n - 30]
        apply(rgb[0], rgb[1], rgb[2])
        return
      }
      if (n >= 90 && n <= 97) {
        const rgb = BASE16[n - 82]
        apply(rgb[0], rgb[1], rgb[2])
        return
      }
      if (n === 39) {
        current = null
        return
      }
    }
    warn(`stripped unsupported SGR sequence ${JSON.stringify(sequence)}`)
  }

  let i = 0
  while (i < text.length) {
    const code = text.charCodeAt(i)
    if (code === 0x0d && text.charCodeAt(i + 1) === 0x0a) {
      i += 2
      line++
      continue
    }
    if (code === 0x0a) {
      i++
      line++
      continue
    }
    if (code !== 0x1b) {
      chars.push(text[i])
      charLines.push(line)
      if (current !== null) {
        sawColor = true
        if (cell < cellCount) {
          colors[cell * 3] = current[0]
          colors[cell * 3 + 1] = current[1]
          colors[cell * 3 + 2] = current[2]
        }
      }
      cell++
      i++
      continue
    }

    const start = i
    const next = text[i + 1]
    if (next === undefined) {
      warn("stripped incomplete escape sequence")
      i++
      continue
    }
    if (next === "[") {
      let end = i + 2
      while (end < text.length) {
        const byte = text.charCodeAt(end)
        if (byte >= 0x40 && byte <= 0x7e) break
        end++
      }
      if (end >= text.length) {
        warn(`stripped unterminated escape sequence ${JSON.stringify(text.slice(start))}`)
        i = text.length
        continue
      }
      const params = text.slice(i + 2, end)
      const sequence = text.slice(i, end + 1)
      if (text[end] === "m" && /^[0-9;]*$/.test(params)) {
        applySgr(params, sequence)
      } else {
        warn(`stripped unsupported escape ${JSON.stringify(sequence)}`)
      }
      i = end + 1
      continue
    }
    if (next === "]" || next === "P" || next === "^" || next === "_" || next === "X") {
      let end = i + 2
      while (end < text.length) {
        if (text[end] === "\u0007") {
          end++
          break
        }
        if (text[end] === "\u001b" && text[end + 1] === "\\") {
          end += 2
          break
        }
        end++
      }
      warn(`stripped unsupported escape ${JSON.stringify(text.slice(start, end))}`)
      i = end
      continue
    }
    warn(`stripped unsupported escape ${JSON.stringify(text.slice(start, start + 2))}`)
    i += 2
  }

  if (unique.size > CAPS.uniqueColors) {
    errors.push({
      file,
      code: "cap",
      message: `${unique.size} unique colors exceeds the ${CAPS.uniqueColors}-color cap`,
    })
  }

  const stripped = chars.join("")
  if (stripped !== grid.chars) {
    let at = 0
    const limit = Math.min(stripped.length, grid.chars.length)
    while (at < limit && stripped[at] === grid.chars[at]) at++
    const width = Math.max(grid.cols, 1)
    const row = Math.floor(at / width) + 1
    const column = (at % width) + 1
    const message = `sidecar text does not match the frame text at row ${row}, column ${column}`
    const mismatchLine = charLines[at]
    errors.push(
      mismatchLine === undefined
        ? { file, code: "sidecar", message }
        : { file, line: mismatchLine, code: "sidecar", message },
    )
  }

  if (errors.length > 0) return { warnings, errors }
  return sawColor ? { colors, warnings, errors } : { warnings, errors }
}
