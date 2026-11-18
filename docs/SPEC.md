# opencode-art — Specification

**Status:** Draft v0.2 — locked product decisions, Phase 0 findings incorporated, live install/terminal checks pending.
**Date:** 2026-11-18
**Repo:** `C:\dev\opencode-art`
**License:** MIT (code) + CC BY 4.0 (bundled art)
**Evidence:** `docs/SPIKE.md` (OpenCode `v2.3.2`, OpenTUI `0.8.4`).

Legend:

- **Locked** — decided in the design interview; do not reopen without the user.
- **Proposed** — technical default chosen for review; change before implementation if wrong.
- **Phase 0** — depends on the OpenCode V2 / OpenTUI API or a measurement; must be verified before it becomes a promise.

---

## 1. Purpose

`opencode-art` is a public OpenCode TUI plugin that renders user-authored ASCII art as an animated, full-screen background on the home screen only. Four authoring paths converge on one data-only pack format:

1. Drop-in frame sequences (any tool can produce them).
2. Static canvas plus built-in motion effects.
3. Media conversion (image, GIF, video).
4. JavaScript scenes, baked offline.

Creation is agent-native: the plugin ships an authoring skill, a schema, and a CLI. The user asks the agent in chat; the model already configured in OpenCode writes the art and bakes it. The plugin never calls a model itself and never executes third-party code at runtime.

---

## 2. Locked decisions

| Area | Decision |
|---|---|
| Identity | Package `opencode-art`; command prefix `/art`. |
| Distribution | Public repo; `opencode plugin add <npm-or-git>` confirmed to accept both; Git install first, npm after a live package test. |
| Default | Enabled with the bundled **Fool** pack. Respects `animations: false` by showing a still frame. `/art off` persists. |
| Placement | Home route only. Leaving home clears the frame. Starting directly in a session draws nothing. |
| Authoring | All four paths must ship in v1.0. |
| Runtime trust | Data-only. No third-party code executes in the plugin. Scene modules run only in the CLI, on the author's machine. |
| Creation UX | Agent in chat + authoring skill + CLI. No in-plugin model call, no second inference integration. |
| Golden path | Prompt → procedural scene. This path gets the visual polish; the others get “works, validated, documented.” |
| Media | PNG/JPEG/WebP, animated GIF; video through an optional `ffmpeg` binary. |
| Color | `mono`, `theme`, `palette`, `original`; per-pack default plus user override; auto-degrade by terminal capability. |
| Settings | Global plus project override. Precedence: project > global > pack default > plugin default. |
| Live feedback | Polling watch of pack folders; auto-reload; still preview in the `/art` dialog. |
| Robustness | A bad pack never breaks the TUI. Bounded resources. Terminal-safe rendering. Versioned schema. Tests, docs, JSON schema. |
| License | MIT for code, CC BY 4.0 for bundled art. |
| Rendering | Custom OpenTUI `Renderable` drawing cells directly; measured 3.4 ms avg at 180×50×10 fps; `zIndex -1` (real-terminal composition still to verify). |
| Motion | Preserve authored motion. Never rewrite the motion of a frame pack at runtime. |

---

## 3. Non-goals for v1

- A gallery, marketplace, URL installs, or remote pack discovery.
- Runtime execution of third-party scene code.
- Multiple simultaneous art layers, per-pane backgrounds, or mouse interaction.
- A standalone GUI editor or an in-TUI model call.
- Audio, video playback, images in the terminal.
- A separate player that works outside OpenCode (the CLI may print a still preview).
- Windows-only behavior; the plugin must work on Windows, macOS, and Linux.

---

## 4. Pack format

A pack is a directory. The folder name is the pack id.

```
my-pack/
  art.json
  canvas.txt              # static pack: the picture
  canvas.ans              # optional color sidecar for canvas
  frames/                 # animated pack: 000.txt, 001.txt, ...
    000.txt
    000.ans               # optional color sidecar, same basename
    001.txt
    001.ans
  scene.mjs               # optional provenance for a baked scene; never executed by the plugin
  README.md               # optional
```

Rules:

- A pack has **exactly one** of `frames` (animated sequence) or `canvas` (static picture).
- `frames` is a directory of `.txt` files. Lexicographic order is playback order; zero-padded names are required by convention.
- Color is optional. A `.ans` sidecar shares the basename of its `.txt`; if any sidecar exists, every frame must have one. `canvas.ans` follows the same rule.
- The plugin never reads `scene.mjs`. It exists for provenance and re-baking.
- Paths in `art.json` are relative to the pack root. Absolute paths, `..`, and symlinks that escape the root are rejected.

### 4.1 Manifest

**Static pack with effects:**

```json
{
  "schemaVersion": 1,
  "id": "logo",
  "name": "Logo",
  "description": "A shimmering mark.",
  "author": "sangh",
  "license": "CC-BY-4.0",
  "fps": 10,
  "cols": 80,
  "rows": 24,
  "defaultStyle": "palette",
  "ramp": " .:-=+*#%@",
  "palette": ["#313244", "#89b4fa", "#f5c2e7"],
  "canvas": "canvas.txt",
  "effects": [
    { "type": "shimmer", "intensity": 0.25, "speed": 1, "seed": 7 }
  ]
}
```

**Animated pack:**

```json
{
  "schemaVersion": 1,
  "id": "fool",
  "name": "The Fool",
  "description": "The Fool Argon, animated.",
  "author": "sangh",
  "license": "CC-BY-4.0",
  "fps": 10,
  "cols": 180,
  "rows": 50,
  "defaultStyle": "mono",
  "ramp": " .:-=+*#%@",
  "frames": "frames",
  "source": { "type": "scene", "file": "scene.mjs", "note": "Baked by opencode-art" }
}
```

### 4.2 Field reference

| Field | Required | Type | Rules |
|---|---|---|---|
| `schemaVersion` | yes | number | `1`. A higher version is rejected with an “update the plugin” message. |
| `id` | yes | string | `^[a-z0-9][a-z0-9_-]{0,31}$`; must equal the folder name. |
| `name` | yes | string | 1–80 printable characters. |
| `description` | no | string | ≤ 500 printable characters. |
| `author` | no | string | ≤ 80 printable characters. |
| `license` | no | string | ≤ 40 characters. Required for packs accepted into the public repo; optional locally. |
| `homepage` | no | string | `https://` URL, ≤ 200 characters. |
| `fps` | yes | number | 1–30. Playback rate; also the effect step rate. |
| `cols` | yes | integer | 1–400. Every frame and canvas line must match exactly. |
| `rows` | yes | integer | 1–200. Frame count and canvas line count must match exactly. |
| `defaultStyle` | no | enum | `mono`, `theme`, `palette`, `original`. Default `mono`. |
| `ramp` | no | string | 2–64 unique width-1 glyphs, low to high density. Recommended for palette/theme styles. |
| `palette` | no | string[] | 2–32 `#rrggbb` colors, low to high brightness. Required for `palette` style unless a theme ramp is used. |
| `frames` | one of | string | Relative directory containing the sequence. |
| `canvas` | one of | string | Relative `.txt` file for a static pack. |
| `effects` | no | object[] | ≤ 4 effects. Only valid with `canvas`; an error with `frames`. |
| `source` | no | object | Provenance metadata. Ignored at runtime. Unknown subfields are ignored. |

Unknown top-level fields are ignored with a warning. This keeps old plugins able to read newer packs.

### 4.3 Frame rules

- `.txt` files are UTF-8, LF or CRLF; one optional trailing newline is stripped.
- Every line must contain exactly `cols` **width-1 printable characters**. Tabs, control characters, combining marks, and wide characters are rejected. This keeps the grid aligned in every terminal.
- Every frame must have exactly `rows` lines.
- Trailing spaces are meaningful cells and are preserved.
- All frames must have identical dimensions equal to `cols` × `rows`.
- 1–600 frames per pack.
- The loop duration is `frameCount / fps`. There is no separate `loop` field for frame packs.

### 4.4 Canvas and effects

- `canvas.txt` follows the same line rules and must match `cols` × `rows`.
- Without `effects`, a canvas is drawn once and the animation loop stops. This is the lowest-CPU mode.
- With `effects`, the canvas is redrawn at `fps`.
- Effects compose in array order. Each effect must preserve dimensions and, for color canvases, move colors with their cells.
- Effects do not run when `animations: false`; the canvas is shown at `t = 0`.

Supported effects:

| Type | Parameters | Behavior |
|---|---|---|
| `shimmer` | `intensity` 0–1, `speed` 0–4, `seed` integer | Deterministic sparkle that swaps cells within their density bucket. |
| `wave` | `intensity` 0–1, `speed` 0–4, `axis` `x` or `y` | Sine displacement of the grid. Amplitude scales with `intensity`. |
| `drift` | `intensity` 0–1, `speed` 0–4, `axis` `x` or `y` | Wrapped scroll of the canvas. |
| `twinkle` | `intensity` 0–1, `speed` 0–4, `seed` integer | Sparse cells fade between their glyph and a space. |
| `scanline` | `intensity` 0–1, `speed` 0–4, `axis` `x` or `y` | A moving band brightens or dims cells. |

`intensity` is normalized. The exact visual mapping is documented in `docs/AUTHORING.md` and may be tuned without changing the schema.

### 4.5 ANSI color sidecars

A `.ans` file supplies **foreground color only**. It contains the same characters as its `.txt` companion, with SGR sequences between them.

- Allowed: `\x1b[38;2;R;G;Bm`, `\x1b[38;5;Nm`, `\x1b[30–37m`, `\x1b[90–97m`, and reset `\x1b[0m` or `\x1b[39m`.
- Rejected or stripped with a warning: background colors, cursor movement, erase, OSC, hyperlinks, and any other escape.
- **Invariant:** stripping all SGR sequences from a sidecar line must produce exactly the matching `.txt` line. The `.txt` is the canonical character data; the `.ans` only adds color.
- Every frame must have a sidecar if any frame does. A partially colored sequence is a validation error.
- A maximum of 4096 unique colors per frame is accepted. The baker quantizes to 64 colors by default.

### 4.6 Caps

| Resource | Limit |
|---|---|
| `cols` | 1–400 |
| `rows` | 1–200 |
| Frames per pack | 1–600 |
| FPS | 1–30 |
| Pack data (manifest + frames + sidecars) | 20 MB |
| Single frame file | 1 MB |
| Palette stops | 2–32 |
| Ramp glyphs | 2–64 |
| Effects per canvas | 4 |
| Unique colors per frame | 4096 |
| `id` length | 1–32 characters |
| Name / description / author / license | 80 / 500 / 80 / 40 characters |

These are hard ceilings. The CLI may downscale or quantize to fit; the loader rejects oversized packs with an actionable message.

### 4.7 Validation

Discovery checks the manifest and the frame/sidecar stats. Frame contents are checked when a pack loads. A pack with any error is skipped, listed in the dialog's Problems section, and never partially rendered.

Additional rules:

- JSON parse errors report file and position.
- `id` must match the folder name.
- `frames` and `canvas` are mutually exclusive.
- `effects` with `frames` is an error.
- All paths resolve inside the pack root.
- Symlinks are followed only if the resolved path stays inside the root.
- Duplicate ids within one scope: the lexicographically first wins; the other is reported.
- Unknown top-level fields warn but do not reject.
- `schemaVersion` greater than 1 rejects the pack.

---

## 5. Rendering

### 5.1 Styles

| Style | Color source | Available when | Fallback |
|---|---|---|---|
| `mono` | Theme `text.faint` | Always | — |
| `theme` | Theme tokens mapped by brightness | Always | `mono` |
| `palette` | Pack `palette`, or theme stops when the pack has none | Always | `theme`, then `mono` |
| `original` | Per-cell RGB from `.ans` | Color sidecars exist and the terminal supports color | `palette`, `theme`, then `mono` |

The effective style is always shown in the dialog. If it differs from the requested style, a one-time toast explains why.

### 5.2 Brightness

- If `ramp` is declared, a glyph’s brightness is its rank in the ramp, normalized 0–1.
- Glyphs outside the ramp use a built-in density table for common ASCII glyphs; unknown glyphs use 0.5.
- `palette` maps brightness to the nearest palette stop (no continuous interpolation). This bounds the color count and makes run grouping cheap.
- `theme` maps brightness to three theme stops: `text.faint` (low), `text.muted` (mid), and `text.base` or `hue` (high). The tokens are confirmed; the high-stop choice is a design decision.
- `original` uses the sidecar RGB exactly on truecolor terminals; lower-capability terminals quantize.

### 5.3 Fit and resize

- Art fills the terminal edge to edge: `left = 0`, `top = 0`, full width and height.
- Frames are resampled with nearest-neighbor to the current terminal grid. Color grids are resampled with the same mapping so glyphs and colors stay aligned.
- Fitted grids are cached per pack and terminal size. Resizing recomputes once; playback does not resample every frame.
- For canvas packs, the base grid is fitted once and effects are applied at display size, so motion is resolution-independent.

### 5.4 Terminal capability

Detection lives in `context.renderer.capabilities` (confirmed in Phase 0), with environment variables only as a fallback:

| Capability | Detection | Behavior |
|---|---|---|
| Truecolor | `renderer.capabilities.rgb === true` (fallback: `COLORTERM` contains `truecolor`/`24bit`) | `original` exact; `palette` and `theme` exact. |
| 256 colors | `renderer.capabilities.ansi256 === true` (fallback: `TERM` contains `256color`) | `original` and `palette` quantized to the nearest 256-color entry; `theme` quantized. |
| 16 colors | Color terminal without RGB/ANSI256 | `original` falls back to `palette` (or `theme` when the pack has no palette); `palette` and `theme` quantized to 16 colors. |
| No color / `NO_COLOR` | `NO_COLOR` set, `TERM=dumb`, or no color capability | Effective style `mono`. |

`NO_COLOR` is respected. The dialog shows the effective capability; the user cannot force a mode the terminal cannot render meaningfully.

### 5.5 Light and dark themes

- `mono`, `theme`, and `palette` use the active theme, so they follow light/dark automatically.
- `original` colors are authored for a specific background. On a light theme, the resolver samples the sidecar colors and tests them against the theme background. A color passes when it already reaches 2.2:1 contrast, or when a blend of at most 25% toward the theme foreground reaches 3:1. If too many sampled colors fail, the pack falls back to `palette` (or `theme` when it has no palette). Colors that pass are shown exactly; v1 does not blend per cell.
- The dialog labels the fallback instead of hiding it.

### 5.6 Performance budget

- Target: ≤ 8 ms of frame preparation per frame at 180×50, 10 fps, on the reference machine.
- Phase 0 measured **3.4 ms average / 5.4 ms p95** for a full 9,000-cell truecolor `setCell` frame under Bun 1.4.4 + `@opentui/core` 0.8.4 (see `docs/SPIKE.md` §3). The budget is met with margin.
- The custom renderable measures its own `renderSelf` time. If the rolling average exceeds 12 ms for 30 frames, degrade `original` → `palette` once and toast.
- If it still exceeds 20 ms, halve the effective fps down to a floor of 5 and toast once.
- Degradation is a safety net, not the expected path; it is per session and never oscillates. The user can reselect the style.

### 5.7 Timing and lifecycle

- A custom `Renderable` with `animationFps = fps` and `onAnimationTick(deltaTime, ticks)`; the host’s shared clock drives it while the node is drawn. No manual `requestAnimationFrame` loop (confirmed in Phase 0).
- Draw only when the route is `home` and the art is enabled.
- Leaving home clears the frame and resets the clock. Returning home redraws immediately.
- `/art off` clears immediately. `/art on` redraws.
- `animations: false`: draw one still frame, no frame advancement. Canvas effects freeze at `t = 0`.
- Static canvas with no effects: draw once; no animation loop.
- Cleanup sets `animationFps = undefined`, clears the frame, stops watching, and unregisters the keymap layer. One composed cleanup function is returned from `setup`.

### 5.8 Render path

- **Confirmed in Phase 0:** one absolute custom `Renderable` at the `app` slot with `zIndex = -1`. `renderSelf(buffer)` draws cells directly with `setCell`/`drawText`; no `<text>` + `<span>` tree and no Solid reconciliation per frame.
- Full truecolor is viable: 9,000 `setCell` calls measured 3.4 ms average / 5.4 ms p95 per frame. Run grouping is an optional optimization, not a requirement.
- The renderable must not keep the renderer live when art is off or off-home: set `animationFps = undefined` and clear the frame. This is the one lifecycle risk called out by the host spinner implementation.

---

## 6. Commands and dialog

### 6.1 Commands

Syntax (space-separated arguments; **confirmed** in Phase 0: `slash.arguments: true`, `run(input?, event?)`):

| Command | Behavior |
|---|---|
| `/art` | Open the dialog. |
| `/art on` / `/art off` / `/art toggle` | Enable or disable the background; persist. |
| `/art next` | Select the next available pack in scope order; wrap; toast the name. |
| `/art set <id>` | Select a pack by id. Unknown id → toast with close matches. |
| `/art style <mono\|theme\|palette\|original>` | Set the style; unavailable style → toast with available options. |
| `/art fps <1–30>` | Set playback fps; clamp and toast. |
| `/art reload` | Re-scan and re-validate all pack folders. |
| `/art validate [id\|path]` | Validate one pack or all packs; report errors (capped at 100 per pack) and warnings. A filesystem path is accepted read-only for authors. |
| `/art help` | List commands and the global/project arts paths. |

There is no `/art list`; the dialog is the list. There is no `/art create`; creation happens in chat with the agent.

No flat aliases are registered on `v2.3.2`; slash arguments are supported. If a future host removes slash arguments, add flat aliases (`art-on`, `art-off`, `art-next`, `art-style`, `art-fps`, `art-reload`, `art-validate`, `art-help`) so every feature stays reachable.

Errors are actionable toasts, never silent failures. Validation detail goes to the plugin log and the dialog’s Problems section.

### 6.2 Dialog

- Header: **ASCII Art**.
- Pack list: id, display name, scope badge (`project`, `user`, `bundled`), active marker, available style badges.
- Preview: a still frame of the selected pack in the effective style, fitted to the preview area. No animation in the preview.
- Settings: Enabled, Style, FPS. Changes apply live and persist.
- Problems: invalid packs with one-line reasons; not selectable.
- Footer: navigation keys, the global arts path, and “Create art by asking the agent in chat.”
- Empty state: the arts path and the agent hint.
- Keyboard-only. Status is conveyed by text, not color alone.

Exact key bindings are Phase 0; the dialog must remain usable with arrows, Enter, and Escape at minimum.

### 6.3 Settings

Shape:

```json
{
  "version": 1,
  "enabled": true,
  "pack": "fool",
  "style": "mono",
  "fps": 10
}
```

- **Global:** `context.storage.store("settings", { initial })` — durable JSON, atomic writes, file locking, live-synced across TUI instances. The physical path is managed by OpenCode, not the plugin.
- **Project:** `<project>/.opencode/art.json` — committed and shareable. The project root is `context.location.directory` (fallback `process.cwd()`), confirmed in Phase 0.
- Precedence: project > global > pack `defaultStyle`/`fps` > plugin default (`enabled: true`, `style: mono`, `fps: pack fps`).
- `enabled` can be overridden per project so a serious repo can disable art.
- **Global writes use the storage API's atomic mutation.** The plugin never writes the project file; edit it by hand and commit it. A failed global write keeps the value in memory and toasts once.
- Invalid fields are ignored individually; the file is not wiped. Unknown fields are preserved.
- The global record is created on first change, not on install.

---

## 7. Discovery and lifecycle

### 7.1 Locations and precedence

| Scope | Path | Precedence |
|---|---|---|
| Project | `<project>/.opencode/arts/<id>/` | Highest |
| User | `~/.config/opencode/arts/<id>/` | Middle |
| Bundled | `<plugin>/frames/<id>/` | Lowest |

- The project root is `context.location.directory`; `process.cwd()` is the fallback (confirmed in Phase 0).
- Same id across scopes: the higher scope wins.
- Duplicate id within one scope: lexicographically first wins; the other is reported.
- Exactly one pack is active at a time.
- Packs are loaded lazily. The active pack and the bundled fallback are kept; at most two packs are cached.
- The bundled Fool is always the last-resort fallback.

### 7.2 Watch

- **Proposed:** polling every 2 seconds, not native `fs.watch`, for cross-platform behavior.
- Signature: directory mtime plus file names, sizes, and mtimes. Debounce 500 ms after a change.
- On change: re-scan, re-validate, reload the active pack if it changed, and refresh the dialog.
- If the active pack disappears or becomes invalid, keep the last good frames; if none exist, fall back to the bundled Fool; toast once.
- Watch errors are logged and polling continues.
- Polling stops when the plugin is disabled or cleaned up.

### 7.3 Failure handling

| Failure | Behavior |
|---|---|
| Plugin setup throws | Catch, log, toast once, render nothing. TUI unaffected. |
| Manifest invalid | Skip pack; list in Problems; toast once per pack. |
| Frame read fails | Skip pack; keep last good art. |
| Active pack removed | Keep last good frames; re-scan; fall back to bundled if needed. |
| Settings invalid | Ignore invalid fields; defaults apply; toast once. |
| Settings write fails | Keep in memory; toast once. |
| Watch fails | Log; continue polling. |
| Render throws | Catch; stop the loop after 3 consecutive errors; toast; clear the frame. |
| ANSI malformed | Strip unsupported sequences; warn; never pass raw escapes through. |
| Path escapes pack root | Reject pack. |
| Oversized file | Stat before read; reject with the cap in the message. |
| Missing bundled pack | No art; toast; plugin still loads. |

No failure path may throw out of `setup` or crash the TUI.

---

## 8. Authoring

### 8.1 CLI

Binary: `opencode-art`.

| Command | Purpose |
|---|---|
| `opencode-art init <dir>` | Scaffold `art.json`, `canvas.txt`, and a short README. Refuses to overwrite a non-empty directory unless `--force`. |
| `opencode-art bake <input> --out <dir>` | Bake an image, GIF, video, or `.mjs` scene into a pack. |
| `opencode-art validate <dir>` | Validate a pack and print every error with file and line (up to 100, then a count). Exit 1 on failure. |
| `opencode-art preview <dir> [--frame N] [--width N]` | Print a downscaled still preview to stdout. |
| `opencode-art help` | Usage. |

`bake` options (Proposed):

- `--cols`, `--rows` — output grid; defaults 180×50; caps apply.
- `--fps` — frames per second; default 10.
- `--loop` — seconds for scene/video/GIF; default 6.
- `--charset` or `--ramp` — glyph ramp; default ` .:-=+*#%@`.
- `--palette` — comma-separated hex stops for color output.
- `--colors` — quantize to N colors; default 64.
- `--dither` — enable Floyd–Steinberg for mono output.
- `--mono` — force a mono pack with no color sidecars; conflicts with `--palette`.
- `--timeout` — scene timeout in seconds; default 60.
- `--invert` — invert luminance.
- `--aspect` — sample aspect ratio; default 0.5 (terminal cells are about twice as tall as wide).
- `--force` — overwrite a non-pack output directory.

Behavior:

- Image input produces a static canvas (`canvas.txt`, optional `canvas.ans`) with no effects; the author adds effects to `art.json`.
- GIF/video/scene input produces a frame sequence.
- Output is validated before the command reports success.
- No network access and no telemetry.
- Pure-JS decoders for PNG/JPEG/WebP/GIF; no native modules. Video requires `ffmpeg` on `PATH`; a missing binary is a clear, actionable error.

Exit codes: `0` success, `1` validation or user error, `2` unexpected failure.

### 8.2 Scene API

A scene is an ESM module with deterministic output:

```js
export const meta = { fps: 10, cols: 180, rows: 50, loop: 6 }

export function scene(t, ctx) {
  // Return string[] for mono, or { chars, colors } for color.
  return { chars: rows, colors: colorRows }
}
```

- `t` is seconds, sampled at `i / fps`.
- `ctx` provides `{ cols, rows, frame, fps, palette, seed }`.
- `chars` is an array of `rows` strings, each exactly `cols` width-1 characters.
- `colors` is an array of `rows` arrays of `#rrggbb` strings or `null` for the default color.
- `meta` is required; `fps`, `cols`, and `rows` are required; `loop` defaults to 6 seconds.
- Determinism: use `ctx.seed` and seeded helpers; do not use `Math.random()` or `Date.now()`. The CLI bakes fixed timesteps.
- Isolation: the CLI imports the scene in a child process with a timeout (default 60 s) and a memory cap. A crashing or hanging scene fails the bake without affecting the plugin.
- Helpers exported from `opencode-art/scene`: `loadCanvas`, `wave`, `shimmer`, `drift`, `twinkle`, `scanline`, `palette`, `noise`, `clamp`, `lerp`.
- Scene modules are **never** loaded by the running plugin.

### 8.3 Agent skill

Repository path: `skills/opencode-art/SKILL.md`.

The skill teaches:

- When to use the plugin (user asks for a background, animated ASCII, a logo, etc.).
- Pack layout, manifest fields, and caps.
- The scene API and helpers, with a small worked example.
- The four authoring paths and when to choose each.
- `init` → write → `bake` → `validate` → `preview` → set.
- The global and project arts paths.
- Common failures: wrong dimensions, wide characters, missing sidecars, oversized packs.
- Never edit the bundled pack; never execute a scene from an untrusted pack; ask before overwriting an existing pack.

Auto-registration is **confirmed possible** through the server part: `ctx.skill.transform((editor) => editor.add({ id, name, description, path, content }))`; `Skill.Info` supports embedded content. Phase 0 still needs to verify the `path` semantics and that the skill appears in the agent’s skill list. If the API changes, the fallback is a documented copy of `skills/opencode-art` into `~/.config/opencode/skills/`.

### 8.4 Creation workflow

1. User: “Make me a rainy city background.”
2. Agent loads the skill, asks only for missing essentials (fps, color, project or global).
3. `opencode-art init ~/.config/opencode/arts/rainy-city`
4. Agent writes `scene.mjs` or `canvas.txt` + effects.
5. `opencode-art bake scene.mjs --out ~/.config/opencode/arts/rainy-city`
6. `opencode-art validate` and `opencode-art preview`.
7. The watcher refreshes the background. `/art set rainy-city` if another pack was active.
8. If anything fails, the agent reads the validation errors and fixes the source.

---

## 9. Public repository

### 9.1 Layout

```
opencode-art/
  package.json
  tsconfig.json
  index.ts                 # server part
  tui.tsx                  # TUI part
  src/
    art/                   # manifest, validation, discovery, loading
    render/                # fit, styles, colors, runs, capability
    effects/
    settings/
    watch/
    commands/
    scene/                 # helpers shared by the CLI
  bin/opencode-art.cjs
  scripts/                 # repo-only dev scripts (Fool bake, render smoke)
  skills/opencode-art/SKILL.md
  frames/fool/             # bundled default pack
  examples/                # copy-to-use packs, not loaded by default
  schemas/art.schema.json
  docs/
    SPEC.md
    PACKS.md
    AUTHORING.md
    SCENE_API.md
    COMMANDS.md
    COMPATIBILITY.md
    TESTING.md
    MIGRATION.md
    SPIKE.md               # Phase 0 findings
  test/fixtures/
  .github/workflows/ci.yml
  LICENSE                  # MIT
  LICENSE-ART              # CC BY 4.0
  README.md
  CONTRIBUTING.md
```

### 9.2 Package and exports

**Confirmed shape; live package install still pending:**

```json
{
  "name": "opencode-art",
  "type": "module",
  "exports": {
    ".": "./index.ts",
    "./tui": "./tui.tsx",
    "./scene": "./src/scene/index.ts",
    "./schema": "./schemas/art.schema.json"
  },
  "bin": { "opencode-art": "./bin/opencode-art.cjs" },
  "files": [
    "index.ts", "tui.tsx", "src/", "frames/", "schemas/",
    "skills/", "bin/", "docs/", "scripts/", "README.md",
    "CONTRIBUTING.md", "LICENSE", "LICENSE-ART"
  ]
}
```

- The host provides `effect`, `@opencode/plugin`, `@opentui/core`, `@opentui/solid`, and `solid-js` through its runtime support. Do not bundle or depend on them; declare them as optional peers if a package manager needs the hint. `ensureRuntimePluginSupport` is installed by the host and is idempotent.
- Target OpenTUI `0.8.4` (the host version); npm latest `0.9.2` is not the compatibility target.
- `extend()` is an `Object.assign` into the component catalogue; re-registering a custom renderable on hot reload is safe.
- `Host.resolve` reads `exports["./tui"]` for a package and falls back to root `tui.tsx` for a directory without a manifest. `opencode plugin add` accepts npm and Git package specifiers.
- Image decoders are imported only by the CLI, never by the TUI part.
- If a live install still hits a dual-Solid issue, the documented install path is a local clone; `docs/SPIKE.md` tracks the open check.

### 9.3 Documentation

| File | Contents |
|---|---|
| `README.md` | What it is, install, first run, commands, creating art, examples, compatibility, license. |
| `docs/PACKS.md` | Full pack format, manifest fields, sidecars, effects, caps, validation errors. |
| `docs/AUTHORING.md` | Agent workflow, CLI, media conversion, scene API, troubleshooting. |
| `docs/SCENE_API.md` | Scene contract, helpers, determinism, examples. |
| `docs/COMMANDS.md` | Command reference and dialog keys. |
| `docs/COMPATIBILITY.md` | Terminal capability, color degradation, light/dark, SSH. |
| `docs/TESTING.md` | How to run tests and the manual TUI checklist. |
| `docs/SPIKE.md` | Phase 0 measurements and decisions. |

### 9.4 License

- Code: MIT (`LICENSE`).
- Bundled art: CC BY 4.0 (`LICENSE-ART`).
- Packs accepted into the public repo must declare a license; CC BY 4.0 is the default.

### 9.5 Migration from `ascii-bg`

- Keep the installed `~/.config/opencode/plugins/ascii-bg` untouched until the new package passes acceptance.
- Develop in `C:\dev\opencode-art`; for live testing, point `opencode.json` (combined plugin) or `cli.json` (TUI-only) at the repo path. `opencode plugin add` accepts a Git package for the public path.
- Move the Fool frames to `frames/fool`; re-bake with color sidecars.
- Keep the Fool-specific bake script under `scripts/` for reproducibility; it is not the public converter.
- After acceptance: update `cli.json`, remove the old plugin folder with explicit confirmation, and keep a rollback note.

---

## 10. Testing and quality

### 10.1 Unit tests

- Manifest validation: every rule, including required fields, ranges, id/folder match, unknown fields, future schema version.
- Frame parsing: dimensions, width-1 characters, tabs/control/wide characters, CRLF, trailing spaces, frame count.
- Sidecars: SGR parsing, strip-and-match invariant, rejected escapes, partial sidecars, unique-color cap.
- Path safety: `..`, absolute paths, symlink escape.
- Caps: each limit, stat-before-read.
- Discovery precedence and duplicate ids.
- Settings precedence, partial invalid files, atomic write failure.
- Fit/resample determinism.
- Palette/ramp mapping, unknown glyphs.
- Effects: determinism, dimensions, color movement, composition, `t = 0`.
- Capability detection and degradation order.
- Timing: accumulation, skip-not-queue, home gate, `animations: false`.

### 10.2 Integration and golden tests

- Load the bundled Fool pack; hash frame 0 and sample RGB cells from a color sidecar.
- Load a tiny fixture pack and render cells and color runs; assert characters and colors.
- Invalid pack fixtures: one per failure mode; assert skip + reported reason, no throw.
- Watch: change a fixture, assert reload and fallback.
- CLI: bake a 4×2 PNG and a 2-frame GIF; validate output; reject a bad scene; time out a hanging scene.
- Settings: project override wins; invalid project file falls back.

### 10.3 Manual TUI checklist

- Fresh install shows Fool on home; sessions show nothing.
- `/art` dialog lists, previews, selects, changes style/fps, persists.
- Resize: art stays edge to edge; no crop.
- Mono/theme/palette/original; truecolor/256/16/mono; light/dark.
- Invalid pack: toast + fallback; TUI unaffected.
- Watch: edit a pack, see the change without restart.
- `/art off` clears; `/art on` returns; restart preserves.
- Starting directly in a session draws nothing.

### 10.4 CI

- GitHub Actions: Ubuntu and Windows, Node LTS.
- `npm ci`, typecheck, unit + integration tests, CLI tests.
- No test framework dependency for runtime code; use `node:test` with Node 24 native TypeScript type stripping. No `tsx` or other transpiler is required.

---

## 11. Milestones

| Milestone | Deliverable | Exit criteria |
|---|---|---|
| **M0 — Spike** | `docs/SPIKE.md` with API answers and color/perf measurements. | Every Phase 0 item answered or explicitly deferred; spec updated. |
| **M1 — Core** | Repo scaffold, pack format, validator, discovery, player, mono/theme/palette rendering, settings, caps, tests, schema. Fool as a mono pack. | A valid pack loads, validates, and plays; invalid packs never crash; unit tests cover every rule. |
| **M2 — Color and commands** | Original style, ANSI parsing, quantization, capability/degradation, full `/art` dialog + subcommands, persistence, watch, Fool color sidecars. | All four styles work and degrade; dialog and commands persist; watch reloads; tests green. |
| **M3 — Effects** | Effects engine, schema, canvas packs, examples, docs. | A static canvas animates with each effect; determinism tests; no effect on frame packs. |
| **M4 — Authoring** | CLI (`init`, `bake`, `validate`, `preview`), scene API + helpers, image/GIF/video, skill, examples. | An agent can create and bake a procedural scene from a prompt; converter round-trips media; validation is actionable. |
| **M5 — Release** | Packaging, `opencode plugin add` verification, CI, license, migration, docs/screenshots. | Clean install on Windows and Linux; acceptance checklist passes; v0.1.0 tagged. |

Each milestone is independently usable and must keep the previous tests green.

---

## 12. Phase 0 checklist

Full evidence and source references: `docs/SPIKE.md`.

**Confirmed on OpenCode `v2.3.2` / OpenTUI `0.8.4`:**

- Slash-command arguments (`slash.arguments: true`, `run(input?, event?)`).
- Custom dialogs (`ui.dialog.show` + `set`).
- Project root (`context.location.directory`).
- Durable global settings (`context.storage.store`); project override remains a file.
- Theme tokens and `themeMode`.
- Custom `Renderable` with direct cell drawing; per-cell truecolor measured at 3.4 ms avg / 5.4 ms p95 for 9,000 cells.
- `extend()` reload safety (`Object.assign`).
- Server-side skill registration (`ctx.skill.transform` + `Skill.Info` content).
- `opencode plugin add` accepts npm and Git package specifiers.
- Package `exports["./tui"]` resolution; local `tui.tsx` fallback.
- Host runtime modules for `effect` / `@opencode/plugin`; OpenTUI/Solid support is host-installed.
- Single composed cleanup; context registrations auto-dispose.

**Still open (live session or package install required):**

| Item | Why it matters | How to verify |
|---|---|---|
| `opencode plugin add` with a local path and a Git spec | Public install path; config target | Scaffold a minimal package with `exports ./tui`; add it; open TUI; inspect config and logs. |
| Real-terminal draw and CPU at 180×50×10 fps | Benchmark used a headless renderer | Run the custom renderable in the TUI; measure CPU/frame time; check flicker/tearing. |
| `animationFps` pause behavior | A live node can keep `renderer.idle()` pending | Toggle `/art off`, leave home; confirm the renderer idles and CPU drops. |
| Custom renderable at `zIndex -1` | Must paint behind host content without stealing focus | Add it at the `app` slot; verify stacking, focus, and resize. |
| Skill `path` semantics | `Skill.Info.path` is an `AbsolutePath` used for an embedded skill | Add a skill via `ctx.skill.transform`; confirm it appears and its content loads. |
| Project settings file | No project-scoped storage API | Read/write `.opencode/art.json`; verify precedence and atomic write. |
| Watch polling | Authoring loop depends on it | Stat a pack folder on a timer; confirm reload and no timer leaks. |
| 256/16/mono and `NO_COLOR` | Auto-degrade correctness | Run with different `COLORTERM`/`TERM`/`NO_COLOR`; inspect `renderer.capabilities` and output. |
| Width-1 validation | Grid alignment | Test box drawing, combining marks, emoji, tabs against `renderer.widthMethod`. |
| Bundle size | Install weight | Measure `npm pack` with 60 color frames; target < 5 MB. |
| TS/TSX entrypoints in a Git package | `opencode plugin add` must load without a build step | Install a minimal TS package; confirm `Host.resolve` and Bun loading. |

---

## 13. Open questions

Product calls still needed:

1. Project override: committed `.opencode/art.json` or local-only? *(Proposed: committed.)*
2. `/art validate <path>` outside the arts directories: allow read-only? *(Proposed: yes, for authors.)*
3. Dialog preview: color in the effective style, or mono only for speed? *(Proposed: effective style, still frame; per-cell color is now measured as cheap.)*
4. Ship examples in the npm package or repo only? *(Proposed: repo only; bundled Fool is the only default.)*
5. Rename plugin ids to `opencode-art.*` now, or keep `ascii-bg.*` through migration? *(Proposed: rename; migrate config once.)*

Resolved by Phase 0:

- Skill registration: server `ctx.skill.transform` + `editor.add`; embed the skill. Only the `path` field semantics remain to test.
- npm/Git install: `opencode plugin add` accepts both; host runtime support exists. Publish after a live install test.

---

## 14. Acceptance criteria (v1.0)

- [ ] Clean install on Windows and Linux via `opencode plugin add`; Fool plays on home; sessions draw nothing.
- [ ] `/art` dialog lists packs, previews, selects, changes style/fps, toggles, and persists.
- [ ] Project override wins over global; invalid files fall back field by field.
- [ ] All four authoring paths produce a valid pack that loads and plays.
- [ ] An agent can go from a prompt to a procedural scene, baked and visible via watch, without a restart.
- [ ] Every validation rule has a test; every failure mode in §7.3 is exercised; no path crashes the TUI.
- [ ] Mono/theme/palette/original render; truecolor/256/16/mono degrade correctly; light/dark remains readable.
- [ ] 180×50 at 10 fps stays within the frame-prep budget; caps are enforced; idle CPU is negligible.
- [ ] Watch reloads edits; removing the active pack falls back safely.
- [ ] CI is green on Ubuntu and Windows; docs, schema, and examples are published.
- [ ] Migration from `ascii-bg` is documented and reversible.
- [ ] Path traversal, ANSI injection, and oversized files are rejected with tests.

---

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Per-cell color rendering | Original mode unusable | Custom `Renderable` measured at 3.4 ms avg / 5.4 ms p95 at 180×50×10 fps; palette/theme fallback retained as a safety net. |
| OpenCode V2 APIs change | Rework | Isolate behind small adapters; Phase 0 findings; pin the tested version (`2.3.2`). |
| OpenTUI/Solid packaging on install | Install path breaks | Host runtime support exists; verify a live `opencode plugin add`; document a local clone fallback. |
| Scope: four authoring paths in v1 | Long build, uneven quality | Milestones; golden path gets polish; every path must pass validation and docs. |
| Unicode width and terminal differences | Misaligned art | Width-1-only rule; reject wide/combining; test fixtures. |
| Watch polling overhead | Wasted CPU | 2 s interval, signature compare, stop when disabled. |
| Huge or hostile packs | Memory/CPU exhaustion | Stat before read; hard caps; path safety; ANSI allowlist. |
| Agent-generated art is low quality | Bad first impression | Skill includes examples and a preview/iterate loop; golden path is procedural. |
| Public pack quality | Support load | Validation, Problems list, examples, `validate` CLI, contribution rules. |

---

## 16. Review checklist

- [ ] The pack format covers all four authoring paths without special cases.
- [ ] The color model is worth the performance risk; the fallback order is acceptable.
- [ ] The `/art` command set and dialog surface are the right size.
- [ ] The settings precedence and project file choice are acceptable.
- [ ] The caps are sane for a 180×50 terminal and for smaller/larger ones.
- [ ] The agent skill + CLI is the right creation UX; no in-TUI model call.
- [ ] The milestone order ships something usable early.
- [ ] The live checks in §12 are completed or explicitly deferred before M1 ships.
- [ ] The open questions in §13 are answered.
