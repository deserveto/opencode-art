import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { RGBA } from "@opentui/core"
import { createStore, produce } from "solid-js/store"
import type { Plugin } from "@opencode/plugin/tui"
import { createArtState, type ArtState } from "../src/plugin/state.ts"

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
