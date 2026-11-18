/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { extend } from "@opentui/solid"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { runArtCommand } from "./src/commands/run.tsx"
import { ArtRenderable } from "./src/render/index.ts"
import { themeColors } from "./src/plugin/host.ts"
import { createArtState, type ArtState } from "./src/plugin/state.ts"
import { debug } from "./src/plugin/debug.ts"

type Context = Plugin.Context

extend({ "art-background": ArtRenderable })
debug("tui module loaded")

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function ArtLayer(props: { readonly context: Context; readonly state: ArtState }) {
  const [themeTick, setThemeTick] = createSignal(0)
  const theme = createMemo(() => {
    themeTick()
    return themeColors(props.context.theme)
  })

  // Re-resolve colors when the host swaps the active theme. The reads are
  // cheap and a no-op when the context fields are not reactive.
  createEffect(() => {
    void props.context.themeMode
    void props.context.theme.text.base
    setThemeTick((value) => value + 1)
    props.state.refreshTheme()
  })

  debug("art layer render")
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" zIndex={-1}>
      <art-background
        pack={props.state.pack()}
        resolvedStyle={props.state.style() ?? undefined}
        fps={props.state.fps()}
        enabled={props.state.enabled()}
        animations={props.state.animations}
        theme={theme()}
        onError={(text) => props.context.ui.toast.show({ message: text, variant: "error" })}
        onDegrade={(text) => props.context.ui.toast.show({ message: text, variant: "warning" })}
      />
    </box>
  )
}

export default Plugin.define({
  id: "opencode-art.tui",
  async setup(context) {
    debug("setup start")
    let state: ArtState
    try {
      state = await createArtState(context)
      debug("state ready")
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
          debug("app slot render")
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
          debug("command layer registered")
          setTimeout(() => {
            try {
              const ids = context.keymap.commands().map((command) => command.id)
              debug(`reachable commands=${ids.length} hasArt=${ids.includes("opencode-art.art")}`)
            } catch (error) {
              debug(`reachable command check failed: ${message(error)}`)
            }
          }, 1000)
          return (
            <Show when={context.ui.router.current().type === "home"}>
              <ArtLayer context={context} state={state} />
            </Show>
          )
        },
      })

      setTimeout(() => {
        debug("auto test: plain dialog")
        context.ui.dialog.show(() => {
          debug("plain dialog element invoked")
          return <text>plain dialog</text>
        })
        setTimeout(() => {
          context.ui.dialog.clear()
          debug("auto test: art dialog")
          void runArtCommand(context, state)
          setTimeout(() => {
            debug("auto test: closing dialog")
            context.ui.dialog.clear()
          }, 2500)
        }, 2000)
      }, 1500)

      return () => {
        remove()
        state.dispose()
      }
    } catch (error) {
      debug(`setup failed: ${message(error)}`)
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
