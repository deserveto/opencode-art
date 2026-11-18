// Dev-only smoke test: proves live art updates through the real ArtLayer and
// ArtState on the headless OpenTUI renderer, under the same Bun runtime
// pipeline OpenCode uses to load plugin code (which maps `solid-js` to
// Solid's SSR build, where signals never notify).
//
//   bun run scripts/live-update-smoke.mjs
//
import "@opentui/solid/runtime-plugin-support"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { RGBA } from "@opentui/core"
import { createStore, produce } from "solid-js/store"

const root = mkdtempSync(path.join(tmpdir(), "opencode-art-live-"))
const previous = process.env.XDG_CONFIG_HOME
process.env.XDG_CONFIG_HOME = path.join(root, "config")

async function main() {
  const { _render, createComponent, removeNode, testRender } = await import("@opentui/solid")
  const { createArtState } = await import("../src/plugin/state.ts")
  const { ArtLayer } = await import("../tui.tsx")

  const toasts = []
  const faint = RGBA.fromInts(110, 110, 125, 255)
  const muted = RGBA.fromInts(170, 170, 185, 255)
  const base = RGBA.fromInts(235, 235, 245, 255)
  const background = RGBA.fromInts(20, 20, 30, 255)
  let currentRoute = { type: "home" }
  const context = {
    location: { directory: path.join(root, "project") },
    renderer: { capabilities: { rgb: true, ansi256: true, unicode: true } },
    theme: { text: { faint, muted, base }, background: { base: background } },
    themeMode: "dark",
    storage: {
      store: (_key, options) => {
        const [value, setValue] = createStore(options.initial)
        const update = async (mutation) => setValue(produce((draft) => mutation(draft)))
        return [value, update]
      },
    },
    ui: {
      toast: { show: (options) => toasts.push(options) },
      dialog: { show: () => {}, set: () => {}, clear: () => {} },
      router: { current: () => currentRoute },
      slot: () => () => {},
      format: { path: (value) => value },
    },
    keymap: { layer: () => {} },
  }

  const state = await createArtState(context)
  let activeListeners = 0
  let subscriberCalls = 0
  const trackedState = {
    ...state,
    subscribe: (listener) => {
      activeListeners++
      const off = state.subscribe(() => {
        subscriberCalls++
        listener()
      })
      return () => {
        activeListeners = Math.max(0, activeListeners - 1)
        off()
      }
    },
  }

  const setup = await testRender(() => null, {
    width: 40,
    height: 12,
  })
  let disposeMount = null
  function renderRoute() {
    disposeMount?.()
    disposeMount = null
    for (const child of [...setup.renderer.root.getChildren()]) {
      removeNode(setup.renderer.root, child)
    }
    if (context.ui.router.current().type === "home") {
      disposeMount = _render(() => createComponent(ArtLayer, { context, state: trackedState }), setup.renderer.root)
    }
  }

  try {
    renderRoute()
    await setup.renderOnce()
    const painted = setup.captureCharFrame().trim().length > 0
    const monoFg = new Set(
      setup.captureSpans().lines.flatMap((line) => line.spans.map((span) => span.fg.toString())),
    )

    await state.setEnabled(false)
    await setup.renderOnce()
    const offCleared = setup.captureCharFrame().trim().length === 0

    await state.setEnabled(true)
    await setup.renderOnce()
    const restored = setup.captureCharFrame().trim().length > 0

    await state.setStyle("theme")
    await setup.renderOnce()
    const themeFg = new Set(
      setup.captureSpans().lines.flatMap((line) => line.spans.map((span) => span.fg.toString())),
    )
    const styleFgChanged =
      monoFg.size !== themeFg.size || [...monoFg].some((color) => !themeFg.has(color))

    await state.setDim(50)
    await setup.renderOnce()
    const dimFg = new Set(
      setup.captureSpans().lines.flatMap((line) => line.spans.map((span) => span.fg.toString())),
    )
    const dimChanged =
      themeFg.size !== dimFg.size || [...themeFg].some((color) => !dimFg.has(color))

    const listenersBeforeUnmount = activeListeners
    currentRoute = { type: "session" }
    renderRoute()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    const listenersAfterUnmount = activeListeners
    const callsAtUnmount = subscriberCalls

    await state.setDim(0)
    await setup.renderOnce()
    const unmountCleaned =
      listenersBeforeUnmount === 1 &&
      listenersAfterUnmount === 0 &&
      subscriberCalls === callsAtUnmount &&
      setup.captureCharFrame().trim().length === 0

    const report = {
      painted,
      offCleared,
      restored,
      styleFgChanged,
      dimChanged,
      unmountCleaned,
      monoFgCount: monoFg.size,
      themeFgCount: themeFg.size,
      dimFgCount: dimFg.size,
      listenersBeforeUnmount,
      listenersAfterUnmount,
      toasts: toasts.length,
    }
    console.log(JSON.stringify(report))
    if (!painted || !offCleared || !restored || !styleFgChanged || !dimChanged || !unmountCleaned) {
      process.exitCode = 1
    }
  } finally {
    disposeMount?.()
    await setup.dispose()
    state.dispose()
  }
}

try {
  await main()
} finally {
  if (previous === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = previous
  rmSync(root, { recursive: true, force: true })
}
