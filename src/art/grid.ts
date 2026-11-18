import type { Grid, PackError } from "./types.ts"

const MARKS = /\p{M}/u
const FORMATS = /\p{Cf}/u

/** East Asian wide/fullwidth ranges that would break the cell grid. */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x1160, 0x11ff],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f1, 0x23f2],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x261d, 0x261d],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f0, 0x26f1],
  [0x26f2, 0x26f3],
  [0x26f4, 0x26f4],
  [0x26f5, 0x26f5],
  [0x26f7, 0x26f9],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x2708, 0x2709],
  [0x270a, 0x270b],
  [0x270c, 0x270d],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2764, 0x2764],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4dc0, 0x4dff],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xd7b0, 0xd7ff],
  [0xe000, 0xf8ff],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
]

function isWide(code: number): boolean {
  return WIDE_RANGES.some(([from, to]) => code >= from && code <= to)
}

/**
 * True for exactly one BMP code unit that a terminal draws in one cell.
 * Rejects surrogate pairs (emoji), control characters, combining marks,
 * zero-width and format characters, and wide/fullwidth glyphs.
 */
export function isWidthOne(char: string): boolean {
  if (char.length !== 1) return false
  const code = char.charCodeAt(0)
  if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return false
  if (code >= 0xd800 && code <= 0xdfff) return false
  if (code === 0x2028 || code === 0x2029) return false
  if (code >= 0xfdd0 && code <= 0xfdef) return false
  if (code === 0xfffe || code === 0xffff) return false
  if (MARKS.test(char) || FORMATS.test(char)) return false
  return !isWide(code)
}

export function describeChar(char: string): string {
  const code = char.codePointAt(0) ?? 0
  const hex = code.toString(16).toUpperCase().padStart(code > 0xffff ? 5 : 4, "0")
  return `${JSON.stringify(char)} (U+${hex})`
}

/**
 * Parse a frame or canvas: LF or CRLF, one optional trailing newline, every
 * line exactly `cols` width-1 printable characters and exactly `rows` lines.
 */
export function parseGrid(
  text: string,
  cols: number,
  rows: number,
  file: string,
): { grid?: Grid; errors: PackError[] } {
  const errors: PackError[] = []
  let body = text.startsWith("\uFEFF") ? text.slice(1) : text
  body = body.replace(/\r\n/g, "\n")
  if (body.endsWith("\n")) body = body.slice(0, -1)
  const lines = body.split("\n")

  const lineCount = lines.length
  if (lineCount !== rows) {
    errors.push({ file, code: "frame", message: `expected ${rows} rows, found ${lineCount}` })
  }
  let reported = 0
  const limit = Math.min(lineCount, rows)
  outer: for (let row = 0; row < limit; row++) {
    const line = lines[row]
    if (line.length !== cols) {
      errors.push({ file, line: row + 1, code: "frame", message: `expected ${cols} columns, found ${line.length}` })
      if (++reported >= 50) break outer
    }
    for (const char of line) {
      if (!isWidthOne(char)) {
        errors.push({
          file,
          line: row + 1,
          code: "frame",
          message: `invalid character ${describeChar(char)}: every cell must be one width-1 printable character`,
        })
        if (++reported >= 50) break outer
        break
      }
    }
  }
  if (reported >= 50) errors.push({ file, code: "frame", message: "too many errors in this file; fix the first ones and validate again" })
  if (errors.length > 0) return { errors }
  return { grid: { cols, rows, chars: lines.join(""), colors: null }, errors }
}
