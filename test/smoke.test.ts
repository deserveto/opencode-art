import assert from "node:assert/strict"
import test from "node:test"
import { CAPS, SCHEMA_VERSION } from "../src/art/types.ts"

test("contracts are importable", () => {
  assert.equal(SCHEMA_VERSION, 1)
  assert.equal(CAPS.cols, 400)
})
