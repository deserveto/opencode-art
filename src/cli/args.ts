export type FlagValue = string | true

export interface ParsedArgs {
  readonly command: string | undefined
  readonly positionals: readonly string[]
  readonly flags: ReadonlyMap<string, FlagValue>
}

const BOOLEAN_FLAGS = new Set(["force", "dither", "invert", "help", "mono"])

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, FlagValue>()
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg.startsWith("--")) {
      const body = arg.slice(2)
      if (body.length === 0) continue
      const equals = body.indexOf("=")
      if (equals >= 0) {
        flags.set(body.slice(0, equals), body.slice(equals + 1))
        continue
      }
      const next = argv[index + 1]
      if (!BOOLEAN_FLAGS.has(body) && next !== undefined && !next.startsWith("--")) {
        flags.set(body, next)
        index++
      } else {
        flags.set(body, true)
      }
    } else {
      positionals.push(arg)
    }
  }
  return { command: positionals[0], positionals: positionals.slice(1), flags }
}

export function flagString(flags: ReadonlyMap<string, FlagValue>, name: string): string | undefined {
  const value = flags.get(name)
  return typeof value === "string" ? value : undefined
}

export function flagBool(flags: ReadonlyMap<string, FlagValue>, name: string): boolean {
  return flags.has(name)
}

export function unknownFlags(flags: ReadonlyMap<string, FlagValue>, allowed: readonly string[]): string[] {
  return [...flags.keys()].filter((name) => !allowed.includes(name))
}
