import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode/plugin/tui"
import {
  EFFECT_TYPES,
  FIT_MODES,
  PACK_ID_PATTERN,
  STYLE_NAMES,
  validatePackDir,
  type EffectSpec,
  type EffectType,
  type FitMode,
  type StyleName,
} from "../art/index.ts"
import { runChild } from "../cli/child.ts"
import type { ArtState } from "../plugin/state.ts"

type Context = Plugin.Context

export const CREATE_TEMPLATE_KINDS = ["scene", "image", "gif", "video", "logo"] as const
export type CreateTemplateKind = (typeof CREATE_TEMPLATE_KINDS)[number]
export type CreateMode = "auto" | CreateTemplateKind
export const CREATE_MODES: readonly CreateMode[] = ["auto", "scene", "logo", "image", "gif", "video"]
export type CreateScope = "user" | "project"
export const CREATE_SCOPES: readonly CreateScope[] = ["user", "project"]
export type CreateEffectChoice = "none" | EffectType
export const CREATE_EFFECT_CHOICES: readonly CreateEffectChoice[] = ["none", ...EFFECT_TYPES]

export interface SizeMotionPreset {
  readonly label: string
  readonly cols: number
  readonly rows: number
  readonly fps: number
  readonly loop: number
}

export const SIZE_MOTION_PRESETS: readonly SizeMotionPreset[] = [
  { label: "180x50 · 10 fps · 6s (Full screen)", cols: 180, rows: 50, fps: 10, loop: 6 },
  { label: "180x50 · 12 fps · 4s (Smooth full)", cols: 180, rows: 50, fps: 12, loop: 4 },
  { label: "120x36 · 12 fps · 6s (Medium)", cols: 120, rows: 36, fps: 12, loop: 6 },
  { label: "80x24 · 10 fps · 4s (Compact / Logo)", cols: 80, rows: 24, fps: 10, loop: 4 },
  { label: "60x20 · 12 fps · 4s (Lightweight)", cols: 60, rows: 20, fps: 12, loop: 4 },
]

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

export type DetectedSourceKind = "empty" | "image" | "gif" | "video" | "scene-file" | "unsupported-file" | "ai"

export interface SourceAnalysis {
  readonly cleaned: string
  readonly detectedKind: DetectedSourceKind
  readonly effectiveKind: CreateTemplateKind | "scene-file"
  readonly execution: "bake" | "prompt"
  readonly resolvedPath: string | null
  readonly exists: boolean
  readonly formatLabel: string
  readonly summary: string
  readonly valid: boolean
}

export interface CreateFormState {
  readonly mode: CreateMode
  readonly source: string
  readonly packId: string
  readonly idTouched: boolean
  readonly scope: CreateScope
  readonly pinGit: boolean
  readonly style: StyleName
  readonly fit: FitMode
  readonly effect: CreateEffectChoice
  readonly presetIndex: number
}

export function artHelp(state: {
  readonly roots: Pick<ArtState["roots"], "projectArts" | "globalArts" | "bundledFrames">
}): string {
  return [
    "/art                 open the art browser",
    "/art create [scene|image|gif|video|logo|<path>]",
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
    "Run /art create (or press c in /art) to open the interactive creation TUI.",
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

export function cleanSourceInput(raw: string): string {
  let text = raw.replace(/[\r\n\t]+/g, " ").trim()
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
  ) {
    text = text.slice(1, -1).trim()
  }
  if (/^file:\/\//i.test(text)) {
    try {
      text = fileURLToPath(text)
    } catch {
      // Keep original text if URL parsing fails.
    }
  }
  return text
}

function expandHomePath(value: string): string {
  const home = process.env.USERPROFILE || process.env.HOME || homedir()
  if (value === "~") return home
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(home, value.slice(2))
  }
  return value
}

export function sanitizePackId(raw: string, fallback = "custom-art"): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 32)
    .replace(/[-_]+$/g, "")
  if (!cleaned) return fallback
  const validStart = /^[a-z0-9]/.test(cleaned) ? cleaned : `art-${cleaned}`.slice(0, 32)
  return PACK_ID_PATTERN.test(validStart) ? validStart : fallback
}

export function derivePackId(source: string, mode: CreateMode = "auto"): string {
  const cleaned = cleanSourceInput(source)
  const fallback = mode === "auto" ? "custom-art" : `my-${mode}`
  if (!cleaned) return fallback
  const ext = path.extname(cleaned).toLowerCase()
  if (
    /^\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mkv|avi|m4v|mjs|js)$/.test(ext) ||
    /^[a-zA-Z]:[\\/]/.test(cleaned) ||
    cleaned.startsWith("./") ||
    cleaned.startsWith("../") ||
    cleaned.startsWith(".\\") ||
    cleaned.startsWith("..\\") ||
    cleaned.startsWith("~/") ||
    cleaned.startsWith("~\\") ||
    cleaned.startsWith("/")
  ) {
    const base = path.basename(cleaned, ext)
    return sanitizePackId(base, fallback)
  }
  const words = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
  return sanitizePackId(words.join("-"), fallback)
}

function looksLikeFilePath(cleaned: string): boolean {
  if (!cleaned) return false
  if (/^[a-zA-Z]:[\\/]/.test(cleaned)) return true
  if (
    cleaned.startsWith("./") ||
    cleaned.startsWith("../") ||
    cleaned.startsWith(".\\") ||
    cleaned.startsWith("..\\") ||
    cleaned.startsWith("~/") ||
    cleaned.startsWith("~\\") ||
    cleaned.startsWith("/")
  ) {
    return true
  }
  if (/\.[a-z0-9]{2,5}$/i.test(cleaned) && !/\s/.test(cleaned)) return true
  return false
}

export function analyzeCreateSource(
  rawSource: string,
  mode: CreateMode = "auto",
  projectRoot: string = process.cwd(),
): SourceAnalysis {
  const cleaned = cleanSourceInput(rawSource)
  const ext = path.extname(cleaned).toLowerCase().replace(/^\./, "")

  let detectedKind: DetectedSourceKind = "empty"
  let formatLabel = "None"
  if (cleaned.length > 0) {
    if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") {
      detectedKind = "image"
      formatLabel = `Image (${ext.toUpperCase()})`
    } else if (ext === "gif") {
      detectedKind = "gif"
      formatLabel = "Animated GIF"
    } else if (ext === "mp4" || ext === "mov" || ext === "webm") {
      detectedKind = "video"
      formatLabel = `Video (${ext.toUpperCase()})`
    } else if (ext === "mjs" || ext === "js") {
      detectedKind = "scene-file"
      formatLabel = `Scene Module (.${ext})`
    } else if (looksLikeFilePath(cleaned)) {
      detectedKind = "unsupported-file"
      formatLabel = ext ? `Unsupported (.${ext})` : "File path"
    } else {
      detectedKind = "ai"
      formatLabel = "Text Prompt"
    }
  }

  let effectiveKind: CreateTemplateKind | "scene-file"
  if (mode !== "auto") {
    effectiveKind = detectedKind === "scene-file" && mode === "scene" ? "scene-file" : mode
  } else if (detectedKind === "image" || detectedKind === "gif" || detectedKind === "video" || detectedKind === "scene-file") {
    effectiveKind = detectedKind
  } else {
    effectiveKind = "scene"
  }

  const isMediaMode =
    effectiveKind === "image" ||
    effectiveKind === "gif" ||
    effectiveKind === "video" ||
    effectiveKind === "scene-file" ||
    detectedKind === "image" ||
    detectedKind === "gif" ||
    detectedKind === "video" ||
    detectedKind === "scene-file"

  if (!cleaned) {
    const hint =
      mode === "image" || mode === "gif" || mode === "video"
        ? `Paste a ${mode.toUpperCase()} file path to bake directly.`
        : mode === "logo"
          ? "Type a logo/banner idea to generate in chat, or paste an image path."
          : "Paste an image/GIF/video path for direct bake, or type a scene idea for AI."
    return {
      cleaned: "",
      detectedKind: "empty",
      effectiveKind,
      execution: mode === "image" || mode === "gif" || mode === "video" ? "bake" : "prompt",
      resolvedPath: null,
      exists: false,
      formatLabel: "Empty",
      summary: hint,
      valid: false,
    }
  }

  if (detectedKind === "unsupported-file") {
    return {
      cleaned,
      detectedKind,
      effectiveKind,
      execution: "bake",
      resolvedPath: path.resolve(projectRoot, expandHomePath(cleaned)),
      exists: false,
      formatLabel,
      summary: "Unsupported file extension. Use PNG, JPEG, WebP, GIF, MP4, MOV, WebM, or .mjs.",
      valid: false,
    }
  }

  if (isMediaMode && (detectedKind === "image" || detectedKind === "gif" || detectedKind === "video" || detectedKind === "scene-file")) {
    const expanded = expandHomePath(cleaned)
    const resolvedPath = path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(projectRoot, expanded)
    const fileExists = existsSync(resolvedPath)
    const ffmpegHint = detectedKind === "video" ? " · uses ffmpeg" : ""
    return {
      cleaned,
      detectedKind,
      effectiveKind: detectedKind,
      execution: "bake",
      resolvedPath,
      exists: fileExists,
      formatLabel,
      summary: fileExists
        ? `Detected: ${formatLabel} · File found · Direct CLI bake (0 tokens)${ffmpegHint}`
        : `Detected: ${formatLabel} · File not found at ${resolvedPath}`,
      valid: fileExists,
    }
  }

  if (mode === "image" || mode === "gif" || mode === "video") {
    const expanded = expandHomePath(cleaned)
    const resolvedPath = path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(projectRoot, expanded)
    return {
      cleaned,
      detectedKind,
      effectiveKind: mode,
      execution: "bake",
      resolvedPath,
      exists: false,
      formatLabel,
      summary: `Mode is ${mode.toUpperCase()} — paste a valid .${mode === "image" ? "png/.jpg/.webp" : mode === "gif" ? "gif" : "mp4/.mov/.webm"} file path, or switch Mode to Auto/Scene.`,
      valid: false,
    }
  }

  const aiKind = effectiveKind === "logo" ? "Logo / Canvas" : "Animated Scene"
  return {
    cleaned,
    detectedKind: "ai",
    effectiveKind: effectiveKind === "logo" ? "logo" : "scene",
    execution: "prompt",
    resolvedPath: null,
    exists: false,
    formatLabel: `AI (${aiKind})`,
    summary: `Detected: ${aiKind} idea · Will insert a clean 2-line prompt in chat`,
    valid: true,
  }
}

export function createInitialFormState(options?: {
  readonly template?: string
  readonly source?: string
  readonly projectRoot?: string
}): CreateFormState {
  const matched = resolvePromptTemplate(options?.template)
  const initialSource = cleanSourceInput(options?.source ?? "")
  const mode: CreateMode = matched ? matched.kind : "auto"
  const analysis = analyzeCreateSource(initialSource, mode, options?.projectRoot)
  const effective = analysis.effectiveKind

  const defaultStyle: StyleName =
    effective === "image" || effective === "gif" || effective === "video"
      ? "original"
      : effective === "logo"
        ? "palette"
        : "mono"
  const defaultFit: FitMode = effective === "logo" ? "center" : "stretch"
  const defaultEffect: CreateEffectChoice = effective === "logo" ? "shimmer" : "none"
  const defaultPresetIndex = effective === "logo" ? 3 : 0

  return {
    mode,
    source: initialSource,
    packId: derivePackId(initialSource, mode),
    idTouched: false,
    scope: "user",
    pinGit: false,
    style: defaultStyle,
    fit: defaultFit,
    effect: defaultEffect,
    presetIndex: defaultPresetIndex,
  }
}

export function updateFormSource(form: CreateFormState, nextSource: string, projectRoot?: string): CreateFormState {
  const analysis = analyzeCreateSource(nextSource, form.mode, projectRoot)
  const nextPackId = form.idTouched ? form.packId : derivePackId(nextSource, form.mode)
  let nextStyle = form.style
  if (
    form.mode === "auto" &&
    (analysis.detectedKind === "image" || analysis.detectedKind === "gif" || analysis.detectedKind === "video") &&
    form.style === "mono"
  ) {
    nextStyle = "original"
  }
  return {
    ...form,
    source: nextSource,
    packId: nextPackId,
    style: nextStyle,
  }
}

export function updateFormPackId(form: CreateFormState, nextPackId: string): CreateFormState {
  const normalized = nextPackId.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32)
  if (normalized.length === 0) {
    return {
      ...form,
      packId: derivePackId(form.source, form.mode),
      idTouched: false,
    }
  }
  return {
    ...form,
    packId: normalized,
    idTouched: true,
  }
}

function cycleItem<T>(items: readonly T[], current: T, delta: number): T {
  const idx = items.indexOf(current)
  const start = idx >= 0 ? idx : 0
  return items[(start + delta + items.length) % items.length] ?? current
}

export function cycleFormField(
  form: CreateFormState,
  field: "mode" | "scope" | "pinGit" | "style" | "fit" | "effect" | "preset",
  delta: number,
): CreateFormState {
  switch (field) {
    case "mode": {
      const nextMode = cycleItem(CREATE_MODES, form.mode, delta)
      const nextPackId = form.idTouched ? form.packId : derivePackId(form.source, nextMode)
      const nextStyle: StyleName =
        nextMode === "image" || nextMode === "gif" || nextMode === "video"
          ? "original"
          : nextMode === "logo"
            ? "palette"
            : form.style
      const nextFit: FitMode = nextMode === "logo" ? "center" : form.fit
      const nextPresetIndex = nextMode === "logo" ? 3 : form.presetIndex
      return {
        ...form,
        mode: nextMode,
        packId: nextPackId,
        style: nextStyle,
        fit: nextFit,
        presetIndex: nextPresetIndex,
      }
    }
    case "scope": {
      const nextScope = cycleItem(CREATE_SCOPES, form.scope, delta)
      return {
        ...form,
        scope: nextScope,
        pinGit: nextScope === "project" ? true : form.pinGit,
      }
    }
    case "pinGit":
      return { ...form, pinGit: !form.pinGit }
    case "style":
      return { ...form, style: cycleItem(STYLE_NAMES, form.style, delta) }
    case "fit":
      return { ...form, fit: cycleItem(FIT_MODES, form.fit, delta) }
    case "effect":
      return { ...form, effect: cycleItem(CREATE_EFFECT_CHOICES, form.effect, delta) }
    case "preset": {
      const count = SIZE_MOTION_PRESETS.length
      const nextIndex = (form.presetIndex + delta + count) % count
      return { ...form, presetIndex: nextIndex }
    }
  }
}

export function targetPackDir(
  form: Pick<CreateFormState, "scope" | "packId">,
  roots: Pick<ArtState["roots"], "projectArts" | "globalArts">,
): string {
  const base = form.scope === "project" ? roots.projectArts : roots.globalArts
  return path.join(base, form.packId)
}

export function buildCompactAiPrompt(
  form: CreateFormState,
  roots: Pick<ArtState["roots"], "projectArts" | "globalArts">,
): string {
  const preset = SIZE_MOTION_PRESETS[form.presetIndex] ?? SIZE_MOTION_PRESETS[0]!
  const outDir = targetPackDir(form, roots)
  const idea = cleanSourceInput(form.source) || (form.mode === "logo" ? "bold OPENCODE emblem" : "animated ASCII background")
  const isLogo = form.mode === "logo"
  const effectClause = isLogo && form.effect !== "none" ? `, effect: ${form.effect}` : ""
  const pinClause = form.pinGit ? `, and pin "pack": "${form.packId}" in .opencode/art.json` : ""

  if (isLogo) {
    return [
      `Create an opencode-art canvas pack "${form.packId}" in "${outDir}" (${preset.cols}x${preset.rows}, ${preset.fps} fps, style: ${form.style}, fit: ${form.fit}${effectClause})${pinClause}. Write art.json and canvas.txt, validate, preview, and tell me /art set ${form.packId}.`,
      `Artwork: ${idea}`,
    ].join("\n")
  }

  return [
    `Create an opencode-art scene pack "${form.packId}" in "${outDir}" (${preset.cols}x${preset.rows}, ${preset.fps} fps, ${preset.loop}s loop, style: ${form.style}, fit: ${form.fit})${pinClause}. Init, write deterministic scene.mjs, bake, validate, preview, and tell me /art set ${form.packId}.`,
    `Scene: ${idea}`,
  ].join("\n")
}

export function defaultEffectSpec(effect: EffectType): EffectSpec {
  switch (effect) {
    case "shimmer":
      return { type: "shimmer", intensity: 0.3, speed: 1, seed: 7 }
    case "wave":
      return { type: "wave", intensity: 0.3, speed: 1, axis: "x" }
    case "drift":
      return { type: "drift", intensity: 0.3, speed: 1, axis: "x" }
    case "twinkle":
      return { type: "twinkle", intensity: 0.25, speed: 1, seed: 11 }
    case "scanline":
      return { type: "scanline", intensity: 0.35, speed: 1, axis: "y" }
  }
}

async function applyPostBakeManifestOverrides(
  outDir: string,
  form: CreateFormState,
  isCanvas: boolean,
): Promise<void> {
  const manifestPath = path.join(outDir, "art.json")
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>
  raw.defaultStyle = form.style
  raw.fit = form.fit
  if (isCanvas && form.effect !== "none") {
    raw.effects = [defaultEffectSpec(form.effect)]
  }
  await writeFile(manifestPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8")
  const errors = await validatePackDir(outDir)
  if (errors.length > 0) {
    throw new Error(errors[0]?.message ?? "baked pack failed validation")
  }
}

export async function pinPackInProjectSettings(
  projectRoot: string,
  form: Pick<CreateFormState, "packId" | "style">,
  fps: number,
): Promise<void> {
  const dir = path.join(projectRoot, ".opencode")
  const file = path.join(dir, "art.json")
  let existing: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>
    }
  } catch {
    // Start with a fresh object if .opencode/art.json does not exist yet.
  }
  const next = {
    ...existing,
    version: 1,
    enabled: true,
    pack: form.packId,
    style: form.style,
    fps,
  }
  await mkdir(dir, { recursive: true })
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8")
}

export async function bakeMediaFromForm(
  form: CreateFormState,
  roots: Pick<ArtState["roots"], "projectRoot" | "projectArts" | "globalArts">,
): Promise<{ readonly ok: true; readonly outDir: string } | { readonly ok: false; readonly error: string }> {
  if (!PACK_ID_PATTERN.test(form.packId)) {
    return {
      ok: false,
      error: `Pack ID "${form.packId}" is invalid. Use 1-32 lowercase letters, digits, "-" or "_", starting with a letter or digit.`,
    }
  }
  const analysis = analyzeCreateSource(form.source, form.mode, roots.projectRoot)
  if (!analysis.valid || !analysis.resolvedPath) {
    return { ok: false, error: analysis.summary }
  }

  const preset = SIZE_MOTION_PRESETS[form.presetIndex] ?? SIZE_MOTION_PRESETS[0]!
  const outDir = targetPackDir(form, roots)
  const cliPath = fileURLToPath(new URL("../../bin/opencode-art.cjs", import.meta.url))
  const nodeCommand = "bun" in process.versions ? "node" : process.execPath
  const args = [
    cliPath,
    "bake",
    analysis.resolvedPath,
    "--out",
    outDir,
    "--cols",
    String(preset.cols),
    "--rows",
    String(preset.rows),
    "--fps",
    String(preset.fps),
    "--loop",
    String(preset.loop),
    "--fit",
    form.fit,
  ]
  if (form.style === "mono") {
    args.push("--mono")
  }

  try {
    const result = await runChild(nodeCommand, args, { timeoutMs: 120_000 })
    if (result.timedOut) {
      return { ok: false, error: "Bake timed out after 120s. Try a shorter loop or smaller grid." }
    }
    if (result.code !== 0) {
      const detail = (result.stderr || String(result.stdout)).trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" ")
      return { ok: false, error: detail || `Bake exited with code ${result.code}` }
    }
    const isCanvas = analysis.detectedKind === "image"
    await applyPostBakeManifestOverrides(outDir, form, isCanvas)
    if (form.pinGit) {
      await pinPackInProjectSettings(roots.projectRoot, form, preset.fps)
    }
    return { ok: true, outDir }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function isUsableEditor(node: unknown): node is EditablePromptTarget {
  if (!node || typeof node !== "object") return false
  const candidate = node as EditablePromptTarget
  if (candidate.isDestroyed === true || candidate.visible === false) return false
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

export async function submitCreateForm(
  context: Context,
  state: ArtState,
  form: CreateFormState,
  preferredEditor?: EditablePromptTarget | null,
): Promise<{ readonly ok: true; readonly mode: "baked" | "prompt" } | { readonly ok: false; readonly error: string }> {
  if (!PACK_ID_PATTERN.test(form.packId)) {
    return {
      ok: false,
      error: `Pack ID "${form.packId}" is invalid. Use 1-32 lowercase letters, digits, "-" or "_", starting with a letter or digit.`,
    }
  }

  const analysis = analyzeCreateSource(form.source, form.mode, state.roots.projectRoot)
  if (!analysis.valid) {
    return { ok: false, error: analysis.summary }
  }

  if (analysis.execution === "bake") {
    const baked = await bakeMediaFromForm(form, state.roots)
    if (!baked.ok) return baked
    await state.reload()
    await state.setPack(form.packId)
    await state.setStyle(form.style)
    const preset = SIZE_MOTION_PRESETS[form.presetIndex] ?? SIZE_MOTION_PRESETS[0]!
    await state.setFps(preset.fps)
    context.ui.toast.show({
      message: `Baked and activated "${form.packId}" (${form.scope})${form.pinGit ? " · pinned in .opencode/art.json" : ""}.`,
      variant: "success",
    })
    return { ok: true, mode: "baked" }
  }

  const prompt = buildCompactAiPrompt(form, state.roots)
  context.ui.dialog.clear()
  const result = prefillPromptEditor(context, prompt, preferredEditor)
  if (result.prefilled) {
    context.ui.toast.show({
      message: `Ready in chat — press Enter to generate "${form.packId}".`,
      variant: "success",
    })
  } else {
    if (result.copied) {
      context.ui.toast.show({
        message: `Copied prompt for "${form.packId}" to clipboard.`,
        variant: "info",
      })
    }
    await safeAlert(context, `Create ASCII Art — ${form.packId}`, prompt)
  }
  return { ok: true, mode: "prompt" }
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
