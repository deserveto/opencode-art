import type { Capabilities } from "./types.ts"

/** Capability values from `context.renderer.capabilities`, when available. */
export interface CapabilityInput {
  readonly rgb?: boolean
  readonly ansi256?: boolean
  readonly unicode?: boolean
}

/**
 * Resolves terminal color support. Host capabilities win; environment variables
 * are the fallback. `NO_COLOR` and `TERM=dumb` always disable color.
 */
export function detectCapabilities(
  input: CapabilityInput | undefined,
  env: Record<string, string | undefined>,
): Capabilities {
  const noColor = typeof env.NO_COLOR === "string" && env.NO_COLOR !== ""
  const term = (env.TERM ?? "").trim().toLowerCase()
  const dumb = term === "dumb"
  const colorterm = (env.COLORTERM ?? "").trim().toLowerCase()
  const envRgb = colorterm.includes("truecolor") || colorterm.includes("24bit")
  const env256 = envRgb || term.includes("256color")
  const envColor = !dumb && (envRgb || env256 || term.length > 0)

  // A non-null host capability object implies a real terminal, so 16 colors.
  const color = !noColor && !dumb && (input !== undefined || envColor)
  const rgb = color && (input?.rgb ?? envRgb)
  const ansi256 = color && (rgb || (input?.ansi256 ?? env256))
  const unicode = input?.unicode ?? !dumb

  return { rgb, ansi256, unicode, color }
}
