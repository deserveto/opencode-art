# Phase 0 Spike — Findings

**Status:** In progress — API contract confirmed; live install and real-terminal checks pending.
**Date:** 2026-11-18
**Environment:** OpenCode `v2.3.2` (`@opencode/cli` npm global), OpenTUI `0.8.4`, Bun `1.4.4` (bundled), Windows 11, Node `24.15.0` for tooling.
**Source of truth:** OpenCode tag `v2.3.2` in `github.com/anomalyco/opencode`; OpenTUI tag `v0.8.4` in `github.com/anomalyco/opentui`.

This document supersedes the **Phase 0** and **Proposed** items in `docs/SPEC.md` where they disagree.

---

## 1. Verdict

The architecture is viable. No blocker was found.

The highest-risk item — per-cell truecolor rendering at 180×50×10 fps — is retired. A custom OpenTUI `Renderable` drawing 9,000 cells per frame measured **3.4 ms average / 5.4 ms p95** in a headless native test renderer under Bun 1.4.4 with `@opentui/core@0.8.4`. The frame budget at 10 fps is 100 ms; the spec’s 8 ms prep target is met even in the worst case.

Slash arguments, custom dialogs, project root, durable global storage, theme tokens, reload-safe custom renderables, and server-side skill registration all exist in the public API.

---

## 2. Confirmed API facts

| Item | Status | Finding | Evidence |
|---|---|---|---|
| Slash subcommands | **Confirmed** | `KeymapCommand.slash` supports `{ name, aliases?, arguments?: true }`. `run(input?: string, event?)` receives the raw argument string. `/art on`, `/art style colorful`, etc. are feasible. | `packages/plugin/src/tui/context.ts`; `packages/tui/src/context/keymap.tsx` |
| Custom dialog | **Confirmed** | `ui.dialog.show(render, onClose)` renders an arbitrary component. `ui.dialog.set({ size, centered })` controls presentation. Built-ins: `alert`, `confirm`, `prompt`, `select`. | `packages/tui/src/plugin/api.tsx` |
| Project root | **Confirmed** | `context.location` is `LocationRef` with `directory: AbsolutePath` (optional `workspaceID`). Fallback: `process.cwd()`. | `packages/plugin/src/tui/context.ts`; `packages/schema/src/location.ts` |
| Global settings storage | **Confirmed** | `context.storage.store(key, { initial })` returns `[Solid store, update(mutation) => Promise<void>]`. Durable JSON, atomic writes, file locking, live-synced across TUI instances. Scoped per app channel, **not per project**. | `packages/tui/src/context/storage.tsx` |
| Project settings | **Confirmed approach** | No project-scoped storage API. Use a project file, `<project>/.opencode/art.json`, read/written by the plugin with the project root above. | This spike |
| Theme | **Confirmed** | `context.theme` is `ResolvedTheme`: `text.base/muted/faint`, `background.base/raised`, `border.base`, `scrollbar.base`, `hue`, `categorical`, `source()`, `increase()`, `decrease()`, `surface()`. `context.themeMode` is `"dark" \| "light"`. | `packages/plugin/src/tui/context.ts`; `packages/theme/src/tui/types.ts` |
| Custom renderable | **Confirmed** | Subclass `Renderable` from `@opentui/core`, override `renderSelf(buffer: OptimizedBuffer)`. Drawing primitives: `buffer.setCell(x, y, char, fg, bg, attrs)`, `buffer.drawText(text, x, y, fg, bg, attrs)`, `buffer.drawFillRect`/`fillRect`, `pushScissorRect`/`popScissorRect`. Register with `extend({ name: Class })` from `@opentui/solid`. | `packages/tui/src/component/spinner-renderable.ts`; `@opentui/core` `buffer.ts`; `@opentui/solid` `elements/catalogue.ts` |
| `extend` reload safety | **Confirmed** | `extend` is `Object.assign(componentCatalogue, objects)`. Re-registering a component overwrites it; no throw, no cleanup needed. | `packages/solid/src/elements/catalogue.ts` |
| Animation clock | **Confirmed** | A `Renderable` has `animationFps` and protected `onAnimationTick(deltaTime, ticks)`. The renderer’s shared clock ticks it while it is drawn; `requestRender()` schedules a paint. Set `animationFps = undefined` to stop. | `packages/tui/src/component/spinner-renderable.ts`; `@opentui/core` `Renderable.ts`, `types.ts` |
| Color capability | **Confirmed** | `context.renderer.capabilities` exposes `rgb`, `ansi256`, `unicode`, `terminal`, `remote`, etc. Prefer this over `COLORTERM`/`TERM` heuristics. `renderer.widthMethod` gives the width method. | `@opentui/core` `types.ts` (`TerminalCapabilities`), `RenderContext` |
| Server-side skill registration | **Confirmed** | The server plugin context has `ctx.skill.transform((editor) => …)` with `editor.add(Skill.Info)`. `Skill.Info` includes `{ id, name, description?, autoinvoke?, path, content }`. The authoring skill can ship inside the package. | `packages/plugin/src/promise/skill.ts`; `packages/schema/src/skill.ts`; `packages/plugin/src/README.md` |
| Install command | **Confirmed** | `opencode plugin add <package>` accepts an “npm registry or Git package specifier” and adds it to the global configuration. Subcommands: `list`, `add`, `check`, `update`, `remove`. | `opencode plugin add --help` (v2.3.2) |
| Package entrypoints | **Confirmed** | `Host.resolve` reads `exports` for `./tui` (and `./server`, `./rpc`). A local directory without `package.json` falls back to root `tui.tsx` / `index.ts`. The public package must export `./tui`; `./` is the server part. | `packages/plugin/src/host.ts` |
| Host runtime modules | **Confirmed** | The host provides `effect` and `@opencode/plugin`; plugins must not load their own copies. `ensureRuntimePluginSupport` adds `@opencode/plugin/tui` and rewrites OpenTUI/Solid modules through the host runtime. | `packages/plugin/src/runtime.ts`, `runtime-modules.ts`; `packages/tui/src/plugin/runtime-plugin-support.bun.ts`; `@opentui/core` `runtime-plugin-support-configure.ts` |
| Cleanup | **Confirmed** | `setup` may return one cleanup function; it is awaited on unload. Registrations through the context (slots, routes, dialogs, keymap layers, storage) are disposed automatically. | `packages/tui/src/plugin/context.tsx` |
| Hot reload | **Confirmed** | Local plugin sources are watched and re-imported; setup failures keep the previous generation active. `extend` is safe to re-run. | `packages/tui/src/plugin/context.tsx`, `watch.ts`, `source.bun.ts` |

---

## 3. Color performance benchmark

### Method

- Headless `createTestRenderer({ width: 180, height: 50 })` from `@opentui/core/testing`.
- A custom `Renderable` subclass draws a full 180×50 grid in `renderSelf`.
- 60 frames; **every cell changes character and color on every frame** (no retained-cell shortcuts).
- Measured full `renderOnce()` time (native scene + paint + memory output) and the draw-only time inside `renderSelf`.
- Runtime: local Bun `1.4.4`, `@opentui/core@0.8.4`, Windows 11, the user’s machine.
- Harness: `C:\Users\sangh\AppData\Local\Temp\opencode\art-spike\bench.mjs` (not part of the repo).

### Results

| Mode | Draw calls per frame | Avg frame | p95 frame | Draw only |
|---|---:|---:|---:|---:|
| Per-cell `setCell` (truecolor) | 9,000 | **3.43 ms** | **5.36 ms** | 2.39 ms |
| Per-cell `drawText` | 9,000 | 4.32 ms | 5.66 ms | 2.88 ms |
| `drawText` runs of 8 cells | 1,125 | 1.35 ms | 3.05 ms | 0.66 ms |
| `drawText` one row | 50 | 0.94 ms | 2.07 ms | 0.34 ms |

All 60 frames reported `cellsUpdated: 9000`, so the native scene updated the full grid each frame.

### Interpretation

- **Truecolor per-cell is viable as the default `original` path.** No need to force a heavy quantization step for performance.
- Run grouping is a cheap optimization, not a requirement. Keep a soft cap (for example 2,000 draw calls per frame) and group runs only when it is easy.
- Quantization remains useful for **file size and visual coherence**, not for frame rate.
- The spec’s 8 ms frame-prep target is met with margin; the 100 ms frame budget at 10 fps is not close.
- Caveat: the test renderer uses a native scene and memory output, not a real terminal. It measures drawing and native submission, which is the dominant cost. A final real-terminal check is still required.

---

## 4. What changed in the design

1. **Render with a custom `Renderable`, not `<text>` + spans.** The benchmark and the in-repo spinner example make this the lower-risk, simpler path. No Solid reconciliation of thousands of spans.
2. **Use `animationFps` + `onAnimationTick`, not a manual `requestAnimationFrame` loop.** The host clock handles timing, coalescing, and pausing while the node is not drawn. `requestRender()` on tick.
3. **Use `renderer.capabilities` for color and width.** `rgb` / `ansi256` / `unicode` replace environment-variable guessing; keep env as a fallback only.
4. **Global settings use `context.storage.store`.** Durable, atomic, cross-instance. Project override stays a file at `<project>/.opencode/art.json`.
5. **The authoring skill is embedded by the server part** via `ctx.skill.transform` + `editor.add`, not copied into the user’s skills folder. Requires a server part, so the public package keeps `index.ts`.
6. **Target OpenTUI 0.8.4.** The host pins `0.8.4`; npm latest is `0.9.2`. Do not use 0.9-only APIs. Do not bundle host SDK modules.
7. **`extend` needs no reload guard.** It is an `Object.assign` into the component catalogue.
8. **Truecolor sidecars stay.** Quantization is optional and for size, not performance.

---

## 5. Still open

These need a live OpenCode session or a package install, not more source reading.

| # | Check | Why | How |
|---|---|---|---|
| 1 | `opencode plugin add` with a local path and a Git spec | Public install path; confirms config target and TUI part loading | Scaffold a minimal package with `exports ./tui`; add it; open TUI; inspect logs |
| 2 | Real-terminal draw and CPU at 180×50×10 fps | Benchmark used a headless renderer | Run the custom renderable in the TUI; measure CPU and frame time; confirm no flicker/tearing |
| 3 | `animationFps` pause behavior on home/off | The spinner comment warns a live node can keep `renderer.idle()` pending | Toggle `/art off`, leave home; confirm renderer idles and CPU drops |
| 4 | Custom renderable at `zIndex -1` behind host content | The current `<text>` works; the renderable must compose the same way | Add it at the `app` slot; verify it paints behind, does not steal focus, and resizes |
| 5 | Skill `path` semantics | `Skill.Info.path` is an `AbsolutePath`; an embedded skill needs a sensible path | Add a skill via `ctx.skill.transform`; confirm it appears in the skill list and its content loads |
| 6 | Project settings file | No project storage API; confirm root and write permissions | Read/write `.opencode/art.json` from a project; verify precedence and atomic write |
| 7 | Watch polling in the TUI runtime | Authoring loop depends on it | Stat a pack folder on a timer; confirm reload and no timer leaks on unload |
| 8 | 256/16/mono and `NO_COLOR` behavior | Auto-degrade correctness | Run with `COLORTERM` unset/`truecolor`, `TERM=xterm-256color`, `NO_COLOR=1`; inspect `renderer.capabilities` and rendered output |
| 9 | Width-1 validation against `renderer.widthMethod` | Grid alignment across terminals | Test box drawing, combining marks, emoji, tabs; compare with host `string-width` |
| 10 | Package size with 60 color frames | Install weight | Measure `npm pack` size; target < 5 MB |
| 11 | Git package with TS/TSX entrypoints | `opencode plugin add` must handle `.tsx` without a build step | Install a minimal TS package; confirm `Host.resolve` and Bun loading |
| 12 | `opencode plugin add` config target | Documentation must say where the entry lands | Inspect `opencode.json` / `cli.json` after add |

---

## 6. Reproduce the benchmark

The harness is outside the repo by design. To rerun:

```powershell
cd C:\Users\sangh\AppData\Local\Temp\opencode\art-spike
.\node_modules\bun\bin\bun.exe bench.mjs
```

Expected output shape:

```json
{"mode":"cell","avgMs":3.428,"p95Ms":5.358,"drawMs":2.393,"cellsUpdated":9000,"nativeFrameCount":61}
```

If Bun is unavailable, install it locally in the temp folder (`npm install bun@1.4.4`) rather than globally.

---

## 7. Next

1. Finish the live checks in §5, starting with the minimal package install and the real-terminal renderable.
2. Update `docs/SPEC.md` with the confirmed choices above (this spike is the evidence).
3. Begin M1: repo scaffold, pack format, validator, discovery, player, mono/theme renderer, settings, tests.
