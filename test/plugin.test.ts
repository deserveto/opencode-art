import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { RGBA } from "@opentui/core"
import { createStore, produce } from "solid-js/store"
import type { Plugin } from "@opencode/plugin/tui"
import { configRoot } from "../src/plugin/host.ts"
import { createArtState, watcherRoots, type ArtState } from "../src/plugin/state.ts"
import { projectSettingsPath } from "../src/settings/index.ts"

interface Harness {
  readonly context: Plugin.Context
  readonly toasts: Array<{ message: string; variant?: string }>
  readonly projectRoot: string
  readonly configRoot: string
  state?: ArtState
}

async function harness(): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-art-plugin-"))
  const configRoot = path.join(root, "config")
  const projectRoot = path.join(root, "project")
  await mkdir(path.join(configRoot, "opencode"), { recursive: true })
  await mkdir(path.join(projectRoot, ".opencode"), { recursive: true })

  const toasts: Array<{ message: string; variant?: string }> = []
  const ink = RGBA.fromInts(210, 210, 210, 255)
  const background = RGBA.fromInts(0, 0, 0, 255)

  const context = {
    location: { directory: projectRoot },
    renderer: { capabilities: { rgb: true, ansi256: true, unicode: true } },
    theme: { text: { faint: ink, muted: ink, base: ink }, background: { base: background } },
    themeMode: "dark",
    options: {},
    storage: {
      store: <Value extends object>(_key: string, options: { initial: Value }) => {
        const [value, setValue] = createStore<Value>(options.initial)
        const update = async (mutation: (draft: Value) => void): Promise<void> => {
          setValue(produce((draft: Value) => mutation(draft)))
        }
        return [value, update] as const
      },
    },
    ui: {
      toast: { show: (options: { message: string; variant?: string }) => toasts.push(options) },
      dialog: {
        show: () => {},
        set: () => {},
        clear: () => {},
        alert: async () => {},
        confirm: async () => undefined,
        prompt: async () => undefined,
        select: async () => undefined,
      },
      router: { current: () => ({ type: "home" }) },
      slot: () => () => {},
      format: { path: (value: string) => value },
    },
    keymap: { layer: () => {} },
  } as unknown as Plugin.Context

  return { context, toasts, projectRoot, configRoot }
}

async function writeCanvasPack(projectRoot: string, id: string, cols: number, rows: number, body: string, extra?: object): Promise<void> {
  const dir = path.join(projectRoot, ".opencode", "arts", id)
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, "art.json"),
    JSON.stringify({
      schemaVersion: 1,
      id,
      name: `Pack ${id}`,
      fps: 5,
      cols,
      rows,
      canvas: "canvas.txt",
      ...extra,
    }),
  )
  await writeFile(path.join(dir, "canvas.txt"), body)
}

function grid(cols: number, rows: number): string {
  const lines: string[] = []
  for (let y = 0; y < rows; y++) {
    let line = ""
    for (let x = 0; x < cols; x++) line += String.fromCharCode(97 + ((x + y) % 26))
    lines.push(line)
  }
  return lines.join("\n")
}

test("a project pack shadows the bundled pack of the same id", async () => {
  const box = await harness()
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = box.configRoot
  try {
    await writeCanvasPack(box.projectRoot, "fool", 4, 2, grid(4, 2))
    box.state = await createArtState(box.context)
    assert.equal(box.state.activeId(), "fool")
    assert.equal(box.state.pack()?.manifest.cols, 4)
    assert.equal(box.state.pack()?.frames[0]?.chars, "abcdbcde")
    assert.equal(box.state.enabled(), true)
    assert.equal(box.state.problems().length, 0)
  } finally {
    box.state?.dispose()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(path.dirname(box.projectRoot), { recursive: true, force: true })
  }
})

test("a project art.json override wins over global settings", async () => {
  const box = await harness()
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = box.configRoot
  try {
    await writeCanvasPack(box.projectRoot, "fool", 4, 2, grid(4, 2))
    await writeFile(path.join(box.projectRoot, ".opencode", "art.json"), JSON.stringify({ enabled: false }))
    box.state = await createArtState(box.context)
    assert.equal(box.state.enabled(), false)
    assert.equal(box.state.pack()?.id, "fool")
  } finally {
    box.state?.dispose()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(path.dirname(box.projectRoot), { recursive: true, force: true })
  }
})

test("an invalid active pack is reported and the bundled fallback loads", async () => {
  const box = await harness()
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = box.configRoot
  try {
    await writeCanvasPack(box.projectRoot, "fool", 4, 2, "bad\n", { name: "Broken Fool" })
    box.state = await createArtState(box.context)
    assert.equal(box.state.activeId(), "fool")
    assert.equal(box.state.pack()?.dir.includes(`${path.sep}frames${path.sep}fool`) ?? false, true)
    assert.ok(box.state.problems().length > 0)
    assert.ok(box.toasts.some((toast) => /invalid/i.test(toast.message)))
  } finally {
    box.state?.dispose()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(path.dirname(box.projectRoot), { recursive: true, force: true })
  }
})

test("setPack persists and unknown ids get close matches", async () => {
  const box = await harness()
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = box.configRoot
  try {
    await writeCanvasPack(box.projectRoot, "fool", 4, 2, grid(4, 2))
    await writeCanvasPack(box.projectRoot, "logo", 3, 2, grid(3, 2))
    box.state = await createArtState(box.context)
    assert.equal(await box.state.setPack("logo"), true)
    assert.equal(box.state.activeId(), "logo")
    assert.equal(box.state.settings.effective().pack, "logo")

    assert.equal(await box.state.setPack("log"), false)
    assert.match(box.toasts.at(-1)?.message ?? "", /logo/)
  } finally {
    box.state?.dispose()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(path.dirname(box.projectRoot), { recursive: true, force: true })
  }
})

test("an invalid project settings field falls back without wiping the file", async () => {
  const box = await harness()
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = box.configRoot
  try {
    await writeCanvasPack(box.projectRoot, "fool", 4, 2, grid(4, 2))
    await writeFile(
      path.join(box.projectRoot, ".opencode", "art.json"),
      JSON.stringify({ enabled: "yes", pack: "fool", fps: 999 }),
    )
    box.state = await createArtState(box.context)
    assert.equal(box.state.enabled(), true)
    assert.equal(box.state.activeId(), "fool")
    assert.equal(box.state.fps(), 5)
    assert.ok(box.toasts.some((toast) => /enabled must be true or false|fps must be an integer/.test(toast.message)))
  } finally {
    box.state?.dispose()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(path.dirname(box.projectRoot), { recursive: true, force: true })
  }
})

test("reloading a pack that became invalid keeps the last good frames", async () => {
  const box = await harness()
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = box.configRoot
  try {
    await writeCanvasPack(box.projectRoot, "fool", 4, 2, grid(4, 2))
    box.state = await createArtState(box.context)
    assert.equal(box.state.pack()?.frames[0]?.chars, "abcdbcde")

    await writeFile(path.join(box.projectRoot, ".opencode", "arts", "fool", "canvas.txt"), "bad\n")
    await box.state.reload()

    assert.equal(box.state.pack()?.frames[0]?.chars, "abcdbcde")
    assert.equal(box.state.activeId(), "fool")
    assert.ok(box.state.problems().length > 0)

    await writeFile(path.join(box.projectRoot, ".opencode", "arts", "fool", "canvas.txt"), grid(4, 2))
    await box.state.reload()
    assert.equal(box.state.problems().length, 0)
    assert.equal(box.state.pack()?.frames[0]?.chars, "abcdbcde")
  } finally {
    box.state?.dispose()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(path.dirname(box.projectRoot), { recursive: true, force: true })
  }
})

test("validate reports a discovery problem by id", async () => {
  const box = await harness()
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = box.configRoot
  try {
    await writeCanvasPack(box.projectRoot, "fool", 4, 2, grid(4, 2))
    const bad = path.join(box.projectRoot, ".opencode", "arts", "bad")
    await mkdir(bad, { recursive: true })
    await writeFile(
      path.join(bad, "art.json"),
      JSON.stringify({ schemaVersion: 1, id: "bad", name: "Bad", fps: 0, cols: 4, rows: 2, canvas: "canvas.txt" }),
    )
    await writeFile(path.join(bad, "canvas.txt"), grid(4, 2))
    box.state = await createArtState(box.context)
    const report = await box.state.validate("bad")
    assert.equal(report.ok, false)
    assert.ok(report.lines.some((line) => /fps/.test(line)))
  } finally {
    box.state?.dispose()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(path.dirname(box.projectRoot), { recursive: true, force: true })
  }
})

test("state changes push to subscribers", async () => {
  const box = await harness()
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = box.configRoot
  try {
    await writeCanvasPack(box.projectRoot, "fool", 4, 2, grid(4, 2))
    box.state = await createArtState(box.context)
    const events: string[] = []
    const off = box.state.subscribe(() => events.push("push"))
    await box.state.setStyle("theme")
    await box.state.setEnabled(false)
    off()
    await box.state.setEnabled(true)
    assert.deepEqual(events, ["push", "push"])
  } finally {
    box.state?.dispose()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(path.dirname(box.projectRoot), { recursive: true, force: true })
  }
})

test("configRoot ignores empty or whitespace XDG_CONFIG_HOME and trims valid paths", () => {
  const previous = process.env.XDG_CONFIG_HOME
  try {
    process.env.XDG_CONFIG_HOME = ""
    assert.equal(configRoot(), path.join(homedir(), ".config"))
    process.env.XDG_CONFIG_HOME = "   "
    assert.equal(configRoot(), path.join(homedir(), ".config"))
    process.env.XDG_CONFIG_HOME = "  /tmp/custom-xdg  "
    assert.equal(configRoot(), "/tmp/custom-xdg")
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
  }
})

test("setDim clamps, persists, notifies, and respects project dim lock", async () => {
  const box = await harness()
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = box.configRoot
  try {
    await writeCanvasPack(box.projectRoot, "fool", 4, 2, grid(4, 2))
    box.state = await createArtState(box.context)
    assert.equal(box.state.dim(), 0)

    let pushes = 0
    const off = box.state.subscribe(() => {
      pushes++
    })

    await box.state.setDim(35)
    assert.equal(box.state.dim(), 35)
    assert.equal(box.state.settings.effective().dim, 35)
    assert.equal(pushes, 1)
    assert.equal(box.toasts.at(-1)?.message, "Dim: 35%")

    await box.state.setDim(120)
    assert.equal(box.state.dim(), 80)
    assert.equal(box.toasts.at(-1)?.variant, "warning")
    assert.match(box.toasts.at(-1)?.message ?? "", /clamped to 80/)

    await writeFile(path.join(box.projectRoot, ".opencode", "art.json"), JSON.stringify({ dim: 20 }))
    await box.state.reload()
    assert.equal(box.state.dim(), 20)

    await box.state.setDim(50)
    assert.equal(box.state.dim(), 20)
    assert.equal(box.toasts.at(-1)?.variant, "warning")
    assert.equal(box.toasts.at(-1)?.message, "Dim is set to 20% by this project's .opencode/art.json.")
    off()
  } finally {
    box.state?.dispose()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(path.dirname(box.projectRoot), { recursive: true, force: true })
  }
})

test("setStyle and setPack warn when project .opencode/art.json pins them", async () => {
  const box = await harness()
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = box.configRoot
  try {
    await writeCanvasPack(box.projectRoot, "fool", 4, 2, grid(4, 2))
    await writeCanvasPack(box.projectRoot, "logo", 3, 2, grid(3, 2))
    await writeFile(
      path.join(box.projectRoot, ".opencode", "art.json"),
      JSON.stringify({ pack: "fool", style: "mono" }),
    )
    box.state = await createArtState(box.context)

    await box.state.setStyle("theme")
    assert.equal(box.state.style()?.effective, "mono")
    assert.equal(box.toasts.at(-1)?.variant, "warning")
    assert.equal(box.toasts.at(-1)?.message, "Style is set to mono by this project's .opencode/art.json.")

    assert.equal(await box.state.setPack("logo"), true)
    assert.equal(box.toasts.at(-1)?.variant, "warning")
    assert.equal(box.toasts.at(-1)?.message, 'Pack is pinned to "fool" by this project\'s .opencode/art.json.')

    // Reload honors project pack override again.
    await box.state.reload()
    assert.equal(box.state.activeId(), "fool")

    // Changing project pack in .opencode/art.json switches active pack on reload.
    await writeFile(
      path.join(box.projectRoot, ".opencode", "art.json"),
      JSON.stringify({ pack: "logo", style: "mono" }),
    )
    await box.state.reload()
    assert.equal(box.state.activeId(), "logo")
  } finally {
    box.state?.dispose()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(path.dirname(box.projectRoot), { recursive: true, force: true })
  }
})

test("degradeStyle and degradeFps update state and notify subscribers", async () => {
  const box = await harness()
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = box.configRoot
  try {
    await writeCanvasPack(box.projectRoot, "fool", 4, 2, grid(4, 2))
    box.state = await createArtState(box.context)
    let pushes = 0
    const off = box.state.subscribe(() => {
      pushes++
    })

    const nextStyle = {
      requested: "original" as const,
      effective: "theme" as const,
      stops: [[10, 20, 30, 255]] as const,
      original: false,
      reason: "render too slow",
    }
    box.state.degradeStyle(nextStyle)
    assert.deepEqual(box.state.style(), nextStyle)

    box.state.degradeFps(5)
    assert.equal(box.state.fps(), 5)
    assert.equal(pushes, 2)
    off()
  } finally {
    box.state?.dispose()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(path.dirname(box.projectRoot), { recursive: true, force: true })
  }
})

test("concurrent reload queues a follow-up pass when edits happen mid-reload", async () => {
  const box = await harness()
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = box.configRoot
  try {
    await writeCanvasPack(box.projectRoot, "fool", 4, 2, grid(4, 2))
    box.state = await createArtState(box.context)
    const canvasPath = path.join(box.projectRoot, ".opencode", "arts", "fool", "canvas.txt")

    let injected = false
    let secondReload: Promise<void> | undefined
    const off = box.state.subscribe(() => {
      if (injected) return
      injected = true
      writeFileSync(canvasPath, "wxyz\nwxyz")
      secondReload = box.state?.reload()
    })

    await writeFile(canvasPath, "mnop\nmnop")
    const firstReload = box.state.reload()
    await firstReload
    await secondReload
    off()

    assert.equal(injected, true)
    assert.equal(box.state.pack()?.frames[0]?.chars, "wxyzwxyz")
  } finally {
    box.state?.dispose()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(path.dirname(box.projectRoot), { recursive: true, force: true })
  }
})

test("watcherRoots tracks project arts, user arts, and .opencode/art.json without bundledFrames", async () => {
  const box = await harness()
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = box.configRoot
  try {
    await writeCanvasPack(box.projectRoot, "fool", 4, 2, grid(4, 2))
    await writeCanvasPack(box.projectRoot, "logo", 3, 2, grid(3, 2))
    await writeFile(path.join(box.projectRoot, ".opencode", "art.json"), JSON.stringify({ pack: "fool" }))
    box.state = await createArtState(box.context, { watchIntervalMs: 25, watchDebounceMs: 30 })

    const roots = watcherRoots(box.state.roots)
    assert.deepEqual(roots, [
      box.state.roots.projectArts,
      box.state.roots.globalArts,
      projectSettingsPath(box.projectRoot),
    ])
    assert.equal(roots.includes(box.state.roots.bundledFrames), false)

    await new Promise((resolve) => setTimeout(resolve, 60))
    await writeFile(path.join(box.projectRoot, ".opencode", "art.json"), JSON.stringify({ pack: "logo", dim: 45 }))
    const started = Date.now()
    while (box.state.activeId() !== "logo" && Date.now() - started < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(box.state.activeId(), "logo")
    assert.equal(box.state.dim(), 45)
  } finally {
    box.state?.dispose()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(path.dirname(box.projectRoot), { recursive: true, force: true })
  }
})
