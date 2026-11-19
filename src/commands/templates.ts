import { isEditBufferRenderable } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"
import type { ArtState } from "../plugin/state.ts"

type Context = Plugin.Context

export const CREATE_TEMPLATE_KINDS = ["scene", "image", "gif", "video", "logo"] as const
export type CreateTemplateKind = (typeof CREATE_TEMPLATE_KINDS)[number]

export interface ArtPromptTemplate {
  readonly kind: CreateTemplateKind
  readonly aliases: readonly string[]
  readonly title: string
  readonly description: string
  readonly prompt: string
}

export interface EditablePromptTarget {
  readonly isDestroyed?: boolean
  readonly visible?: boolean
  readonly wrapMode?: "none" | "char" | "word"
  readonly maxLength?: number
  plainText?: string
  replaceText?: (text: string) => void
  setText?: (text: string) => void
  gotoBufferEnd?: () => unknown
  focus?: () => void
}

export function artHelp(state: {
  readonly roots: Pick<ArtState["roots"], "projectArts" | "globalArts" | "bundledFrames">
}): string {
  return [
    "/art                 open the art browser",
    "/art create [scene|image|gif|video|logo]",
    "/art on | off | toggle",
    "/art next            next pack in scope order",
    "/art set <id>        select a pack",
    "/art style <mono|theme|palette|original>",
    "/art fps <1-30>",
    "/art dim <0-80>",
    "/art reload          re-scan packs",
    "/art validate [id|path]",
    "/art help",
    "",
    `project  ${state.roots.projectArts}`,
    `user     ${state.roots.globalArts}`,
    `bundled  ${state.roots.bundledFrames}`,
    "",
    "Run /art create (or press c in /art) to prefill an adjustable prompt template in chat.",
  ].join("\n")
}

export const ART_PROMPT_TEMPLATES: readonly ArtPromptTemplate[] = [
  {
    kind: "scene",
    aliases: ["procedural", "animation", "animated", "new"],
    title: "Animated Scene (Procedural)",
    description: "Generate a new looping ASCII animation from a description (scene.mjs)",
    prompt: [
      "Create a new animated ASCII art pack for opencode-art using the opencode-art skill:",
      "- Pack id: [my-scene]",
      "- Scene idea: [e.g. cyberpunk rainy street with neon signs, falling rain, and puddle reflections]",
      "- Motion & loop: [smooth 6-second seamless loop at 12 fps]",
      "- Size & fit: [180x50], fit [stretch | contain | cover | center]",
      "- Color style: [mono | theme | palette | original] (optional palette hex stops: [#1e1e2e, #89b4fa, #f5c2e7])",
      "- Save to: [user (~/.config/opencode/arts) | project (.opencode/arts)]",
      "Please init the pack, write a deterministic scene.mjs, bake, validate, preview, and tell me the /art set command.",
    ].join("\n"),
  },
  {
    kind: "image",
    aliases: ["img", "photo", "picture", "png", "jpg", "jpeg", "webp"],
    title: "Image to ASCII Canvas",
    description: "Convert a PNG, JPEG, or WebP image into a static or animated canvas pack",
    prompt: [
      "Convert an image into an opencode-art ASCII canvas pack using the opencode-art skill:",
      "- Input image path: [/path/to/image.png] (supports PNG, JPEG, WebP)",
      "- Pack id: [my-image]",
      "- Size & fit: [180x50], fit [stretch | contain | cover | center]",
      "- Color style: [original | palette | theme | mono] (optional: --dither for mono, --invert)",
      "- Motion effects (optional, up to 4): [none | shimmer | wave | drift | twinkle | scanline] at [10] fps",
      "- Save to: [user (~/.config/opencode/arts) | project (.opencode/arts)]",
      "Please bake the image, add any requested effects to art.json, validate, preview, and tell me the /art set command.",
    ].join("\n"),
  },
  {
    kind: "gif",
    aliases: ["anim-gif"],
    title: "GIF to Animated ASCII",
    description: "Convert an animated GIF file into an ASCII frame sequence pack",
    prompt: [
      "Convert an animated GIF into an opencode-art frame pack using the opencode-art skill:",
      "- Input GIF path: [/path/to/animation.gif]",
      "- Pack id: [my-gif]",
      "- Size & fit: [180x50], fit [stretch | contain | cover | center]",
      "- Playback: [10] fps, loop duration [6] seconds",
      "- Color style: [original | palette | theme | mono] (colors: [64], optional: --dither for mono, --invert)",
      "- Save to: [user (~/.config/opencode/arts) | project (.opencode/arts)]",
      "Please bake the GIF into frames, validate, preview, and tell me the /art set command.",
    ].join("\n"),
  },
  {
    kind: "video",
    aliases: ["vid", "mp4", "mov", "webm"],
    title: "Video to Animated ASCII",
    description: "Convert a video file (MP4, MOV, WebM via ffmpeg) into an ASCII frame pack",
    prompt: [
      "Convert a video file into an opencode-art animated frame pack using the opencode-art skill:",
      "- Input video path: [/path/to/video.mp4] (requires ffmpeg on PATH)",
      "- Pack id: [my-video]",
      "- Size & fit: [180x50], fit [stretch | contain | cover | center]",
      "- Playback: [12] fps, loop duration [6] seconds",
      "- Color style: [original | palette | theme | mono] (colors: [64], optional: --dither for mono, --invert)",
      "- Save to: [user (~/.config/opencode/arts) | project (.opencode/arts)]",
      "Please bake the video into frames, validate, preview, and tell me the /art set command.",
    ].join("\n"),
  },
  {
    kind: "logo",
    aliases: ["canvas", "banner", "static", "text"],
    title: "Logo / Banner + Motion Effects",
    description: "Draw a custom ASCII logo, wordmark, or static canvas with optional live effects",
    prompt: [
      "Create a custom ASCII logo or static canvas pack for opencode-art using the opencode-art skill:",
      "- Pack id: [my-logo]",
      "- Text or artwork to draw: [e.g. bold \"OPENCODE\" emblem centered over a subtle grid]",
      "- Size & fit: [80x24], fit [center | contain | stretch | cover]",
      "- Color style: [palette | theme | mono] (optional palette hex stops: [#313244, #89b4fa, #f5c2e7])",
      "- Motion effects (optional, up to 4): [shimmer | wave | drift | twinkle | scanline] at [10] fps",
      "- Save to: [user (~/.config/opencode/arts) | project (.opencode/arts)]",
      "Please create art.json and canvas.txt, validate, preview, and tell me the /art set command.",
    ].join("\n"),
  },
]

export function resolvePromptTemplate(input?: string): ArtPromptTemplate | undefined {
  const needle = input?.trim().toLowerCase()
  if (!needle) return undefined
  return ART_PROMPT_TEMPLATES.find(
    (template) => template.kind === needle || template.aliases.includes(needle),
  )
}

function isUsableEditor(node: unknown): node is EditablePromptTarget {
  if (!node || typeof node !== "object") return false
  const candidate = node as EditablePromptTarget
  if (candidate.isDestroyed === true || candidate.visible === false) return false
  if (isEditBufferRenderable(node)) return true
  return typeof candidate.replaceText === "function" || typeof candidate.setText === "function"
}

function collectEditors(root: unknown, out: EditablePromptTarget[] = []): EditablePromptTarget[] {
  if (!root || typeof root !== "object") return out
  const node = root as {
    readonly isDestroyed?: boolean
    readonly visible?: boolean
    readonly getChildren?: () => readonly unknown[]
  }
  if (node.isDestroyed === true || node.visible === false) return out
  if (isUsableEditor(root)) out.push(root)
  if (typeof node.getChildren === "function") {
    for (const child of node.getChildren()) {
      collectEditors(child, out)
    }
  }
  return out
}

export function captureFocusedEditor(context: Context): EditablePromptTarget | null {
  const focused = (context.renderer as { readonly currentFocusedEditor?: unknown } | undefined)?.currentFocusedEditor
  return isUsableEditor(focused) ? focused : null
}

function findPromptEditor(context: Context, preferred?: EditablePromptTarget | null): EditablePromptTarget | null {
  if (preferred && isUsableEditor(preferred)) return preferred
  const focused = captureFocusedEditor(context)
  if (focused) return focused
  const root = (context.renderer as { readonly root?: unknown } | undefined)?.root
  const editors = collectEditors(root)
  if (editors.length === 0) return null
  // Prefer multi-line textareas (the chat composer) over single-line filter inputs.
  const multiline = editors.filter((editor) => editor.wrapMode !== "none" && editor.maxLength === undefined)
  return (multiline.at(-1) ?? editors.at(-1)) ?? null
}

function writeEditorText(context: Context, editor: EditablePromptTarget, text: string): boolean {
  try {
    if (typeof editor.replaceText === "function") {
      editor.replaceText(text)
    } else if (typeof editor.setText === "function") {
      editor.setText(text)
    } else {
      return false
    }
    editor.gotoBufferEnd?.()
    editor.focus?.()
    ;(context.renderer as { readonly requestRender?: () => void } | undefined)?.requestRender?.()
    return true
  } catch {
    return false
  }
}

export function prefillPromptEditor(
  context: Context,
  text: string,
  preferred?: EditablePromptTarget | null,
): { readonly prefilled: boolean; readonly copied: boolean } {
  let copied = false
  try {
    const renderer = context.renderer as { readonly copyToClipboardOSC52?: (value: string) => boolean } | undefined
    if (typeof renderer?.copyToClipboardOSC52 === "function") {
      copied = Boolean(renderer.copyToClipboardOSC52(text))
    }
  } catch {
    copied = false
  }

  const editor = findPromptEditor(context, preferred)
  if (!editor) return { prefilled: false, copied }

  const prefilled = writeEditorText(context, editor, text)
  if (prefilled) {
    const reapplyIfCleared = () => {
      if (editor.isDestroyed === true || editor.visible === false) return
      const current = editor.plainText
      if (current === "" || (typeof current === "string" && current.trim().toLowerCase().startsWith("/art"))) {
        writeEditorText(context, editor, text)
      }
    }
    // Re-apply if the host clears the slash command input after run() or its promise settles.
    queueMicrotask(reapplyIfCleared)
    const timer = setTimeout(reapplyIfCleared, 0)
    ;(timer as { readonly unref?: () => void }).unref?.()
  }
  return { prefilled, copied }
}

export async function safeAlert(context: Context, title: string, message: string): Promise<void> {
  try {
    await context.ui.dialog.alert({ title, message })
  } catch (error) {
    context.ui.toast.show({
      message: `${title}: ${message.split("\n")[0] ?? ""} (${error instanceof Error ? error.message : String(error)})`,
      variant: "error",
    })
  }
}

async function applyPromptTemplate(
  context: Context,
  template: ArtPromptTemplate,
  preferredEditor?: EditablePromptTarget | null,
): Promise<void> {
  const result = prefillPromptEditor(context, template.prompt, preferredEditor)
  if (result.prefilled) {
    context.ui.toast.show({
      message: `Loaded "${template.title}" prompt template into chat. Edit the [...] fields and press Enter.`,
      variant: "success",
    })
    return
  }
  if (result.copied) {
    context.ui.toast.show({
      message: `Copied "${template.title}" prompt template to clipboard.`,
      variant: "info",
    })
  }
  await safeAlert(context, `Prompt Template — ${template.title}`, template.prompt)
}

export async function openCreateArtPrompt(
  context: Context,
  templateInput?: string,
  preferredEditor?: EditablePromptTarget | null,
): Promise<void> {
  const editor = preferredEditor ?? captureFocusedEditor(context)
  if (templateInput) {
    const template = resolvePromptTemplate(templateInput)
    if (!template) {
      context.ui.toast.show({
        message: `Usage: /art create [${CREATE_TEMPLATE_KINDS.join("|")}]`,
        variant: "warning",
      })
      return
    }
    await applyPromptTemplate(context, template, editor)
    return
  }

  let chosen: CreateTemplateKind | undefined
  try {
    chosen = await context.ui.dialog.select<CreateTemplateKind>({
      title: "Create ASCII Art — Choose a Prompt Template",
      placeholder: "Filter templates (scene, image, gif, video, logo)…",
      options: ART_PROMPT_TEMPLATES.map((item) => ({
        title: item.title,
        value: item.kind,
        description: item.description,
        footer: `/art create ${item.kind}`,
      })),
    })
  } catch (error) {
    context.ui.toast.show({
      message: `Could not open the template picker: ${error instanceof Error ? error.message : String(error)}`,
      variant: "error",
    })
    return
  }

  if (!chosen) return
  const template = resolvePromptTemplate(chosen)
  if (!template) return
  await applyPromptTemplate(context, template, editor)
}
