/** @jsxImportSource @opentui/solid */
import { BoxRenderable, RGBA, RenderableEvents, type KeyEvent } from "@opentui/core"
import { _render, removeNode, useRenderer, type DomNode } from "@opentui/solid"
import { onCleanup } from "solid-js"
import type { ResolvedTheme } from "@opencode/theme/tui"
import type { Pack, PackCandidate, StyleName } from "../art/types.ts"
import { themeColors } from "../plugin/host.ts"
import type { ArtState } from "../plugin/state.ts"
import type { RGBA4 } from "../render/types.ts"
import { fitDialogWidth, previewBox } from "./layout.ts"
import { buildPreview } from "./preview.ts"

interface DialogProps {
  readonly state: ArtState
  readonly theme: ResolvedTheme
  readonly formatPath: (value: string) => string
  readonly close: () => void
  readonly onCreate?: () => void
}

const MAX_VISIBLE_PACKS = 12
const MAX_COLOR_CACHE = 4096
const DIM_STEPS: readonly number[] = [0, 25, 50, 75]

function shortName(name: string): string {
  return name.length > 12 ? `${name.slice(0, 11)}~` : name
}

function blendRgba(color: RGBA4, target: RGBA4, dim: number): RGBA4 {
  const t = Math.min(0.8, Math.max(0, dim / 100))
  if (t <= 0) return color
  return [
    Math.round(color[0] + (target[0] - color[0]) * t),
    Math.round(color[1] + (target[1] - color[1]) * t),
    Math.round(color[2] + (target[2] - color[2]) * t),
    color[3],
  ]
}

export function ArtDialog(props: DialogProps) {
  const renderer = useRenderer()
  const colors = new Map<string, RGBA>()

  let host: BoxRenderable | null = null
  let disposeBody: (() => void) | null = null
  let disposed = false
  let renderScheduled = false

  let searchMode = false
  let searchQuery = ""
  let selected = 0
  let selectedId: string | null = props.state.activeId()
  let previewPack: Pack | null = null
  let previewError: string | null = null
  let previewLoading = false
  let loadedKey: string | null = null
  let loadSeq = 0
  let note: string | null = null

  let frameIndex = 0
  let animTime = 0
  let animating = false
  let animTimer: ReturnType<typeof setInterval> | null = null
  let timerFps = 0

  let lastCandidates = props.state.candidates()
  let lastActivePack = props.state.pack()

  function filteredCandidates(): readonly PackCandidate[] {
    const all = props.state.candidates()
    const needle = searchQuery.trim().toLowerCase()
    if (!needle) return all
    return all.filter(
      (candidate) =>
        candidate.id.toLowerCase().includes(needle) || candidate.manifest.name.toLowerCase().includes(needle),
    )
  }

  function currentSelectedIndex(items: readonly PackCandidate[]): number {
    if (items.length === 0) return 0
    if (selectedId !== null) {
      const idx = items.findIndex((candidate) => candidate.id === selectedId)
      if (idx >= 0) {
        selected = idx
        return idx
      }
    }
    const clamped = Math.min(Math.max(0, selected), items.length - 1)
    selected = clamped
    selectedId = items[clamped]?.id ?? null
    return clamped
  }

  function currentCandidate(): PackCandidate | undefined {
    const items = filteredCandidates()
    return items[currentSelectedIndex(items)]
  }

  function rgba(color: readonly [number, number, number, number]): RGBA {
    const key = color.join(",")
    const cached = colors.get(key)
    if (cached) return cached
    if (colors.size >= MAX_COLOR_CACHE) colors.clear()
    const value = RGBA.fromInts(color[0], color[1], color[2], color[3])
    colors.set(key, value)
    return value
  }

  function availableStyles(pack?: Pack | null): readonly StyleName[] {
    const target = pack ?? previewPack
    if (!target) return ["mono", "theme"]
    const styles: StyleName[] = ["mono", "theme"]
    if (target.manifest.palette?.length) styles.push("palette")
    if (target.frames.some((frame) => frame.colors)) styles.push("original")
    return styles
  }

  function stopTimer(): void {
    if (animTimer !== null) {
      clearInterval(animTimer)
      animTimer = null
      timerFps = 0
    }
  }

  function syncTimer(): void {
    const pack = previewPack
    const moving =
      pack !== null && (pack.kind === "frames" ? pack.frames.length > 1 : pack.manifest.effects.length > 0)
    if (!animating || disposed || !moving) {
      stopTimer()
      return
    }
    const fps = Math.max(1, Math.min(30, props.state.fps()))
    if (animTimer !== null && timerFps === fps) return
    stopTimer()
    timerFps = fps
    const intervalMs = Math.max(33, Math.round(1000 / fps))
    animTimer = setInterval(() => {
      if (disposed || !animating || !previewPack) {
        stopTimer()
        return
      }
      if (previewPack.kind === "frames" && previewPack.frames.length > 1) {
        frameIndex = (frameIndex + 1) % previewPack.frames.length
      } else if (previewPack.kind === "canvas" && previewPack.manifest.effects.length > 0) {
        animTime += intervalMs / 1000
      }
      scheduleRender()
    }, intervalMs)
  }

  function loadPreview(forceReload: boolean): void {
    const candidate = currentCandidate()
    if (!candidate) {
      loadSeq++
      loadedKey = null
      previewPack = null
      previewError = null
      previewLoading = false
      frameIndex = 0
      animTime = 0
      syncTimer()
      return
    }
    const key = `${candidate.id}:${candidate.dir}`
    if (!forceReload && loadedKey === key && (previewPack !== null || previewLoading || previewError !== null)) {
      return
    }
    const changedPack = loadedKey !== key
    loadedKey = key
    if (changedPack) {
      previewPack = null
      frameIndex = 0
      animTime = 0
    }
    previewLoading = true
    previewError = null
    const seq = ++loadSeq
    void props.state.load(candidate.id).then(
      (result) => {
        if (disposed || seq !== loadSeq) return
        previewLoading = false
        if (result.ok) {
          previewPack = result.value
          previewError = null
          if (frameIndex >= result.value.frames.length) frameIndex = 0
        } else {
          previewPack = null
          previewError = result.error[0]?.message ?? "could not load this pack"
        }
        syncTimer()
        scheduleRender()
      },
      (error: unknown) => {
        if (disposed || seq !== loadSeq) return
        previewLoading = false
        previewPack = null
        previewError = error instanceof Error ? error.message : String(error)
        syncTimer()
        scheduleRender()
      },
    )
  }

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

  function move(delta: number): void {
    const items = filteredCandidates()
    if (items.length === 0) return
    const nextIndex = (currentSelectedIndex(items) + delta + items.length) % items.length
    selected = nextIndex
    selectedId = items[nextIndex]?.id ?? null
    note = null
    loadPreview(false)
    scheduleRender()
  }

  function cycleStyle(): void {
    const styles = availableStyles()
    const resolved = previewPack ? props.state.resolve(previewPack) : null
    const requested = props.state.settings.effective().style ?? resolved?.effective ?? styles[0] ?? "mono"
    const position = styles.indexOf(requested as StyleName)
    const next = styles[(position + 1) % styles.length] ?? "mono"
    void props.state.setStyle(next).then(() => {
      if (disposed) return
      note = `Style: ${next}`
      scheduleRender()
    })
  }

  function cycleDim(): void {
    const currentDim = props.state.dim()
    const nextDim = DIM_STEPS.find((step) => step > currentDim) ?? 0
    void props.state.setDim(nextDim).then(() => {
      if (disposed) return
      note = `Dim: ${props.state.dim()}%`
      scheduleRender()
    })
  }

  function togglePlay(): void {
    animating = !animating
    syncTimer()
    note = animating ? "Preview playing" : "Preview paused"
    scheduleRender()
  }

  function stepFrame(delta: number): void {
    animating = false
    stopTimer()
    const pack = previewPack
    if (pack && pack.kind === "frames" && pack.frames.length > 1) {
      frameIndex = (frameIndex + delta + pack.frames.length) % pack.frames.length
      note = `Frame ${frameIndex + 1}/${pack.frames.length}`
    } else if (pack && pack.kind === "canvas" && pack.manifest.effects.length > 0) {
      const step = 1 / Math.max(1, props.state.fps())
      animTime = Math.max(0, animTime + delta * step)
      note = `Effect t=${animTime.toFixed(2)}s`
    }
    scheduleRender()
  }

  function close(): void {
    stopTimer()
    props.close()
  }

  function consume(key: KeyEvent): void {
    key.preventDefault()
    key.stopPropagation?.()
  }

  function onKey(key: KeyEvent): void {
    if (disposed) return

    if (searchMode) {
      if (key.name === "escape" || key.name === "return" || key.name === "enter") {
        consume(key)
        searchMode = false
        scheduleRender()
        return
      }
      if (key.name === "up") {
        consume(key)
        move(-1)
        return
      }
      if (key.name === "down") {
        consume(key)
        move(1)
        return
      }
      if (key.name === "backspace") {
        consume(key)
        if (searchQuery.length > 0) {
          searchQuery = searchQuery.slice(0, -1)
          selected = 0
          selectedId = filteredCandidates()[0]?.id ?? null
          note = null
          loadPreview(false)
          scheduleRender()
        }
        return
      }
      if (!key.ctrl && !key.meta && !key.option) {
        const char = key.sequence.length === 1 ? key.sequence : key.name === "space" ? " " : ""
        if (char.length === 1 && char >= " " && char !== "\x7f") {
          consume(key)
          searchQuery += char
          selected = 0
          selectedId = filteredCandidates()[0]?.id ?? null
          note = null
          loadPreview(false)
          scheduleRender()
        }
      }
      return
    }

    if (key.ctrl || key.meta || key.option) return

    if (key.name === "escape" || key.name === "q") {
      consume(key)
      close()
      return
    }
    if (key.name === "/" || key.sequence === "/") {
      consume(key)
      searchMode = true
      note = null
      scheduleRender()
      return
    }
    if (key.name === "up" || key.name === "k") {
      consume(key)
      move(-1)
      return
    }
    if (key.name === "down" || key.name === "j") {
      consume(key)
      move(1)
      return
    }
    if (key.name === "return" || key.name === "enter") {
      consume(key)
      const candidate = currentCandidate()
      if (candidate) {
        void props.state.setPack(candidate.id).then((ok) => {
          if (disposed) return
          note = ok ? `Selected ${candidate.id}` : null
          loadPreview(true)
          scheduleRender()
        })
      }
      return
    }
    if (key.name === "e") {
      consume(key)
      void props.state.toggleEnabled().then(() => {
        if (disposed) return
        note = props.state.enabled() ? "Art on" : "Art off"
        scheduleRender()
      })
      return
    }
    if (key.name === "s") {
      consume(key)
      cycleStyle()
      return
    }
    if (key.name === "d") {
      consume(key)
      cycleDim()
      return
    }
    if (key.name === "p") {
      consume(key)
      togglePlay()
      return
    }
    if (key.name === "[" || key.sequence === "[") {
      consume(key)
      stepFrame(-1)
      return
    }
    if (key.name === "]" || key.sequence === "]") {
      consume(key)
      stepFrame(1)
      return
    }
    if (key.name === "left" || key.name === "-") {
      consume(key)
      void props.state.setFps(props.state.fps() - 1)
      return
    }
    if (key.name === "right" || key.name === "=" || key.name === "+") {
      consume(key)
      void props.state.setFps(props.state.fps() + 1)
      return
    }
    if (key.name === "r") {
      consume(key)
      void props.state.reload().then(() => {
        if (disposed) return
        loadPreview(true)
        note = "Packs reloaded"
        scheduleRender()
      })
      return
    }
    if (key.name === "c") {
      if (!props.onCreate) return
      consume(key)
      stopTimer()
      props.onCreate()
      return
    }
  }

  function onResize(): void {
    scheduleRender()
  }

  const unsubState = props.state.subscribe(() => {
    if (disposed) return
    const nextCandidates = props.state.candidates()
    const nextActivePack = props.state.pack()
    const structureChanged = nextCandidates !== lastCandidates || nextActivePack !== lastActivePack
    lastCandidates = nextCandidates
    lastActivePack = nextActivePack
    syncTimer()
    if (structureChanged) {
      loadPreview(true)
    }
    scheduleRender()
  })

  if (typeof renderer.keyInput?.prependListener === "function") {
    renderer.keyInput.prependListener("keypress", onKey)
  } else {
    renderer.keyInput?.on("keypress", onKey)
  }
  renderer.on?.("resize", onResize)

  function disposeDialog(): void {
    if (disposed) return
    disposed = true
    stopTimer()
    unsubState()
    renderer.keyInput?.off("keypress", onKey)
    renderer.off?.("resize", onResize)
    disposeBody?.()
    disposeBody = null
    colors.clear()
  }

  onCleanup(disposeDialog)
  loadPreview(false)

  function renderBody(): DomNode {
    const border = props.theme.border.base
    const faint = props.theme.text.faint
    const muted = props.theme.text.muted
    const base = props.theme.text.base

    const termWidth = renderer.width || 80
    const dialogWidth = fitDialogWidth(termWidth)
    const wide = dialogWidth >= 100
    const size = previewBox(
      termWidth,
      previewPack ? { cols: previewPack.manifest.cols, rows: previewPack.manifest.rows } : null,
    )

    const items = filteredCandidates()
    const allCount = props.state.candidates().length
    const active = props.state.activeId()
    const selIndex = currentSelectedIndex(items)

    const visibleCount = Math.min(MAX_VISIBLE_PACKS, items.length)
    const windowStart =
      items.length > MAX_VISIBLE_PACKS
        ? Math.max(0, Math.min(selIndex - Math.floor(MAX_VISIBLE_PACKS / 2), items.length - MAX_VISIBLE_PACKS))
        : 0
    const windowEnd = windowStart + visibleCount
    const visible = items.slice(windowStart, windowEnd)
    const aboveCount = windowStart
    const belowCount = items.length - windowEnd

    const resolved = previewPack ? props.state.resolve(previewPack) : null
    const dim = props.state.dim()
    const themeRGBA = themeColors(props.theme)
    const preview = previewPack
      ? buildPreview(previewPack, resolved ?? props.state.resolve(previewPack), size.width, size.height, {
          frameIndex,
          time: animTime,
          fps: props.state.fps(),
          animations: animating || animTime > 0,
          dim,
          background: themeRGBA.background,
          foreground: themeRGBA.base,
        })
      : []

    const fallbackColor = dim > 0 ? rgba(blendRgba(themeRGBA.faint, themeRGBA.background, dim)) : faint

    const headerText = previewPack
      ? (() => {
          const text = `${previewPack.manifest.name}${previewPack.manifest.description ? ` · ${previewPack.manifest.description}` : ""}`
          return text.length > size.width ? `${text.slice(0, Math.max(0, size.width - 1))}~` : text
        })()
      : ""

    const effectiveStyle = resolved?.effective ?? props.state.style()?.effective ?? "mono"
    const statusBits = [
      `Enabled: ${props.state.enabled() ? "yes" : "no"}`,
      `Style: ${effectiveStyle}${resolved && resolved.effective !== resolved.requested ? ` (from ${resolved.requested})` : ""}`,
      `FPS: ${props.state.fps()}`,
      `Dim: ${dim}%`,
      previewPack
        ? previewPack.kind === "canvas"
          ? animating && previewPack.manifest.effects.length > 0
            ? "Canvas (playing)"
            : "Canvas"
          : `Frames: ${frameIndex + 1}/${previewPack.frames.length}${animating ? " (playing)" : ""}`
        : "",
    ]
    const statusText = statusBits.filter(Boolean).join("   ")

    const caps = props.state.capabilities
    const capabilityText = !caps.color
      ? "no color"
      : caps.rgb
        ? "truecolor"
        : caps.ansi256
          ? "256 colors"
          : "16 colors"

    const countLabel = searchQuery.length > 0 ? `${items.length}/${allCount}` : `${allCount}`
    const problems = props.state.problems()

    return (
      <box
        flexDirection="column"
        width={dialogWidth}
        border
        borderStyle="rounded"
        borderColor={border}
        title=" ASCII Art "
        titleAlignment="left"
        padding={1}
        gap={1}
      >
        <box flexDirection={wide ? "row" : "column"} gap={1}>
          <box width={wide ? 34 : "100%"} flexDirection="column" flexShrink={0} overflow="hidden">
            <text fg={muted} wrapMode="none" truncate>
              Packs ({countLabel}){active ? ` · active: ${active}` : ""}
            </text>
            {searchMode || searchQuery.length > 0 ? (
              <text fg={searchMode ? base : muted} wrapMode="none" truncate>
                Filter: {searchQuery}
                {searchMode ? "_" : ""}
              </text>
            ) : null}
            {items.length === 0 ? (
              <text fg={faint}>{searchQuery ? `No packs match "${searchQuery}".` : "No packs found."}</text>
            ) : (
              <>
                {aboveCount > 0 ? (
                  <text fg={faint} wrapMode="none" truncate>
                    ↑ {aboveCount} more
                  </text>
                ) : null}
                {visible.map((candidate, offset) => {
                  const index = windowStart + offset
                  const isSelected = index === selIndex
                  return (
                    <text fg={isSelected ? base : muted} wrapMode="none" truncate>
                      {isSelected ? "> " : "  "}
                      {candidate.id}
                      {candidate.id === active ? "*" : " "}
                      <span style={{ fg: faint }}>
                        {" "}
                        {candidate.scope}
                      </span>
                      {"  "}
                      {shortName(candidate.manifest.name)}
                    </text>
                  )
                })}
                {belowCount > 0 ? (
                  <text fg={faint} wrapMode="none" truncate>
                    ↓ {belowCount} more
                  </text>
                ) : null}
              </>
            )}
          </box>
          <box
            width={size.width + 2}
            height={size.height + 4}
            flexDirection="column"
            flexShrink={0}
            border
            borderStyle="single"
            borderColor={border}
            title=" Preview "
            paddingX={1}
            overflow="hidden"
          >
            {preview.length === 0 ? (
              <box flexDirection="column">
                <text fg={muted}>
                  {previewLoading ? "Loading preview…" : (previewError ?? "Select a pack to preview it.")}
                </text>
                <text fg={faint} wrapMode="none" truncate>
                  {props.formatPath(props.state.roots.globalArts)}
                </text>
              </box>
            ) : (
              <>
                <text fg={faint} wrapMode="none" truncate>
                  {headerText}
                </text>
                <text fg={faint} wrapMode="none" truncate>
                  Styles: {availableStyles().join(" · ")}
                </text>
                {preview.map((line) => (
                  <text wrapMode="none">
                    {line.map((run) => (
                      <span style={{ fg: run.color ? rgba(run.color) : fallbackColor }}>{run.text}</span>
                    ))}
                  </text>
                ))}
              </>
            )}
          </box>
        </box>

        <text fg={muted} wrapMode="word">
          {statusText}
        </text>
        {note ? <text fg={muted}>{note}</text> : null}
        {problems.length > 0 ? (
          <box flexDirection="column">
            <text fg={props.theme.text.feedback.error.base}>Problems</text>
            {problems.slice(0, 4).map((problem) => (
              <text fg={faint} wrapMode="word">
                {problem.id}: {problem.errors[0]?.file ?? "art.json"} — {problem.errors[0]?.message ?? "invalid"}
              </text>
            ))}
          </box>
        ) : null}
        <text fg={faint} wrapMode="word">
          Up/Down select · Enter apply · / filter · c create · s style · d dim · p play · [/] frame · Left/Right fps · e on/off · r reload · Esc/q close
        </text>
        <text fg={faint} wrapMode="word">
          * active · {capabilityText} · /art create · {props.formatPath(props.state.roots.globalArts)}
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
