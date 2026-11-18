/** @jsxImportSource @opentui/solid */
import { RGBA } from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { ResolvedTheme } from "@opencode/theme/tui"
import type { Pack, PackCandidate, StyleName } from "../art/types.ts"
import type { ArtState } from "../plugin/state.ts"
import { buildPreview } from "./preview.ts"

interface DialogProps {
  readonly state: ArtState
  readonly theme: ResolvedTheme
  readonly close: () => void
}

function shortName(name: string): string {
  return name.length > 12 ? `${name.slice(0, 11)}~` : name
}

export function ArtDialog(props: DialogProps) {
  const dimensions = useTerminalDimensions()
  const [selected, setSelected] = createSignal(0)
  const [previewPack, setPreviewPack] = createSignal<Pack | null>(null)
  const [previewError, setPreviewError] = createSignal<string | null>(null)
  const [reloadTick, setReloadTick] = createSignal(0)
  const [note, setNote] = createSignal<string | null>(null)
  const colors = new Map<string, RGBA>()

  const list = createMemo(() => props.state.candidates())
  const active = createMemo(() => props.state.activeId())

  const selectedIndex = createMemo(() => Math.min(selected(), Math.max(0, list().length - 1)))
  const current = createMemo(() => list()[selectedIndex()])

  createEffect(() => {
    reloadTick()
    const candidate = current()
    if (!candidate) {
      setPreviewPack(null)
      return
    }
    let live = true
    void props.state.load(candidate.id).then((result) => {
      if (!live) return
      if (result.ok) {
        setPreviewPack(result.value)
        setPreviewError(null)
      } else {
        setPreviewPack(null)
        setPreviewError(result.error[0]?.message ?? "could not load this pack")
      }
    })
    onCleanup(() => {
      live = false
    })
  })

  const resolved = createMemo(() => {
    props.state.style()
    const pack = previewPack()
    return pack ? props.state.resolve(pack) : null
  })

  const preview = createMemo(() => {
    const pack = previewPack()
    if (!pack) return []
    const cols = Math.max(16, Math.min(76, dimensions().width - 50))
    const rows = Math.max(4, Math.min(18, dimensions().height - 16))
    return buildPreview(pack, resolved() ?? props.state.resolve(pack), cols, rows)
  })

  function rgba(color: readonly [number, number, number, number]): RGBA {
    const key = color.join(",")
    const cached = colors.get(key)
    if (cached) return cached
    const value = RGBA.fromInts(color[0], color[1], color[2], color[3])
    colors.set(key, value)
    return value
  }

  function badges(candidate: PackCandidate): string {
    let out = "mt"
    if (candidate.manifest.palette?.length) out += "p"
    const pack = previewPack()
    if (pack?.id === candidate.id && pack.frames.some((frame) => frame.colors)) out += "o"
    return out
  }

  function availableStyles(pack?: Pack | null): readonly StyleName[] {
    const target = pack ?? previewPack()
    if (!target) return ["mono", "theme"]
    const styles: StyleName[] = ["mono", "theme"]
    if (target.manifest.palette?.length) styles.push("palette")
    if (target.frames.some((frame) => frame.colors)) styles.push("original")
    return styles
  }

  function cycleStyle(): void {
    const styles = availableStyles()
    const requested = props.state.settings.effective().style ?? resolved()?.effective ?? styles[0] ?? "mono"
    const position = styles.indexOf(requested as StyleName)
    const next = styles[(position + 1) % styles.length] ?? "mono"
    void props.state.setStyle(next).then(() => setNote(`Style: ${next}`))
  }

  function move(delta: number): void {
    const count = list().length
    if (count === 0) return
    setSelected((value) => (value + delta + count) % count)
    setNote(null)
  }

  function close(): void {
    props.close()
  }

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q") {
      key.preventDefault()
      close()
      return
    }
    if (key.name === "up" || key.name === "k") {
      key.preventDefault()
      move(-1)
      return
    }
    if (key.name === "down" || key.name === "j") {
      key.preventDefault()
      move(1)
      return
    }
    if (key.name === "return" || key.name === "enter") {
      key.preventDefault()
      const candidate = current()
      if (candidate) {
        void props.state.setPack(candidate.id).then((ok) => setNote(ok ? `Selected ${candidate.id}` : null))
        setReloadTick((value) => value + 1)
      }
      return
    }
    if (key.name === "e") {
      key.preventDefault()
      void props.state.toggleEnabled().then(() => setNote(props.state.enabled() ? "Art on" : "Art off"))
      return
    }
    if (key.name === "s") {
      key.preventDefault()
      cycleStyle()
      return
    }
    if (key.name === "left" || key.name === "-") {
      key.preventDefault()
      void props.state.setFps(props.state.fps() - 1)
      return
    }
    if (key.name === "right" || key.name === "=" || key.name === "+") {
      key.preventDefault()
      void props.state.setFps(props.state.fps() + 1)
      return
    }
    if (key.name === "r") {
      key.preventDefault()
      void props.state.reload().then(() => {
        setReloadTick((value) => value + 1)
        setNote("Packs reloaded")
      })
    }
  })

  const border = props.theme.border.base
  const faint = props.theme.text.faint
  const muted = props.theme.text.muted
  const base = props.theme.text.base
  const accent = props.theme.text.base

  function sameLine(): string {
    const pack = previewPack()
    if (!pack) return ""
    return `${pack.manifest.name}${pack.manifest.description ? ` · ${pack.manifest.description}` : ""}`
  }

  const status = createMemo(() => {
    const style = resolved()
    const pack = previewPack()
    const effective = style?.effective ?? props.state.style()?.effective ?? "mono"
    const bits = [
      `Enabled: ${props.state.enabled() ? "yes" : "no"}`,
      `Style: ${effective}${style && style.effective !== style.requested ? ` (from ${style.requested})` : ""}`,
      `FPS: ${props.state.fps()}`,
      pack ? (pack.kind === "canvas" ? "Canvas" : `Frames: ${pack.frames.length}`) : "",
    ]
    return bits.filter(Boolean).join("   ")
  })

  const capability = createMemo(() => {
    const caps = props.state.capabilities
    if (!caps.color) return "no color"
    if (caps.rgb) return "truecolor"
    if (caps.ansi256) return "256 colors"
    return "16 colors"
  })

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      border
      borderStyle="rounded"
      borderColor={border}
      title=" ASCII Art "
      titleAlignment="left"
      padding={1}
      gap={1}
    >
      <box flexDirection="row" flexGrow={1} gap={2}>
        <box width={36} flexDirection="column">
          <text fg={muted}>Packs ({list().length})</text>
          <Show when={list().length > 0} fallback={<text fg={faint}>No packs found.</text>}>
            <For each={list()}>
              {(candidate, index) => (
                <text fg={index() === selectedIndex() ? base : muted}>
                  {index() === selectedIndex() ? "> " : "  "}
                  {candidate.id}
                  <span style={{ fg: faint }}>
                    {"  "}
                    {candidate.scope}
                  </span>
                  {candidate.id === active() ? (
                    <span style={{ fg: accent }}>{"  active"}</span>
                  ) : (
                    <span>{"        "}</span>
                  )}
                  {"  "}
                  {shortName(candidate.manifest.name)}
                  <span style={{ fg: faint }}>{"  "}{badges(candidate)}</span>
                </text>
              )}
            </For>
          </Show>
        </box>
        <box
          flexGrow={1}
          flexDirection="column"
          border
          borderStyle="single"
          borderColor={border}
          title=" Preview "
          paddingX={1}
        >
          <Show
            when={preview().length > 0}
            fallback={
              <box flexDirection="column">
                <text fg={muted}>{previewError() ?? "Select a pack to preview it."}</text>
                <text fg={faint}>{props.state.roots.globalArts}</text>
              </box>
            }
          >
            <text fg={faint}>{sameLine()}</text>
            <text fg={faint}>Styles: {availableStyles().join(" · ")}</text>
            <For each={preview()}>
              {(line) => (
                <text>
                  <For each={line}>{(run) => <span style={{ fg: run.color ? rgba(run.color) : faint }}>{run.text}</span>}</For>
                </text>
              )}
            </For>
          </Show>
        </box>
      </box>

      <text fg={muted}>{status()}</text>
      <Show when={note()}>{(value: Accessor<string>) => <text fg={muted}>{value()}</text>}</Show>
      <Show when={props.state.problems().length > 0}>
        <box flexDirection="column">
          <text fg={props.theme.text.feedback.error.base}>Problems</text>
          <For each={props.state.problems().slice(0, 4)}>
            {(problem) => (
              <text fg={faint}>
                {problem.id}: {problem.errors[0]?.file ?? "art.json"} — {problem.errors[0]?.message ?? "invalid"}
              </text>
            )}
          </For>
        </box>
      </Show>
      <text fg={faint}>
        Up/Down select · Enter apply · s style ({availableStyles().join("/")}) · Left/Right fps · e enabled · r reload ·
        Esc close · {capability()}
      </text>
      <text fg={faint}>Create art by asking the agent in chat · {props.state.roots.globalArts}</text>
    </box>
  )
}
