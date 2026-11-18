// Dev-only smoke test: paints a pack through the real ArtRenderable on the
// headless OpenTUI renderer. Run with Bun 1.4.4:
//   bun run scripts/render-smoke.mjs frames/fool 80 20 original [pause-after]
import { createTestRenderer } from "@opentui/core/testing"
import path from "node:path"
import { loadPack } from "../src/art/index.ts"
import { ArtRenderable, detectCapabilities, resolveStyle } from "../src/render/index.ts"

async function main() {
  const packDir = path.resolve(process.cwd(), process.argv[2] ?? "frames/fool")
  const width = Number(process.argv[3] ?? 80)
  const height = Number(process.argv[4] ?? 20)
  const requested = process.argv[5] ?? "original"

  const loaded = await loadPack(packDir)
  if (!loaded.ok) {
    console.error("pack invalid:", loaded.error)
    process.exitCode = 1
    return
  }
  const pack = loaded.value
  const capabilities = detectCapabilities({ rgb: true, ansi256: true, unicode: true }, process.env)
  const theme = {
    faint: [120, 120, 130, 255],
    muted: [180, 180, 190, 255],
    base: [235, 235, 240, 255],
    hue: [235, 235, 240, 255],
    background: [30, 30, 46, 255],
  }
  const style = resolveStyle(requested, pack, capabilities, theme)

  const setup = await createTestRenderer({ width, height })
  const art = new ArtRenderable(setup.renderer, {
    width,
    height,
    position: "absolute",
    left: 0,
    top: 0,
    zIndex: -1,
    pack,
    resolvedStyle: style,
    fps: pack.manifest.fps,
    enabled: true,
    paused: false,
    animations: false,
    theme,
    onError: (message) => console.error("render error:", message),
    onDegrade: (message) => console.log("degraded:", message),
  })
  setup.renderer.root.add(art)
  try {
    await setup.renderOnce()
    if (process.argv[6] === "pause-after") {
      art.paused = true
      await setup.renderOnce()
      console.log(
        JSON.stringify({
          cleared: setup.captureCharFrame().trim().length === 0,
          animationFps: art.animationFps ?? null,
        }),
      )
      return
    }
    for (const line of setup.captureCharFrame().split("\n").slice(0, height)) console.log(line)
    const foregrounds = new Set(
      setup
        .captureSpans()
        .lines.flatMap((line) => line.spans.map((span) => span.fg.toString())),
    )
    const backgrounds = new Set(
      setup
        .captureSpans()
        .lines.flatMap((line) => line.spans.map((span) => span.bg.toString())),
    )
    console.log(
      JSON.stringify({
        pack: pack.id,
        frames: pack.frames.length,
        requested,
        effective: style.effective,
        cellsUpdated: setup.getNativeStats().cellsUpdated,
        foregrounds: foregrounds.size,
        backgrounds: [...backgrounds],
      }),
    )
  } finally {
    await setup.dispose()
  }
}

await main()
