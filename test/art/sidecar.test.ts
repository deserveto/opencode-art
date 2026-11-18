import assert from "node:assert/strict"
import test from "node:test"
import { parseSidecar } from "../../src/art/index.ts"
import type { Grid } from "../../src/art/index.ts"

function grid(chars: string): Grid {
  const rows = chars.split("\n")
  return { cols: rows[0].length, rows: rows.length, chars: rows.join(""), colors: null }
}

const ESC = "\u001b"

function colorsOf(result: { colors?: Uint8Array }): number[] {
  assert.ok(result.colors)
  return Array.from(result.colors)
}

test("no escapes parses as a plain color-free sidecar", () => {
  const result = parseSidecar("abcd\nefgh\n", grid("abcd\nefgh"), "x.ans")
  assert.deepEqual(result.errors, [])
  assert.equal(result.colors, undefined)
})

test("truecolor foreground is parsed per cell", () => {
  const result = parseSidecar(`${ESC}[38;2;1;2;3mabcd\nefgh${ESC}[0m`, grid("abcd\nefgh"), "x.ans")
  assert.deepEqual(result.errors, [])
  assert.deepEqual(colorsOf(result).slice(0, 6), [1, 2, 3, 1, 2, 3])
  assert.deepEqual(colorsOf(result).slice(-3), [1, 2, 3])
})

test("basic and bright foreground colors are parsed", () => {
  const result = parseSidecar(`${ESC}[31ma${ESC}[90mb${ESC}[97mc${ESC}[39md`, grid("abcd"), "x.ans")
  assert.deepEqual(result.errors, [])
  assert.deepEqual(colorsOf(result), [128, 0, 0, 128, 128, 128, 255, 255, 255, 0, 0, 0])
})

test("256-color foreground is mapped to RGB", () => {
  const result = parseSidecar(`${ESC}[38;5;196mabcd`, grid("abcd"), "x.ans")
  assert.deepEqual(result.errors, [])
  assert.deepEqual(colorsOf(result).slice(0, 3), [255, 0, 0])
})

test("reset sequences end the color run", () => {
  const reset0 = parseSidecar(`${ESC}[31mab${ESC}[0mcd`, grid("abcd"), "x.ans")
  assert.deepEqual(colorsOf(reset0), [128, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 0])
  const reset39 = parseSidecar(`${ESC}[31mab${ESC}[39mcd`, grid("abcd"), "x.ans")
  assert.deepEqual(colorsOf(reset39), [128, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 0])
})

test("CRLF in a sidecar is layout, not a cell", () => {
  const result = parseSidecar(`${ESC}[32mabcd\r\nefgh\r\n`, grid("abcd\nefgh"), "x.ans")
  assert.deepEqual(result.errors, [])
  assert.equal(colorsOf(result).length, 24)
})

test("background colors are stripped with a warning", () => {
  const result = parseSidecar(`${ESC}[48;5;0mabcd\nefgh${ESC}[0m`, grid("abcd\nefgh"), "x.ans")
  assert.deepEqual(result.errors, [])
  assert.equal(result.colors, undefined)
  assert.match(result.warnings.join("\n"), /unsupported SGR/)
})

test("bold and other SGR outside the allowlist are stripped with a warning", () => {
  const result = parseSidecar(`${ESC}[1mabcd\nefgh`, grid("abcd\nefgh"), "x.ans")
  assert.deepEqual(result.errors, [])
  assert.equal(result.colors, undefined)
  assert.match(result.warnings.join("\n"), /unsupported SGR/)
})

test("an unsupported SGR leaves the current color alone", () => {
  const result = parseSidecar(`${ESC}[31mab${ESC}[1mcd`, grid("abcd"), "x.ans")
  assert.deepEqual(result.errors, [])
  assert.deepEqual(colorsOf(result), [128, 0, 0, 128, 0, 0, 128, 0, 0, 128, 0, 0])
})

test("cursor movement and erase sequences are stripped with a warning", () => {
  const result = parseSidecar(`${ESC}[2J${ESC}[1;1Habcd\nefgh`, grid("abcd\nefgh"), "x.ans")
  assert.deepEqual(result.errors, [])
  assert.match(result.warnings.join("\n"), /unsupported escape/)
})

test("OSC hyperlinks are stripped with a warning", () => {
  const text = `${ESC}]8;;https://example.com${ESC}\\abcd\nefgh${ESC}]8;;${ESC}\\`
  const result = parseSidecar(text, grid("abcd\nefgh"), "x.ans")
  assert.deepEqual(result.errors, [])
  assert.match(result.warnings.join("\n"), /unsupported escape/)
})

test("OSC terminated by BEL is stripped", () => {
  const result = parseSidecar(`${ESC}]0;title\u0007abcd`, grid("abcd"), "x.ans")
  assert.deepEqual(result.errors, [])
  assert.match(result.warnings.join("\n"), /unsupported escape/)
})

test("unterminated and incomplete escapes are stripped with a warning", () => {
  const unterminated = parseSidecar("abcd\nefgh" + `${ESC}[38;2`, grid("abcd\nefgh"), "x.ans")
  assert.deepEqual(unterminated.errors, [])
  assert.match(unterminated.warnings.join("\n"), /unterminated/)
  const incomplete = parseSidecar("abcd\nefgh" + ESC, grid("abcd\nefgh"), "x.ans")
  assert.deepEqual(incomplete.errors, [])
  assert.match(incomplete.warnings.join("\n"), /incomplete/)
})

test("a malformed 256-color index is stripped with a warning", () => {
  const result = parseSidecar(`${ESC}[38;5;300mabcd`, grid("abcd"), "x.ans")
  assert.deepEqual(result.errors, [])
  assert.equal(result.colors, undefined)
  assert.match(result.warnings.join("\n"), /unsupported SGR/)
})

test("the stripped sidecar must equal the frame text", () => {
  const result = parseSidecar(`${ESC}[31mabXd\nefgh${ESC}[0m`, grid("abcd\nefgh"), "x.ans")
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0].code, "sidecar")
  assert.equal(result.errors[0].line, 1)
  assert.match(result.errors[0].message, /row 1, column 3/)
})

test("a sidecar with too few cells fails the invariant", () => {
  const result = parseSidecar("abc", grid("abcd"), "x.ans")
  assert.match(result.errors[0].message, /row 1, column 4/)
})

test("unique colors are capped at 4096 per frame", () => {
  const make = (count: number): string => {
    let body = ""
    for (let i = 0; i < count; i++) {
      body += `${ESC}[38;2;${i % 256};${Math.floor(i / 256)};0mA`
    }
    return body
  }
  const atCap = parseSidecar(make(4096), { cols: 4096, rows: 1, chars: "A".repeat(4096), colors: null }, "x.ans")
  assert.deepEqual(atCap.errors, [])

  const overCap = parseSidecar(make(4097), { cols: 4097, rows: 1, chars: "A".repeat(4097), colors: null }, "x.ans")
  assert.equal(overCap.errors[0].code, "cap")
  assert.match(overCap.errors[0].message, /4096/)
})

test("warnings are deduplicated and prefixed with the file", () => {
  const result = parseSidecar(`${ESC}[41ma${ESC}[41mb${ESC}[41mc${ESC}[41md`, grid("abcd"), "frame.ans")
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /^frame\.ans:1:/)
})
