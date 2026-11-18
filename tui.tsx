/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { effect, extend } from "@opentui/solid"
import { Show } from "solid-js"
import { runArtCommand } from "./src/commands/run.tsx"
import { ArtRenderable, type RGBA4, type ThemeColors } from "./src/render/index.ts"
import { themeColors } from "./src/plugin/host.ts"
import { createArtState, type ArtState } from "./src/plugin/state.ts"

type Context = Plugin.Context

extend({ "art-background": ArtRenderable })

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sameRgba4(a: RGBA4, b: RGBA4): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

function sameTheme(a: ThemeColors | undefined, b: ThemeColors): boolean {
  if (!a) return false
  return (
    sameRgba4(a.faint, b.faint) &&
    sameRgba4(a.muted, b.muted) &&
    sameRgba4(a.base, b.base) &&
    sameRgba4(a.background, b.background)
  )
}

/**
 * shortcut: the host can hand plugin code Solid's SSR build, where signals
 * never notify (OpenCode 2.3.2 does), so art updates are pushed through
 * `state.subscribe` instead of relying on plugin-side effects.
 */
export function ArtLayer(props: { readonly context: Context; readonly state: ArtState }) {
  // Host-tracked watch: `effect` comes from @opentui/solid, so it re-runs on
  // host theme changes even when plugin-side Solid is inert.
  effect(() => {
    void props.context.themeMode
    void props.context.theme.text.base
    try {
      props.state.refreshTheme()
    } catch {
      // Ignore theme refresh errors during teardown.
    }
  })

  function bind(el: ArtRenderable): void {
    if (el.isDestroyed) return
    el.pack = props.state.pack()
    el.resolvedStyle = props.state.style() ?? undefined
    el.fps = props.state.fps()
    el.dim = props.state.dim()
    el.enabled = props.state.enabled()
    const nextTheme = themeColors(props.context.theme)
    if (!sameTheme(el.theme, nextTheme)) el.theme = nextTheme
  }

  function showToast(text: string, variant: "warning" | "error"): void {
    try {
      props.context.ui.toast.show({ message: text, variant })
    } catch {
      // Toast failure during teardown must not crash the render loop.
    }
  }

  let off: (() => void) | null = null
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" zIndex={-1}>
      <art-background
        ref={(el: ArtRenderable) => {
          bind(el)
          off?.()
          off = props.state.subscribe(() => bind(el))
          el.onDestroy = () => {
            off?.()
            off = null
          }
        }}
        pack={props.state.pack()}
        resolvedStyle={props.state.style() ?? undefined}
        fps={props.state.fps()}
        dim={props.state.dim()}
        enabled={props.state.enabled()}
        animations={props.state.animations}
        theme={themeColors(props.context.theme)}
        onError={(text) => showToast(text, "error")}
        onStyleDegrade={(next, text) => {
          props.state.degradeStyle(next)
          showToast(text, "warning")
        }}
        onFpsDegrade={(nextFps, text) => {
          props.state.degradeFps(nextFps)
          showToast(text, "warning")
        }}
      />
    </box>
  )
}

export default Plugin.define({
  id: "opencode-art.tui",
  async setup(context) {
    let state: ArtState
    try {
      state = await createArtState(context)
    } catch (error) {
      context.ui.toast.show({
        title: "opencode-art",
        message: `Art could not start: ${message(error)}`,
        variant: "error",
        duration: 8000,
      })
      return
    }

    try {
      // One always-mounted claim carries the command and the home-only art.
      // A keymap layer made in async setup can be disposed with the setup
      // owner, and unmounting the art layer on other routes is the reliable
      // way to keep it off sessions.
      const remove = context.ui.slot({
        append: "app",
        render: () => {
          context.keymap.layer(() => ({
            mode: "global",
            commands: [
              {
                id: "opencode-art.art",
                title: "ASCII art",
                description: "Browse, select, and configure the animated ASCII background",
                group: "Art",
                palette: true,
                slash: { name: "art", arguments: true },
                run: (input) => runArtCommand(context, state, input),
              },
            ],
          }))
          return (
            <Show when={context.ui.router.current().type === "home"}>
              <ArtLayer context={context} state={state} />
            </Show>
          )
        },
      })

      return () => {
        try {
          remove()
        } finally {
          state.dispose()
        }
      }
    } catch (error) {
      state.dispose()
      context.ui.toast.show({
        title: "opencode-art",
        message: `Art could not start: ${message(error)}`,
        variant: "error",
        duration: 8000,
      })
    }
  },
})
