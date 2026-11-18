#!/usr/bin/env node
const [major, minor] = String(process.versions.node)
  .split(".")
  .map((part) => Number.parseInt(part, 10))

if (major < 22 || (major === 22 && minor < 18)) {
  console.error(
    `opencode-art needs Node 22.18 or newer to run TypeScript sources directly (found ${process.versions.node}).`,
  )
  process.exit(2)
}

require("./strip-ts.cjs")

import("../src/cli/main.ts")
  .then((module) => module.main(process.argv.slice(2)))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(`opencode-art: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  })
