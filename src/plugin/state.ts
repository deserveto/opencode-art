import type { Plugin } from "@opencode/plugin/tui"
import { homedir } from "node:os"
import path from "node:path"
import { createSignal, type Accessor } from "solid-js"
import type { Pack, PackCandidate, PackError, PackProblem, Result, StyleName } from "../art/types.ts"
import { discoverPacks, loadCandidate, loadPack } from "../art/index.ts"
import { detectCapabilities, resolveStyle } from "../render/index.ts"
import type { ResolvedStyle } from "../render/types.ts"
import {
  createSettingsStore,
  readProjectSettings,
  projectSettingsPath,
  type SettingsStore,
  type StorageSettings,
} from "../settings/index.ts"
import { startPolling } from "../watch/poll.ts"
import { artRoots, readAnimations, themeColors, type ArtRoots } from "./host.ts"

type Context = Plugin.Context

export interface ValidationReport {
  readonly ok: boolean
  readonly lines: readonly string[]
  readonly warnings: readonly string[]
}

export interface ArtState {
  readonly pack: Accessor<Pack | null>
  readonly style: Accessor<ResolvedStyle | null>
  readonly fps: Accessor<number>
  readonly enabled: Accessor<boolean>
  readonly animations: boolean
  readonly candidates: Accessor<readonly PackCandidate[]>
  readonly problems: Accessor<readonly PackProblem[]>
  readonly activeId: Accessor<string | null>
  readonly roots: ArtRoots
  readonly settings: SettingsStore
  readonly capabilities: ReturnType<typeof detectCapabilities>

  setEnabled(value: boolean): Promise<void>
  toggleEnabled(): Promise<void>
  next(): Promise<void>
  setPack(id: string): Promise<boolean>
  setStyle(style: StyleName): Promise<void>
  setFps(fps: number): Promise<void>
  reload(): Promise<void>
  validate(target?: string): Promise<ValidationReport>
  load(id: string): Promise<Result<Pack, readonly PackError[]>>
  resolve(pack: Pack): ResolvedStyle
  refreshTheme(): void
  matches(query: string): readonly string[]
  dispose(): void
}

function errorLine(error: PackError): string {
  const location = error.line === undefined ? error.file : `${error.file}:${error.line}`
  return `${location} — ${error.message}`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type ToastVariant = "info" | "success" | "warning" | "error"
type Notify = (text: string, variant?: ToastVariant) => void
type NotifyOnce = (key: string, text: string, variant?: ToastVariant) => void

async function createState(context: Context): Promise<ArtState> {
  let disposed = false
  const roots = artRoots(context.location?.directory)
  const animations = await readAnimations()
  const rendererCaps = context.renderer.capabilities
  const capabilities = detectCapabilities(
    rendererCaps
      ? {
          rgb: rendererCaps.rgb,
          ansi256: rendererCaps.ansi256,
          unicode: Boolean(rendererCaps.unicode),
        }
      : undefined,
    process.env,
  )

  const notify: Notify = (text, variant = "info") => {
    if (disposed) return
    context.ui.toast.show({ message: text, variant })
  }
  const reported = new Set<string>()
  const notifyOnce: NotifyOnce = (key, text, variant = "warning") => {
    if (reported.has(key)) return
    reported.add(key)
    notify(text, variant)
  }

  const [globalStore, updateGlobal] = context.storage.store<StorageSettings>("settings", {
    initial: { version: 1 },
  })
  const project = await readProjectSettings(projectSettingsPath(roots.projectRoot))
  for (const warning of project.warnings) notifyOnce(`settings:${warning}`, warning)

  const store: SettingsStore = createSettingsStore(
    {
      readGlobal: () => ({
        version: globalStore.version,
        enabled: globalStore.enabled,
        pack: globalStore.pack,
        style: globalStore.style,
        fps: globalStore.fps,
      }),
      updateGlobal: (mutation) => updateGlobal(mutation),
      projectPath: projectSettingsPath(roots.projectRoot),
      onError: (text) => notifyOnce(`write:${text}`, text),
    },
    project.settings,
  )

  const [pack, setPackValue] = createSignal<Pack | null>(null)
  const [style, setStyle] = createSignal<ResolvedStyle | null>(null)
  const [fps, setFps] = createSignal(10)
  const [enabled, setEnabled] = createSignal(false)
  const [candidates, setCandidates] = createSignal<readonly PackCandidate[]>([])
  const [problems, setProblems] = createSignal<readonly PackProblem[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)

  let current: Pack | null = null
  let currentId: string | null = null
  let index = await discoverPacks(roots.projectRoot, roots.globalArts, roots.bundledFrames)
  const deepProblems = new Map<string, PackProblem>()
  const warnedStyles = new Set<string>()
  const cache = new Map<string, Pack>()
  let stopWatch: (() => void) | null = null
  let reloading = false

  function refreshProblems(): void {
    const seen = new Set(index.problems.map((problem) => problem.dir))
    const merged = [...index.problems]
    for (const problem of deepProblems.values()) {
      if (!seen.has(problem.dir)) merged.push(problem)
    }
    setProblems(merged)
  }

  function refreshCandidates(): void {
    setCandidates(index.candidates)
    refreshProblems()
    for (const problem of index.problems) {
      const first = problem.errors[0]
      notifyOnce(
        `discovery:${problem.dir}`,
        first ? `${problem.id} is invalid: ${errorLine(first)}` : `${problem.id} is invalid.`,
        "warning",
      )
    }
  }

  function resolveFor(target: Pack): ResolvedStyle {
    const requested = store.effective().style ?? target.manifest.defaultStyle
    return resolveStyle(requested, target, capabilities, themeColors(context.theme))
  }

  function apply(target: Pack, id: string): void {
    current = target
    currentId = id
    setPackValue(target)
    setActiveId(id)
    const effective = store.effective()
    setEnabled(effective.enabled)
    setFps(effective.fps ?? target.manifest.fps)
    const resolved = resolveFor(target)
    setStyle(resolved)
    for (const warning of target.warnings.slice(0, 3)) {
      notifyOnce(`warn:${target.dir}:${warning}`, warning, "info")
    }
    if (resolved.reason && resolved.effective !== resolved.requested) {
      const key = `${target.dir}:${resolved.requested}:${resolved.effective}`
      if (!warnedStyles.has(key)) {
        warnedStyles.add(key)
        notifyOnce(
          `style:${key}`,
          `Style ${resolved.requested} → ${resolved.effective}: ${resolved.reason}`,
          "warning",
        )
      }
    }
  }

  function remember(target: Pack): void {
    cache.delete(target.dir)
    cache.set(target.dir, target)
    while (cache.size > 2) {
      const oldest = cache.keys().next()
      if (oldest.done) break
      cache.delete(oldest.value)
    }
  }

  function candidateDir(dir: string): PackCandidate | undefined {
    return index.candidates.find((entry) => entry.dir === dir)
  }

  async function loadBundledFool(): Promise<Result<Pack, readonly PackError[]>> {
    const dir = path.join(roots.bundledFrames, "fool")
    const cached = cache.get(dir)
    if (cached) return { ok: true, value: cached }
    // Discovery shadows a bundled pack when a project pack uses the same id,
    // but the Fool must stay available as the last-resort fallback.
    const result = await loadPack(dir)
    if (result.ok) remember(result.value)
    return result
  }

  async function loadDir(dir: string): Promise<Result<Pack, readonly PackError[]>> {
    const cached = cache.get(dir)
    if (cached) return { ok: true, value: cached }
    const candidate = candidateDir(dir)
    if (!candidate) {
      return { ok: false, error: [{ file: "art.json", code: "io", message: `${dir} is not a discovered pack` }] }
    }
    const result = await loadCandidate(candidate)
    if (result.ok) remember(result.value)
    return result
  }

  function problemsFor(candidate: PackCandidate, errors: readonly PackError[]): void {
    deepProblems.set(candidate.dir, { id: candidate.id, dir: candidate.dir, scope: candidate.scope, errors })
    // A deeply invalid pack is not selectable until the next reload re-checks it.
    index = { ...index, candidates: index.candidates.filter((entry) => entry.dir !== candidate.dir) }
    setCandidates(index.candidates)
    refreshProblems()
    const first = errors[0]
    notifyOnce(
      `pack:${candidate.dir}`,
      first ? `${candidate.id} is invalid: ${errorLine(first)}` : `${candidate.id} is invalid.`,
    )
  }

  async function activate(id: string, persist: boolean): Promise<boolean> {
    const candidate = index.candidates.find((entry) => entry.id === id)
    if (!candidate) return false
    const result = await loadDir(candidate.dir)
    if (!result.ok) {
      problemsFor(candidate, result.error)
      return false
    }
    deepProblems.delete(candidate.dir)
    refreshProblems()
    apply(result.value, id)
    if (persist) await store.setPack(id)
    return true
  }

  async function fallback(excludeDir?: string): Promise<boolean> {
    const bundledDir = path.join(roots.bundledFrames, "fool")
    if (excludeDir !== bundledDir) {
      const bundled = await loadBundledFool()
      if (bundled.ok) {
        apply(bundled.value, "fool")
        notify("Showing fool instead.", "warning")
        return true
      }
      deepProblems.set(bundledDir, { id: "fool", dir: bundledDir, scope: "bundled", errors: bundled.error })
      refreshProblems()
    }
    for (const candidate of index.candidates) {
      if (candidate.dir === excludeDir) continue
      const result = await loadDir(candidate.dir)
      if (result.ok) {
        apply(result.value, candidate.id)
        notify(`Showing ${candidate.id} instead.`, "warning")
        return true
      }
      problemsFor(candidate, result.error)
    }
    return false
  }

  async function start(): Promise<void> {
    const effective = store.effective()
    setEnabled(effective.enabled)
    if (effective.pack && (await activate(effective.pack, false))) return
    if (effective.pack) {
      notifyOnce(`missing:${effective.pack}`, `Pack "${effective.pack}" was not found; using the bundled Fool.`)
    }
    if (!(await fallback())) {
      notifyOnce("no-packs", "No art packs were found. Ask the agent in chat to create one.")
    }
  }

  async function reload(): Promise<void> {
    if (disposed || reloading) return
    reloading = true
    try {
      cache.clear()
      deepProblems.clear()
      await store.reload()
      index = await discoverPacks(roots.projectRoot, roots.globalArts, roots.bundledFrames)
      refreshCandidates()
      const target = currentId ?? store.effective().pack
      if (target && (await activate(target, false))) return
      if (current) {
        notifyOnce(`lost:${target}`, "The active pack disappeared; keeping the last good frames.")
        return
      }
      await fallback()
    } catch (error) {
      notifyOnce(`reload:${message(error)}`, `Reload failed: ${message(error)}`)
    } finally {
      setEnabled(store.effective().enabled)
      syncWatcher()
      reloading = false
    }
  }

  function syncWatcher(): void {
    if (disposed) return
    const shouldWatch = store.effective().enabled
    if (shouldWatch && !stopWatch) {
      stopWatch = startPolling({
        roots: () => [roots.projectArts, roots.globalArts, roots.bundledFrames],
        onChanged: reload,
        onError: (text) => {
          console.error(`[opencode-art] watch error: ${text}`)
          notifyOnce(`watch:${text}`, `Watching arts failed: ${text}`)
        },
      })
    } else if (!shouldWatch && stopWatch) {
      stopWatch()
      stopWatch = null
    }
  }

  function matches(query: string): readonly string[] {
    const needle = query.toLowerCase()
    if (!needle) return []
    return index.candidates
      .map((candidate) => candidate.id)
      .filter((id) => id !== needle && (id.includes(needle) || needle.includes(id)))
      .slice(0, 4)
  }

  async function setEnabledValue(value: boolean): Promise<void> {
    await store.setEnabled(value)
    const effective = store.effective()
    setEnabled(effective.enabled)
    if (value && !effective.enabled) {
      notifyOnce("project-disabled", "Art is disabled by this project's .opencode/art.json.", "warning")
    }
    syncWatcher()
  }

  async function next(): Promise<void> {
    const list = index.candidates
    if (list.length === 0) {
      notify("No packs found. Ask the agent in chat to create one.", "warning")
      return
    }
    const found = list.findIndex((entry) => entry.id === currentId)
    const currentIndex = found < 0 ? -1 : found
    for (let step = 1; step <= list.length; step++) {
      const candidate = list[(currentIndex + step + list.length) % list.length]
      if (!candidate) continue
      if (await activate(candidate.id, true)) {
        notify(`${candidate.manifest.name} (${candidate.id}, ${candidate.scope})`, "success")
        return
      }
    }
    notify("No loadable packs. Run /art validate.", "error")
  }

  async function setPack(id: string): Promise<boolean> {
    if (await activate(id, true)) {
      const target = index.candidates.find((entry) => entry.id === id)
      if (target) notify(`${target.manifest.name} (${target.id}, ${target.scope})`, "success")
      return true
    }
    const problem = problems().find((entry) => entry.id === id)
    if (problem) {
      notify(`Pack "${id}" is invalid. Details are in /art → Problems.`, "error")
      return false
    }
    const close = matches(id)
    notify(close.length ? `Unknown pack "${id}". Did you mean: ${close.join(", ")}?` : `Unknown pack "${id}".`)
    return false
  }

  async function setStyleValue(nextStyle: StyleName): Promise<void> {
    await store.setStyle(nextStyle)
    if (!current) {
      notify(`Style set to ${nextStyle}; no pack is loaded.`)
      return
    }
    const resolved = resolveFor(current)
    setStyle(resolved)
    if (resolved.effective !== nextStyle) {
      const available: StyleName[] = ["mono", "theme"]
      if (current.manifest.palette?.length) available.push("palette")
      if (current.frames.some((frame) => frame.colors)) available.push("original")
      notify(
        `Using ${resolved.effective} instead of ${nextStyle}: ${resolved.reason ?? "not available"}. Available: ${available.join(", ")}.`,
        "warning",
      )
    } else {
      notify(`Style: ${nextStyle}`, "success")
    }
  }

  async function setFpsValue(value: number): Promise<void> {
    const rounded = Math.round(value)
    const clamped = Math.min(30, Math.max(1, rounded))
    await store.setFps(clamped)
    const effective = store.effective().fps ?? current?.manifest.fps ?? clamped
    setFps(effective)
    if (effective !== clamped) {
      notify(`FPS is set to ${effective} by this project's .opencode/art.json.`, "warning")
      return
    }
    if (clamped !== value) {
      const reason = value < 1 || value > 30 ? `clamped to ${clamped}` : `rounded to ${clamped}`
      notify(`FPS ${reason} (1–30).`, "warning")
      return
    }
    notify(`FPS: ${clamped}`, "success")
  }

  async function validate(target?: string): Promise<ValidationReport> {
    const lines: string[] = []
    const warnings: string[] = []
    let ok = true
    if (target && (/[\\/]/.test(target) || target.startsWith("~"))) {
      const dir = path.resolve(target.replace(/^~(?=$|[\\/])/, homedir()))
      const result = await loadPack(dir)
      if (result.ok) {
        lines.push(`${dir}: valid`)
        warnings.push(...result.value.warnings)
      } else {
        ok = false
        for (const error of result.error) lines.push(errorLine(error))
      }
      return { ok, lines, warnings }
    }
    const list = target ? index.candidates.filter((entry) => entry.id === target) : index.candidates
    if (target && list.length === 0) {
      const known = problems().find((problem) => problem.id === target)
      if (known) {
        for (const error of known.errors) lines.push(`${known.id}: ${errorLine(error)}`)
        return { ok: false, lines, warnings }
      }
      return { ok: false, lines: [`No pack with id "${target}".`], warnings }
    }
    if (!target) {
      for (const problem of problems()) {
        ok = false
        for (const error of problem.errors) lines.push(`${problem.id}: ${errorLine(error)}`)
      }
    }
    for (const candidate of list) {
      warnings.push(...candidate.warnings)
      const result = await loadCandidate(candidate)
      if (result.ok) {
        lines.push(`${candidate.id}: valid`)
        warnings.push(...result.value.warnings)
      } else {
        ok = false
        for (const error of result.error) lines.push(`${candidate.id}: ${errorLine(error)}`)
      }
    }
    return { ok, lines, warnings }
  }

  async function load(id: string): Promise<Result<Pack, readonly PackError[]>> {
    const candidate = index.candidates.find((entry) => entry.id === id)
    if (!candidate) {
      return { ok: false, error: [{ file: "art.json", code: "io", message: `No pack with id "${id}".` }] }
    }
    return loadDir(candidate.dir)
  }

  const state: ArtState = {
    pack,
    style,
    fps,
    enabled,
    animations,
    candidates,
    problems,
    activeId,
    roots,
    settings: store,
    capabilities,
    setEnabled: setEnabledValue,
    toggleEnabled: () => setEnabledValue(!enabled()),
    next,
    setPack,
    setStyle: setStyleValue,
    setFps: setFpsValue,
    reload,
    validate,
    load,
    resolve: resolveFor,
    refreshTheme: () => {
      if (current) setStyle(resolveFor(current))
    },
    matches,
    dispose: () => {
      disposed = true
      if (stopWatch) stopWatch()
      stopWatch = null
    },
  }

  refreshCandidates()
  await start()
  syncWatcher()
  return state
}

export async function createArtState(context: Context): Promise<ArtState> {
  return createState(context)
}
