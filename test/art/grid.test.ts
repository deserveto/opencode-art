import assert from "node:assert/strict"
import test from "node:test"
import { isWidthOne, parseGrid } from "../../src/art/index.ts"

const messages = (errors: readonly { message: string }[]): string => errors.map((entry) => entry.message).join("\n")

test("parses a plain grid", () => {
  const result = parseGrid("abcd\nefgh\n", 4, 2, "a.txt")
  assert.deepEqual(result.errors, [])
  assert.equal(result.grid?.cols, 4)
  assert.equal(result.grid?.rows, 2)
  assert.equal(result.grid?.chars, "abcdefgh")
  assert.equal(result.grid?.colors, null)
})

test("CRLF is normalized and one trailing newline is stripped", () => {
  const result = parseGrid("abcd\r\nefgh\r\n", 4, 2, "a.txt")
  assert.deepEqual(result.errors, [])
  assert.equal(result.grid?.chars, "abcdefgh")
})

test("a missing trailing newline is fine", () => {
  assert.deepEqual(parseGrid("abcd\nefgh", 4, 2, "a.txt").errors, [])
})

test("a second trailing newline is a row error", () => {
  assert.match(messages(parseGrid("abcd\nefgh\n\n", 4, 2, "a.txt").errors), /expected 2 rows, found 3/)
})

test("trailing spaces are meaningful cells", () => {
  const result = parseGrid("ab  \ncd  \n", 4, 2, "a.txt")
  assert.deepEqual(result.errors, [])
  assert.equal(result.grid?.chars, "ab  cd  ")
})

test("row and column counts must match the manifest", () => {
  assert.match(messages(parseGrid("abcd\n", 4, 2, "a.txt").errors), /expected 2 rows, found 1/)
  assert.match(messages(parseGrid("abc\nefgh\n", 4, 2, "a.txt").errors), /expected 4 columns, found 3/)
  assert.match(messages(parseGrid("abcdefgh\n", 4, 2, "a.txt").errors), /expected 4 columns/)
})

test("tabs are rejected", () => {
  const errors = parseGrid("ab\tc\n", 4, 1, "a.txt").errors
  assert.match(messages(errors), /U\+0009/)
})

test("emoji are rejected even when their code point count fits", () => {
  const errors = parseGrid("ab\u{1F600}de\n", 5, 1, "a.txt").errors
  assert.match(messages(errors), /U\+1F600/)
  assert.match(messages(errors), /width-1/)
})

test("control characters are rejected", () => {
  assert.match(messages(parseGrid("ab\u0000c\n", 4, 1, "a.txt").errors), /U\+0000/)
  assert.match(messages(parseGrid("ab\u007fc\n", 4, 1, "a.txt").errors), /U\+007F/)
  assert.match(messages(parseGrid("ab\u009bc\n", 4, 1, "a.txt").errors), /U\+009B/)
})

test("combining marks are rejected", () => {
  assert.match(messages(parseGrid("e\u0301bc\n", 3, 1, "a.txt").errors), /U\+0301/)
})

test("zero-width and variation selectors are rejected", () => {
  assert.match(messages(parseGrid("a\u200bb\n", 3, 1, "a.txt").errors), /U\+200B/)
  assert.match(messages(parseGrid("a\uFEFFb\n", 3, 1, "a.txt").errors), /U\+FEFF/)
  assert.match(messages(parseGrid("a\uFE0Fb\n", 3, 1, "a.txt").errors), /U\+FE0F/)
})

test("wide and fullwidth characters are rejected", () => {
  assert.match(messages(parseGrid("世界\n", 2, 1, "a.txt").errors), /U\+4E16/)
  assert.match(messages(parseGrid("ＡＢ\n", 2, 1, "a.txt").errors), /U\+FF21/)
})

test("box drawing characters are accepted", () => {
  const result = parseGrid("┌─┐\n└─┘\n", 3, 2, "a.txt")
  assert.deepEqual(result.errors, [])
  assert.equal(result.grid?.chars, "┌─┐└─┘")
})

test("a UTF-8 BOM is ignored", () => {
  const result = parseGrid("\uFEFFabcd\n", 4, 1, "a.txt")
  assert.deepEqual(result.errors, [])
  assert.equal(result.grid?.chars, "abcd")
})

test("empty text fails the row count", () => {
  assert.match(messages(parseGrid("", 4, 2, "a.txt").errors), /rows/)
})

test("isWidthOne accepts one-cell glyphs", () => {
  for (const char of ["a", "Z", " ", "é", "─", "│", "█", "░"]) {
    assert.equal(isWidthOne(char), true, JSON.stringify(char))
  }
})

test("isWidthOne rejects everything that would shift the grid", () => {
  for (const char of ["\t", "\n", "\u0000", "\u007f", "\u009b", "\u0301", "\u200b", "\uFEFF", "\uFE0F", "世", "Ａ", "\u{1F600}"]) {
    assert.equal(isWidthOne(char), false, JSON.stringify(char))
  }
  assert.equal(isWidthOne("ab"), false)
  assert.equal(isWidthOne(""), false)
})
