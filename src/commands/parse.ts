import { resolvePromptTemplate } from "./templates.ts"

export type ArtCommand =
  | { readonly kind: "dialog" }
  | { readonly kind: "help" }
  | { readonly kind: "on" }
  | { readonly kind: "off" }
  | { readonly kind: "toggle" }
  | { readonly kind: "next" }
  | { readonly kind: "reload" }
  | { readonly kind: "create"; readonly template?: string; readonly source?: string }
  | { readonly kind: "validate"; readonly target?: string }
  | { readonly kind: "set"; readonly id?: string }
  | { readonly kind: "style"; readonly style?: string }
  | { readonly kind: "fps"; readonly value?: string }
  | { readonly kind: "dim"; readonly value?: string }
  | { readonly kind: "unknown"; readonly input: string }

function looksLikePathOrMedia(token: string): boolean {
  if (/[\\/~]/.test(token) || token.startsWith('"') || token.startsWith("'")) return true
  return /\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mjs|js)$/i.test(token)
}

export function parseArtCommand(input?: string): ArtCommand {
  const raw = (input ?? "").trim()
  const tokens = raw.split(/\s+/).filter(Boolean)
  const name = tokens[0]?.toLowerCase()
  if (!name) return { kind: "dialog" }
  switch (name) {
    case "on":
    case "off":
    case "toggle":
    case "next":
    case "reload":
    case "help":
      return { kind: name }
    case "create": {
      const rest = raw.replace(/^create\b\s*/i, "").trim()
      if (!rest) return { kind: "create", template: undefined }
      const first = tokens[1] ?? ""
      const matched = resolvePromptTemplate(first)
      if (matched) {
        const afterFirst = rest.slice(first.length).trim()
        return afterFirst
          ? { kind: "create", template: first.toLowerCase(), source: afterFirst }
          : { kind: "create", template: first.toLowerCase() }
      }
      if (tokens.length === 2 && !looksLikePathOrMedia(first)) {
        return { kind: "create", template: first.toLowerCase() }
      }
      return { kind: "create", template: undefined, source: rest }
    }
    case "validate":
      return { kind: "validate", target: tokens[1] }
    case "set":
      return { kind: "set", id: tokens[1] }
    case "style":
      return { kind: "style", style: tokens[1]?.toLowerCase() }
    case "fps":
      return { kind: "fps", value: tokens[1] }
    case "dim":
      return { kind: "dim", value: tokens[1] }
    default:
      return { kind: "unknown", input: name }
  }
}
