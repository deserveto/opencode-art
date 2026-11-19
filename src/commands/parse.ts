export type ArtCommand =
  | { readonly kind: "dialog" }
  | { readonly kind: "help" }
  | { readonly kind: "on" }
  | { readonly kind: "off" }
  | { readonly kind: "toggle" }
  | { readonly kind: "next" }
  | { readonly kind: "reload" }
  | { readonly kind: "create"; readonly template?: string }
  | { readonly kind: "validate"; readonly target?: string }
  | { readonly kind: "set"; readonly id?: string }
  | { readonly kind: "style"; readonly style?: string }
  | { readonly kind: "fps"; readonly value?: string }
  | { readonly kind: "dim"; readonly value?: string }
  | { readonly kind: "unknown"; readonly input: string }

export function parseArtCommand(input?: string): ArtCommand {
  const tokens = (input ?? "").trim().split(/\s+/).filter(Boolean)
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
    case "create":
      return { kind: "create", template: tokens[1]?.toLowerCase() }
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
