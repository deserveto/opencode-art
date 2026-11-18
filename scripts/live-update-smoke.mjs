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
  const { createComponent, testRender } = await import("@opentui/solid")
  const { createArtState } = await import("../src/plugin/state.ts")
  const { ArtLayer } = await import("../tui.tsx")

  const toasts = []
  const faint = RGBA.fromInts(110, 110, 125, 255)
  const muted = RGBA.fromInts(170, 170, 185, 255)
  const base = RGBA.fromInts(235, 235, 245, 255)
  const background = RGBA.fromInts(20, 20, 30, 255)
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
      router: { current: () => ({ type: "home" }) },
      slot: () => () => {},
      format: { path: (value) => value },
    },
    keymap: { layer: () => {} },
  }

  const state = await createArtState(context)
  const setup = await testRender(() => createComponent(ArtLayer, { context, state }), {
    width: 40,
    height: 12,
  })

  try {
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

    const report = {
      painted,
      offCleared,
      restored,
      styleFgChanged,
      monoFgCount: monoFg.size,
      themeFgCount: themeFg.size,
      toasts: toasts.length,
    }
    console.log(JSON.stringify(report))
    if (!painted || !offCleared || !restored || !styleFgChanged) process.exitCode = 1
  } finally {
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
