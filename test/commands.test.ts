import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { encode as encodePng } from "fast-png"
import type { Plugin } from "@opencode/plugin/tui"
import { parseArtCommand } from "../src/commands/parse.ts"
import {
  ART_PROMPT_TEMPLATES,
  analyzeCreateSource,
  artHelp,
  buildCompactAiPrompt,
  cleanSourceInput,
  createInitialFormState,
  cycleFormField,
  derivePackId,
  openCreateArtPrompt,
  resolvePromptTemplate,
  submitCreateForm,
  updateFormPackId,
  updateFormSource,
  type CreateTemplateKind,
  type EditablePromptTarget,
} from "../src/commands/templates.ts"
import type { ArtState } from "../src/plugin/state.ts"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const fixtureGif = path.join(repoRoot, "test", "fixtures", "media", "three-frame.gif")

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
  assert.deepEqual(parseArtCommand("create ./hero.png"), {
    kind: "create",
    template: undefined,
    source: "./hero.png",
  })
  assert.deepEqual(parseArtCommand("create scene cyberpunk rainy city"), {
    kind: "create",
    template: "scene",
    source: "cyberpunk rainy city",
  })
  assert.deepEqual(parseArtCommand('create "C:\\Videos\\waguri.mp4"'), {
    kind: "create",
    template: undefined,
    source: '"C:\\Videos\\waguri.mp4"',
  })
  assert.deepEqual(parseArtCommand("create unknown-format"), {
    kind: "create",
    template: "unknown-format",
  })
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

test("artHelp documents /art create and the interactive creation TUI", () => {
  const help = artHelp({
    roots: {
      projectArts: "/repo/.opencode/arts",
      globalArts: "/home/user/.config/opencode/arts",
      bundledFrames: "/pkg/frames",
    },
  })
  assert.match(help, /\/art create \[scene\|image\|gif\|video\|logo\|<path>\]/)
  assert.match(help, /interactive creation TUI/)
})

test("cleanSourceInput and derivePackId normalize quoted paths and text prompts", () => {
  assert.equal(cleanSourceInput('  "C:\\Users\\sangh\\Videos\\My Waguri 01.mp4"  '), "C:\\Users\\sangh\\Videos\\My Waguri 01.mp4")
  assert.equal(cleanSourceInput("'./examples/logo.png'"), "./examples/logo.png")
  assert.equal(derivePackId('"C:\\Users\\sangh\\Videos\\My Waguri 01.mp4"'), "my-waguri-01")
  assert.equal(derivePackId("Cyberpunk rainy street with neon reflections!"), "cyberpunk-rainy-street-with")
  assert.equal(derivePackId("", "logo"), "my-logo")
})

test("analyzeCreateSource detects existing media files, missing media files, and AI prompts", () => {
  const existingGif = analyzeCreateSource(`"${fixtureGif}"`, "auto", repoRoot)
  assert.equal(existingGif.detectedKind, "gif")
  assert.equal(existingGif.execution, "bake")
  assert.equal(existingGif.exists, true)
  assert.equal(existingGif.valid, true)
  assert.match(existingGif.summary, /Direct CLI bake/)

  const missingVideo = analyzeCreateSource("./does-not-exist.mp4", "auto", repoRoot)
  assert.equal(missingVideo.detectedKind, "video")
  assert.equal(missingVideo.execution, "bake")
  assert.equal(missingVideo.exists, false)
  assert.equal(missingVideo.valid, false)
  assert.match(missingVideo.summary, /File not found/)

  const unsupportedFile = analyzeCreateSource("./archive.zip", "auto", repoRoot)
  assert.equal(unsupportedFile.detectedKind, "unsupported-file")
  assert.equal(unsupportedFile.valid, false)

  const aiPrompt = analyzeCreateSource("cyberpunk rainy street with neon signs", "auto", repoRoot)
  assert.equal(aiPrompt.detectedKind, "ai")
  assert.equal(aiPrompt.effectiveKind, "scene")
  assert.equal(aiPrompt.execution, "prompt")
  assert.equal(aiPrompt.valid, true)
})

test("form state updates auto-derive packId, cycle fields, and build a clean 2-line prompt without brackets", () => {
  let form = createInitialFormState({ projectRoot: repoRoot })
  assert.equal(form.mode, "auto")
  assert.equal(form.idTouched, false)

  form = updateFormSource(form, "neon mountain sunset over ocean", repoRoot)
  assert.equal(form.packId, "neon-mountain-sunset-over")
  assert.equal(form.idTouched, false)

  form = cycleFormField(form, "scope", 1)
  assert.equal(form.scope, "project")
  assert.equal(form.pinGit, true)

  form = cycleFormField(form, "style", 2)
  assert.equal(form.style, "palette")

  form = cycleFormField(form, "fit", 2)
  assert.equal(form.fit, "cover")

  const prompt = buildCompactAiPrompt(form, {
    projectArts: "/repo/.opencode/arts",
    globalArts: "/home/user/.config/opencode/arts",
  })
  const lines = prompt.split("\n")
  assert.equal(lines.length, 2)
  assert.equal(prompt.includes("["), false)
  assert.equal(prompt.includes("]"), false)
  assert.match(lines[0] ?? "", /"neon-mountain-sunset-over"/)
  assert.match(lines[0] ?? "", /style: palette, fit: cover/)
  assert.match(lines[0] ?? "", /pin "pack": "neon-mountain-sunset-over" in \.opencode\/art\.json/)
  assert.equal(lines[1], "Scene: neon mountain sunset over ocean")

  // Once Pack ID is customized, changing source preserves the custom Pack ID.
  form = updateFormPackId(form, "my-custom-id")
  assert.equal(form.idTouched, true)
  assert.equal(form.packId, "my-custom-id")
  form = updateFormSource(form, "another idea entirely", repoRoot)
  assert.equal(form.packId, "my-custom-id")

  // Clearing Pack ID resets it back to auto-derived.
  form = updateFormPackId(form, "")
  assert.equal(form.idTouched, false)
  assert.equal(form.packId, "another-idea-entirely")
})

test("submitCreateForm bakes a media file directly via CLI, pins .opencode/art.json, and activates the pack", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "opencode-art-create-bake-"))
  try {
    const projectArts = path.join(tempRoot, ".opencode", "arts")
    const globalArts = path.join(tempRoot, "global-arts")
    const toasts: Array<{ message: string; variant?: string }> = []
    let reloaded = 0
    let activePack = ""
    let activeStyle = ""
    let activeFps = 0

    const state = {
      roots: {
        projectRoot: tempRoot,
        projectArts,
        globalArts,
        bundledFrames: path.join(repoRoot, "frames"),
      },
      reload: async () => {
        reloaded++
      },
      setPack: async (id: string) => {
        activePack = id
        return true
      },
      setStyle: async (style: string) => {
        activeStyle = style
      },
      setFps: async (fps: number) => {
        activeFps = fps
      },
    } as unknown as ArtState

    const context = {
      renderer: {},
      ui: {
        toast: { show: (options: { message: string; variant?: string }) => toasts.push(options) },
        dialog: {
          clear: () => {},
          alert: async () => {},
          select: async () => undefined,
        },
      },
    } as unknown as Plugin.Context

    let form = createInitialFormState({ source: `"${fixtureGif}"`, projectRoot: tempRoot })
    form = {
      ...form,
      scope: "project",
      pinGit: true,
      style: "palette",
      fit: "contain",
      presetIndex: 4, // 60x20, 12 fps, 4s
    }

    const result = await submitCreateForm(context, state, form)
    assert.deepEqual(result, { ok: true, mode: "baked" })
    assert.equal(reloaded, 1)
    assert.equal(activePack, "three-frame")
    assert.equal(activeStyle, "palette")
    assert.equal(activeFps, 12)
    assert.equal(toasts.at(-1)?.variant, "success")
    assert.match(toasts.at(-1)?.message ?? "", /Baked and activated "three-frame"/)

    const manifest = JSON.parse(
      await readFile(path.join(projectArts, "three-frame", "art.json"), "utf8"),
    ) as { id: string; defaultStyle: string; fit: string; cols: number; rows: number }
    assert.equal(manifest.id, "three-frame")
    assert.equal(manifest.defaultStyle, "palette")
    assert.equal(manifest.fit, "contain")
    assert.equal(manifest.cols, 60)
    assert.equal(manifest.rows, 20)

    const pinned = JSON.parse(
      await readFile(path.join(tempRoot, ".opencode", "art.json"), "utf8"),
    ) as { version: number; pack: string; style: string; fps: number }
    assert.equal(pinned.version, 1)
    assert.equal(pinned.pack, "three-frame")
    assert.equal(pinned.style, "palette")
    assert.equal(pinned.fps, 12)

    // Static PNG image bake with an effect ("shimmer") injects valid effects into art.json.
    const pngPath = path.join(tempRoot, "hero-banner.png")
    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(200)
    await writeFile(pngPath, encodePng({ width: 4, height: 4, data: pixels }))

    let imgForm = createInitialFormState({ source: pngPath, projectRoot: tempRoot })
    imgForm = {
      ...imgForm,
      scope: "user",
      pinGit: false,
      style: "original",
      fit: "center",
      effect: "shimmer",
      presetIndex: 3, // 80x24, 10 fps
    }
    const imgResult = await submitCreateForm(context, state, imgForm)
    assert.deepEqual(imgResult, { ok: true, mode: "baked" })
    assert.equal(activePack, "hero-banner")
    const imgManifest = JSON.parse(
      await readFile(path.join(globalArts, "hero-banner", "art.json"), "utf8"),
    ) as { id: string; canvas?: string; fit: string; effects?: Array<{ type: string }> }
    assert.equal(imgManifest.id, "hero-banner")
    assert.equal(imgManifest.canvas, "canvas.txt")
    assert.equal(imgManifest.fit, "center")
    assert.equal(imgManifest.effects?.[0]?.type, "shimmer")
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test("submitCreateForm inserts a 2-line prompt into the chat composer for AI descriptions", async () => {
  const toasts: Array<{ message: string; variant?: string }> = []
  let dialogCleared = false
  const editor: EditablePromptTarget = {
    plainText: "",
    replaceText(text: string) {
      this.plainText = text
    },
  }

  const state = {
    roots: {
      projectRoot: repoRoot,
      projectArts: "/repo/.opencode/arts",
      globalArts: "/home/user/.config/opencode/arts",
      bundledFrames: "/pkg/frames",
    },
  } as unknown as ArtState

  const context = {
    renderer: {
      currentFocusedEditor: editor,
    },
    ui: {
      toast: { show: (options: { message: string; variant?: string }) => toasts.push(options) },
      dialog: {
        clear: () => {
          dialogCleared = true
        },
        alert: async () => {},
        select: async () => undefined,
      },
    },
  } as unknown as Plugin.Context

  const form = createInitialFormState({
    template: "logo",
    source: "minimalist geometric fox emblem",
    projectRoot: repoRoot,
  })
  const result = await submitCreateForm(context, state, form, editor)
  assert.deepEqual(result, { ok: true, mode: "prompt" })
  assert.equal(dialogCleared, true)
  assert.equal((editor.plainText ?? "").split("\n").length, 2)
  assert.match(editor.plainText ?? "", /Create an opencode-art canvas pack "minimalist-geometric-fox-emblem"/)
  assert.match(editor.plainText ?? "", /Artwork: minimalist geometric fox emblem/)
  assert.equal((editor.plainText ?? "").includes("["), false)
  assert.equal(toasts.at(-1)?.variant, "success")
})

test("openCreateArtPrompt prefills the focused chat editor and re-applies if cleared on microtask", async () => {
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

  editor.plainText = ""
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.match(editor.plainText ?? "", /Convert an image into an opencode-art ASCII canvas pack/)
})

test("openCreateArtPrompt with an unknown kind shows usage and falls back to alert when no editor exists", async () => {
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
        select: async (): Promise<CreateTemplateKind> => "video",
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
})
