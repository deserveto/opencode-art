const mod = require("node:module")
const fs = require("node:fs")
const { fileURLToPath } = require("node:url")

const REGISTERED = Symbol.for("opencode-art.strip-ts")

if (!globalThis[REGISTERED] && typeof mod.registerHooks === "function" && typeof mod.stripTypeScriptTypes === "function") {
  globalThis[REGISTERED] = true
  mod.registerHooks({
    load(url, context, nextLoad) {
      if (url.startsWith("file:") && (url.endsWith(".ts") || url.endsWith(".tsx")) && url.includes("/node_modules/")) {
        const code = fs.readFileSync(fileURLToPath(url), "utf8")
        return {
          format: "module",
          shortCircuit: true,
          source: mod.stripTypeScriptTypes(code, { mode: "strip", sourceUrl: url }),
        }
      }
      return nextLoad(url, context)
    },
  })
}
