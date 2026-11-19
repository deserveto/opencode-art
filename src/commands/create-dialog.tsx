/** @jsxImportSource @opentui/solid */
import { BoxRenderable, RenderableEvents, type KeyEvent, type PasteEvent } from "@opentui/core"
import { _render, removeNode, useRenderer, type DomNode } from "@opentui/solid"
import { onCleanup } from "solid-js"
import type { Plugin } from "@opencode/plugin/tui"
import type { ResolvedTheme } from "@opencode/theme/tui"
import { FIT_MODES, STYLE_NAMES } from "../art/index.ts"
import type { ArtState } from "../plugin/state.ts"
import { fitDialogWidth } from "./layout.ts"
import {
  CREATE_EFFECT_CHOICES,
  CREATE_MODES,
  CREATE_SCOPES,
  SIZE_MOTION_PRESETS,
  analyzeCreateSource,
  cleanSourceInput,
  createInitialFormState,
  cycleFormField,
  submitCreateForm,
  targetPackDir,
  updateFormPackId,
  updateFormSource,
  type CreateFormState,
  type EditablePromptTarget,
} from "./templates.ts"

export interface CreateDialogProps {
  readonly context: Plugin.Context
  readonly state: ArtState
  readonly theme: ResolvedTheme
  readonly formatPath: (value: string) => string
  readonly close: () => void
  readonly preferredEditor?: EditablePromptTarget | null
  readonly initialTemplate?: string
  readonly initialSource?: string
}

const ROW_COUNT = 9

function deleteLastWord(value: string): string {
  const trimmed = value.replace(/\s+$/, "")
  const idx = Math.max(trimmed.lastIndexOf(" "), trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  return idx >= 0 ? trimmed.slice(0, idx + 1).trimEnd() : ""
}

function renderChoices<T extends string>(
  items: readonly T[],
  current: T,
  formatItem?: (item: T) => string,
): string {
  return items
    .map((item) => {
      const label = formatItem ? formatItem(item) : item
      return item === current ? `[ ${label} ]` : label
    })
    .join(" · ")
}

export function ArtCreateDialog(props: CreateDialogProps) {
  const renderer = useRenderer()

  let host: BoxRenderable | null = null
  let disposeBody: (() => void) | null = null
  let disposed = false
  let renderScheduled = false

  let activeRow = 0
  let busy = false
  let statusError: string | null = null
  let form: CreateFormState = createInitialFormState({
    template: props.initialTemplate,
    source: props.initialSource,
    projectRoot: props.state.roots.projectRoot,
  })

  function renderNow(): void {
    renderScheduled = false
    if (disposed || !host || host.isDestroyed) return
    disposeBody?.()
    disposeBody = null
    for (const child of host.getChildren()) {
      removeNode(host, child)
    }
    disposeBody = _render(() => renderBody(), host)
    host.requestRender()
  }

  function scheduleRender(): void {
    if (disposed || !host || host.isDestroyed || renderScheduled) return
    renderScheduled = true
    queueMicrotask(renderNow)
  }

  function consume(event: { preventDefault: () => void; stopPropagation?: () => void }): void {
    event.preventDefault()
    event.stopPropagation?.()
  }

  function moveRow(delta: number): void {
    activeRow = (activeRow + delta + ROW_COUNT) % ROW_COUNT
    statusError = null
    scheduleRender()
  }

  function cycleActiveRow(delta: number): void {
    statusError = null
    switch (activeRow) {
      case 1:
        form = cycleFormField(form, "mode", delta)
        break
      case 3:
        form = cycleFormField(form, "scope", delta)
        break
      case 4:
        form = cycleFormField(form, "pinGit", delta)
        break
      case 5:
        form = cycleFormField(form, "style", delta)
        break
      case 6:
        form = cycleFormField(form, "fit", delta)
        break
      case 7:
        form = cycleFormField(form, "effect", delta)
        break
      case 8:
        form = cycleFormField(form, "preset", delta)
        break
      default:
        return
    }
    scheduleRender()
  }

  async function runSubmit(): Promise<void> {
    if (busy || disposed) return
    const analysis = analyzeCreateSource(form.source, form.mode, props.state.roots.projectRoot)
    if (!analysis.valid) {
      statusError = analysis.summary
      activeRow = 0
      scheduleRender()
      return
    }

    statusError = null
    if (analysis.execution === "bake") {
      busy = true
      scheduleRender()
    }

    const result = await submitCreateForm(props.context, props.state, form, props.preferredEditor)
    if (disposed) return
    busy = false
    if (!result.ok) {
      statusError = result.error
      scheduleRender()
      return
    }
    if (result.mode === "baked") {
      props.close()
    }
  }

  function onPaste(event: PasteEvent): void {
    if (disposed || busy) return
    consume(event)
    const raw = new TextDecoder().decode(event.bytes)
    const cleaned = raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\r\n\t]+/g, " ").trim()
    if (!cleaned) return
    statusError = null
    if (activeRow === 2) {
      form = updateFormPackId(form, form.packId + cleaned)
    } else {
      const normalized = cleanSourceInput(cleaned)
      const looksLikePath =
        /^[a-zA-Z]:[\\/]/.test(normalized) ||
        normalized.startsWith("./") ||
        normalized.startsWith("../") ||
        normalized.startsWith(".\\") ||
        normalized.startsWith("..\\") ||
        normalized.startsWith("~/") ||
        normalized.startsWith("~\\") ||
        normalized.startsWith("/")
      const nextSource =
        activeRow === 0 && form.source.length > 0 && !looksLikePath
          ? `${form.source} ${normalized}`
          : normalized
      form = updateFormSource(form, nextSource, props.state.roots.projectRoot)
      activeRow = 0
    }
    scheduleRender()
  }

  function onKey(key: KeyEvent): void {
    if (disposed) return

    if (key.name === "escape") {
      consume(key)
      if (!busy) props.close()
      return
    }

    if (busy) {
      consume(key)
      return
    }

    const onTextRow = activeRow === 0 || activeRow === 2

    if (key.name === "up" || (key.name === "tab" && key.shift)) {
      consume(key)
      moveRow(-1)
      return
    }
    if (key.name === "down" || (key.name === "tab" && !key.shift)) {
      consume(key)
      moveRow(1)
      return
    }
    if (key.name === "return" || key.name === "enter") {
      consume(key)
      void runSubmit()
      return
    }

    if (onTextRow) {
      if (key.ctrl && key.name === "u") {
        consume(key)
        statusError = null
        form =
          activeRow === 0
            ? updateFormSource(form, "", props.state.roots.projectRoot)
            : updateFormPackId(form, "")
        scheduleRender()
        return
      }
      if ((key.ctrl && key.name === "w") || ((key.ctrl || key.meta || key.option) && key.name === "backspace")) {
        consume(key)
        statusError = null
        form =
          activeRow === 0
            ? updateFormSource(form, deleteLastWord(form.source), props.state.roots.projectRoot)
            : updateFormPackId(form, "")
        scheduleRender()
        return
      }
      if (key.name === "backspace" || key.name === "delete") {
        consume(key)
        statusError = null
        if (activeRow === 0) {
          form = updateFormSource(form, form.source.slice(0, -1), props.state.roots.projectRoot)
        } else {
          const next = form.idTouched ? form.packId.slice(0, -1) : ""
          form = updateFormPackId(form, next)
        }
        scheduleRender()
        return
      }
      if (!key.ctrl && !key.meta && !key.option) {
        const char = key.sequence.length === 1 ? key.sequence : key.name === "space" ? " " : ""
        if (char.length === 1 && char >= " " && char !== "\x7f") {
          consume(key)
          statusError = null
          if (activeRow === 0) {
            form = updateFormSource(form, form.source + char, props.state.roots.projectRoot)
          } else {
            const base = form.idTouched ? form.packId : ""
            form = updateFormPackId(form, base + char)
          }
          scheduleRender()
          return
        }
      }
      return
    }

    if (key.ctrl || key.meta || key.option) return

    if (key.name === "q") {
      consume(key)
      props.close()
      return
    }
    if (key.name === "k") {
      consume(key)
      moveRow(-1)
      return
    }
    if (key.name === "j") {
      consume(key)
      moveRow(1)
      return
    }
    if (key.name === "left" || key.name === "-" || key.name === "h") {
      consume(key)
      cycleActiveRow(-1)
      return
    }
    if (key.name === "right" || key.name === "+" || key.name === "=" || key.name === "space" || key.name === "l") {
      consume(key)
      cycleActiveRow(1)
      return
    }
  }

  function onResize(): void {
    scheduleRender()
  }

  if (typeof renderer.keyInput?.prependListener === "function") {
    renderer.keyInput.prependListener("keypress", onKey)
    renderer.keyInput.prependListener("paste", onPaste)
  } else {
    renderer.keyInput?.on("keypress", onKey)
    renderer.keyInput?.on("paste", onPaste)
  }
  renderer.on?.("resize", onResize)

  function disposeDialog(): void {
    if (disposed) return
    disposed = true
    renderer.keyInput?.off("keypress", onKey)
    renderer.keyInput?.off("paste", onPaste)
    renderer.off?.("resize", onResize)
    disposeBody?.()
    disposeBody = null
  }

  onCleanup(disposeDialog)

  function renderBody(): DomNode {
    const border = props.theme.border.base
    const faint = props.theme.text.faint
    const muted = props.theme.text.muted
    const base = props.theme.text.base
    const errorFg = props.theme.text.feedback.error.base

    const termWidth = renderer.width || 80
    const dialogWidth = Math.min(96, fitDialogWidth(termWidth))
    const analysis = analyzeCreateSource(form.source, form.mode, props.state.roots.projectRoot)
    const preset = SIZE_MOTION_PRESETS[form.presetIndex] ?? SIZE_MOTION_PRESETS[0]!
    const outPath = props.formatPath(targetPackDir(form, props.state.roots))
    const supportsEffects = analysis.effectiveKind === "image" || analysis.effectiveKind === "logo"

    const rowColor = (row: number) => (activeRow === row ? base : muted)
    const cursorPrefix = (row: number) => (activeRow === row ? "> " : "  ")

    const sourceDisplay =
      form.source.length > 0
        ? `${form.source}${activeRow === 0 ? "_" : ""}`
        : activeRow === 0
          ? "_ (Paste image/GIF/video path or type an art idea…)"
          : "(Paste image/GIF/video path or type an art idea…)"

    const summaryColor =
      analysis.detectedKind === "unsupported-file" ||
      (analysis.execution === "bake" && form.source.length > 0 && !analysis.exists)
        ? errorFg
        : analysis.valid
          ? base
          : faint

    const actionBanner = busy
      ? `Baking "${form.packId}" via opencode-art CLI…`
      : analysis.execution === "bake"
        ? `[ Enter: Direct CLI Bake & Activate "${form.packId}" (0 LLM tokens) ]`
        : `[ Enter: Insert 2-Line Chat Prompt for "${form.packId}" ]`

    return (
      <box
        flexDirection="column"
        width={dialogWidth}
        border
        borderStyle="rounded"
        borderColor={border}
        title=" Create ASCII Art "
        titleAlignment="left"
        padding={1}
        gap={1}
      >
        <box flexDirection="column">
          <text fg={rowColor(0)} wrapMode="word">
            {cursorPrefix(0)}Source{"    "}
            <span style={{ fg: form.source.length > 0 ? base : faint }}>{sourceDisplay}</span>
          </text>
          <text fg={summaryColor} wrapMode="word">
            {"            "}
            {analysis.summary}
          </text>
        </box>

        <box flexDirection="column">
          <text fg={rowColor(1)} wrapMode="word">
            {cursorPrefix(1)}Mode{"      "}
            {renderChoices(CREATE_MODES, form.mode, (m) =>
              m === "auto" ? `auto → ${analysis.effectiveKind}` : m,
            )}
          </text>
          <text fg={rowColor(2)} wrapMode="none" truncate>
            {cursorPrefix(2)}Pack ID{"   "}
            <span style={{ fg: base }}>
              {form.packId}
              {activeRow === 2 ? "_" : ""}
            </span>
            <span style={{ fg: faint }}>{form.idTouched ? " (custom)" : " (auto from source)"}</span>
          </text>
          <text fg={rowColor(3)} wrapMode="word">
            {cursorPrefix(3)}Scope{"     "}
            {renderChoices(CREATE_SCOPES, form.scope, (s) =>
              s === "user" ? "user (~/.config/opencode/arts)" : "project (.opencode/arts · Git)",
            )}
          </text>
          <text fg={rowColor(4)} wrapMode="word">
            {cursorPrefix(4)}Pin Git{"   "}
            {form.pinGit ? "no · [ yes (write .opencode/art.json) ]" : "[ no ] · yes (write .opencode/art.json)"}
          </text>
          <text fg={rowColor(5)} wrapMode="word">
            {cursorPrefix(5)}Style{"     "}
            {renderChoices(STYLE_NAMES, form.style)}
          </text>
          <text fg={rowColor(6)} wrapMode="word">
            {cursorPrefix(6)}Fit{"       "}
            {renderChoices(FIT_MODES, form.fit)}
          </text>
          <text fg={rowColor(7)} wrapMode="word">
            {cursorPrefix(7)}Effect{"    "}
            {supportsEffects ? (
              renderChoices(CREATE_EFFECT_CHOICES, form.effect)
            ) : (
              <span style={{ fg: faint }}>(motion baked into frames — effects apply to Image / Logo only)</span>
            )}
          </text>
          <text fg={rowColor(8)} wrapMode="word">
            {cursorPrefix(8)}Grid/FPS{"  "}
            [ {preset.label} ]{" "}
            <span style={{ fg: faint }}>
              ({form.presetIndex + 1}/{SIZE_MOTION_PRESETS.length})
            </span>
          </text>
        </box>

        <box flexDirection="column">
          <text fg={faint} wrapMode="none" truncate>
            {"  "}Output{"    "}
            {outPath}
          </text>
          <text fg={base} wrapMode="word">
            {"  "}
            {actionBanner}
          </text>
          {statusError ? (
            <text fg={errorFg} wrapMode="word">
              {"  "}Error: {statusError}
            </text>
          ) : null}
        </box>

        <text fg={faint} wrapMode="word">
          Up/Down or Tab field · Left/Right option · Type or Paste path/idea · Ctrl+U clear · Enter run · Esc close
        </text>
      </box>
    )
  }

  return (
    <box
      flexDirection="column"
      ref={(el: BoxRenderable) => {
        host = el
        el.on(RenderableEvents.DESTROYED, disposeDialog)
        renderNow()
      }}
    />
  )
}
