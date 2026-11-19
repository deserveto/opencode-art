import assert from "node:assert/strict"
import test from "node:test"
import type { Plugin } from "@opencode/plugin/tui"
import { parseArtCommand } from "../src/commands/parse.ts"
import {
  ART_PROMPT_TEMPLATES,
  artHelp,
  openCreateArtPrompt,
  resolvePromptTemplate,
  type CreateTemplateKind,
  type EditablePromptTarget,
} from "../src/commands/templates.ts"

test("bare /art opens the dialog", () => {
  assert.deepEqual(parseArtCommand(undefined), { kind: "dialog" })
  assert.deepEqual(parseArtCommand("   "), { kind: "dialog" })
})

test("toggles and actions parse case-insensitively", () => {
  assert.deepEqual(parseArtCommand("ON"), { kind: "on" })
  assert.deepEqual(parseArtCommand("off"), { kind: "off" })
  assert.deepEqual(parseArtCommand("toggle"), { kind: "toggle" })
  assert.deepEqual(parseArtCommand("next"), { kind: "next" })
  assert.deepEqual(parseArtCommand("reload"), { kind: "reload" })
  assert.deepEqual(parseArtCommand("help"), { kind: "help" })
})

test("arguments are captured for create, set, style, fps, dim, validate", () => {
  assert.deepEqual(parseArtCommand("create"), { kind: "create", template: undefined })
  assert.deepEqual(parseArtCommand("CREATE Video"), { kind: "create", template: "video" })
  assert.deepEqual(parseArtCommand("set rainy-city"), { kind: "set", id: "rainy-city" })
  assert.deepEqual(parseArtCommand("style ORIGINAL"), { kind: "style", style: "original" })
  assert.deepEqual(parseArtCommand("fps 12"), { kind: "fps", value: "12" })
  assert.deepEqual(parseArtCommand("dim 40"), { kind: "dim", value: "40" })
  assert.deepEqual(parseArtCommand("DIM 0"), { kind: "dim", value: "0" })
  assert.deepEqual(parseArtCommand("validate ./examples/logo"), { kind: "validate", target: "./examples/logo" })
  assert.deepEqual(parseArtCommand("validate"), { kind: "validate", target: undefined })
})

test("missing arguments stay undefined so the caller can show usage", () => {
  assert.deepEqual(parseArtCommand("set"), { kind: "set", id: undefined })
  assert.deepEqual(parseArtCommand("style"), { kind: "style", style: undefined })
  assert.deepEqual(parseArtCommand("fps"), { kind: "fps", value: undefined })
  assert.deepEqual(parseArtCommand("dim"), { kind: "dim", value: undefined })
})

test("unknown subcommands are reported, not guessed", () => {
  assert.deepEqual(parseArtCommand("dance"), { kind: "unknown", input: "dance" })
})

test("resolvePromptTemplate matches canonical kinds and media/path aliases", () => {
  assert.equal(ART_PROMPT_TEMPLATES.length, 5)
  assert.equal(resolvePromptTemplate("scene")?.kind, "scene")
  assert.equal(resolvePromptTemplate("PROCEDURAL")?.kind, "scene")
  assert.equal(resolvePromptTemplate("image")?.kind, "image")
  assert.equal(resolvePromptTemplate("png")?.kind, "image")
  assert.equal(resolvePromptTemplate("gif")?.kind, "gif")
  assert.equal(resolvePromptTemplate("video")?.kind, "video")
  assert.equal(resolvePromptTemplate("mp4")?.kind, "video")
  assert.equal(resolvePromptTemplate("logo")?.kind, "logo")
  assert.equal(resolvePromptTemplate("canvas")?.kind, "logo")
  assert.equal(resolvePromptTemplate("unknown"), undefined)
})

test("artHelp documents /art create and the prompt template workflow", () => {
  const help = artHelp({
    roots: {
      projectArts: "/repo/.opencode/arts",
      globalArts: "/home/user/.config/opencode/arts",
      bundledFrames: "/pkg/frames",
    },
  })
  assert.match(help, /\/art create \[scene\|image\|gif\|video\|logo\]/)
  assert.match(help, /prefill an adjustable prompt template/)
})

test("/art create <kind> prefills the focused chat editor and re-applies if cleared on microtask", async () => {
  const toasts: Array<{ message: string; variant?: string }> = []
  let focused = false
  let cursorAtEnd = false
  const editor: EditablePromptTarget = {
    plainText: "/art create image",
    replaceText(text: string) {
      this.plainText = text
    },
    gotoBufferEnd() {
      cursorAtEnd = true
    },
    focus() {
      focused = true
    },
  }

  const context = {
    renderer: {
      currentFocusedEditor: editor,
      requestRender: () => {},
    },
    ui: {
      toast: { show: (options: { message: string; variant?: string }) => toasts.push(options) },
      dialog: {
        alert: async () => {},
        select: async () => undefined,
      },
    },
  } as unknown as Plugin.Context

  await openCreateArtPrompt(context, "image")
  assert.match(editor.plainText ?? "", /Convert an image into an opencode-art ASCII canvas pack/)
  assert.equal(focused, true)
  assert.equal(cursorAtEnd, true)
  assert.equal(toasts.at(-1)?.variant, "success")
  assert.match(toasts.at(-1)?.message ?? "", /Image to ASCII Canvas/)

  // Simulate the host clearing the slash command buffer right after run() returns.
  editor.plainText = ""
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.match(editor.plainText ?? "", /Convert an image into an opencode-art ASCII canvas pack/)
})

test("bare /art create opens the template picker and prefills the composer found in renderer.root", async () => {
  const toasts: Array<{ message: string; variant?: string }> = []
  let selectOptionsCount = 0
  const filterInput: EditablePromptTarget = {
    wrapMode: "none",
    maxLength: 80,
    plainText: "",
    replaceText(text: string) {
      this.plainText = text
    },
  }
  const composer: EditablePromptTarget = {
    wrapMode: "word",
    plainText: "",
    replaceText(text: string) {
      this.plainText = text
    },
  }

  const context = {
    renderer: {
      root: {
        getChildren: () => [filterInput, { getChildren: () => [composer] }],
      },
    },
    ui: {
      toast: { show: (options: { message: string; variant?: string }) => toasts.push(options) },
      dialog: {
        alert: async () => {},
        select: async (options: { options: readonly unknown[] }): Promise<CreateTemplateKind> => {
          selectOptionsCount = options.options.length
          return "video"
        },
      },
    },
  } as unknown as Plugin.Context

  await openCreateArtPrompt(context, undefined)
  assert.equal(selectOptionsCount, 5)
  assert.equal(filterInput.plainText, "")
  assert.match(composer.plainText ?? "", /Convert a video file into an opencode-art animated frame pack/)
  assert.match(composer.plainText ?? "", /requires ffmpeg on PATH/)
  assert.equal(toasts.at(-1)?.variant, "success")
})

test("/art create with an unknown template kind shows usage and falls back to alert when no editor exists", async () => {
  const toasts: Array<{ message: string; variant?: string }> = []
  const alerts: Array<{ title: string; message: string }> = []
  let copiedText = ""

  const context = {
    renderer: {
      copyToClipboardOSC52: (text: string) => {
        copiedText = text
        return true
      },
    },
    ui: {
      toast: { show: (options: { message: string; variant?: string }) => toasts.push(options) },
      dialog: {
        alert: async (options: { title: string; message: string }) => {
          alerts.push(options)
        },
        select: async () => undefined,
      },
    },
  } as unknown as Plugin.Context

  await openCreateArtPrompt(context, "unknown-format")
  assert.equal(toasts.at(-1)?.variant, "warning")
  assert.equal(toasts.at(-1)?.message, "Usage: /art create [scene|image|gif|video|logo]")
  assert.equal(alerts.length, 0)

  await openCreateArtPrompt(context, "logo")
  assert.match(copiedText, /Create a custom ASCII logo or static canvas pack/)
  assert.equal(alerts.length, 1)
  assert.match(alerts[0]?.title ?? "", /Logo \/ Banner/)
  assert.match(alerts[0]?.message ?? "", /\[my-logo\]/)
})

