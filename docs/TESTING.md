# Testing

## Requirements

- Node 24 for development and CI. The package declares Node 22.18 or newer.
- Dependencies from `package-lock.json`.
- No network access is needed by the test suite.

```sh
npm ci
npm run typecheck
npm test
```

| Script | What it does |
|---|---|
| `npm run typecheck` | Runs `tsc --noEmit`. |
| `npm test` | Runs every `test/**/*.test.ts` file with `node:test`. |
| `npm run test:node` | Same as `npm test`. |
| `npm run cli` | Runs the authoring CLI from `bin/opencode-art.cjs`. |

Run one file:

```sh
node --test test/commands.test.ts
```

Run tests by name:

```sh
node --test --test-name-pattern "original" "test/**/*.test.ts"
```

## Test layout

| File | Covers |
|---|---|
| `test/smoke.test.ts` | Shared constants are importable. |
| `test/commands.test.ts` | `/art` argument parsing (`set`, `style`, `fps`, `dim`, `validate`), case folding, missing arguments, unknown names. |
| `test/commands-preview.test.ts` | Dialog width fitting, preview color-run grouping, `fit` modes, `frameIndex`, canvas animations, `lightLift`, and `dim`. |
| `test/plugin.test.ts` | Pack selection, project overrides and pin warnings, fallback, persistence, queued reload behavior, watcher roots (including `.opencode/art.json`). |
| `test/settings.test.ts` | Field-by-field settings validation (including `dim`), unsupported versions, precedence, `project()`, failed global writes, live sync. |
| `test/watch.test.ts` | Poll signatures for directories and files, parallel directory scans, content changes, debounced reload, clean stop. |
| `test/art/manifest.test.ts` | Required fields, `fit` modes, caps, id/folder match, effects, unknown top-level and effect fields, printable text checks. |
| `test/art/grid.test.ts` | Line endings, trailing spaces, dimensions, width-1 glyph, Private Use Area, and wide BMP symbol rejection. |
| `test/art/load.test.ts` | Frame ordering, sidecar loading, pack caps, UTF-8, symlinks. |
| `test/art/discover.test.ts` | Scope precedence, symlinked pack directories, duplicates, invalid packs, lazy discovery. |
| `test/art/sidecar.test.ts` | SGR allowlist, strip invariant, warnings, color cap. |
| `test/art/paths.test.ts` | Path escapes, absolute paths, drive letters, symlink containment. |
| `test/integration/fool.test.ts` | The bundled Fool loads with 60 frames and color. |
| `test/cli/cli.test.ts` | The real CLI binary: `init`, `validate`, `preview` (`--animate`, `--loops`), image and GIF bakes, `--seed`, `--fit`, scenes, `node_modules` TS-strip hook execution, `null` vs `#000000` colors, `-h`/`--`, timeouts, bad options, and a missing `ffmpeg`. |
| `test/cli/scene.test.ts` | Scene helpers: dimensions, color travel, large/negative time wrapping in `drift`/`wave`, determinism, and input immutability. |
| `test/render/brightness.test.ts` | Ramp rank, density table, out-of-bounds cells. |
| `test/render/capabilities.test.ts` | Host capabilities, environment fallback, `NO_COLOR`, `TERM=dumb`. |
| `test/render/colors.test.ts` | Hex parsing, xterm 256 mapping, 16/256 quantization, contrast. |
| `test/render/effects.test.ts` | Determinism, dimensions, color travel, `scanline` custom ramp, composition, `t = 0`, degenerate input. |
| `test/render/fit.test.ts` | `stretch`, `contain`, `cover`, and `center` fit modes, character/color alignment, trailing spaces, empty grids. |
| `test/render/index.test.ts` | The render barrel exposes the public API. |
| `test/render/player.test.ts` | Frame accumulation, skipped frames, wrap, static canvas, `animations: false`. |
| `test/render/renderable.test.ts` | Display frame selection, canvas effects, `dim`, light-theme contrast lift, fast mono, `drawText` run-grouping, degradation persistence, `onDestroy`/`recover()`, paint clipping, import without a renderer. |
| `test/render/styles.test.ts` | Mono, theme, palette, original, `lightLift`, fallbacks, quantization, light theme. |

Pack fixtures live in `test/fixtures/packs`. Render test helpers are in
`test/render/fixtures.ts`.

## Example check

The examples must match their declared dimensions. Run this from the repo
root. It works in sh and PowerShell:

```sh
node -e 'const fs=require("fs"),path=require("path");for(const id of ["logo","pulse","rain"]){const dir=path.join("examples",id);const m=JSON.parse(fs.readFileSync(path.join(dir,"art.json"),"utf8"));const files=m.canvas?[m.canvas]:fs.readdirSync(path.join(dir,m.frames)).filter(f=>f.endsWith(".txt")).sort();let ok=true;for(const f of files){const rel=m.canvas?f:path.join(m.frames,f);const lines=fs.readFileSync(path.join(dir,rel),"utf8").split(/\r?\n/);if(lines.at(-1)==="")lines.pop();if(lines.length!==m.rows||lines.some(l=>l.length!==m.cols))ok=false}console.log(id,ok?"ok":"bad")}'
```

Expected output:

```text
logo ok
pulse ok
rain ok
```

## Manual TUI checklist

Run these against a live OpenCode session before a release.

- [ ] Fresh install shows the bundled Fool on the home screen.
- [ ] Opening a session draws nothing; returning home draws art again.
- [ ] Starting directly in a session draws nothing.
- [ ] `/art` lists packs with scope and active markers.
- [ ] The preview starts on frame 0 in the effective style and honors `fit` and `dim`.
- [ ] `Enter` selects a pack and the choice survives a restart.
- [ ] `/` filters packs by id or name; long pack lists scroll in a 12-row window with `↑`/`↓` more indicators.
- [ ] `s` cycles the available styles; unavailable styles fall back with a reason.
- [ ] `d` cycles dimming (0/25/50/75%) and `/art dim <0-80>` persists across restarts.
- [ ] `p` plays/pauses preview animation; `[` and `]` step frames.
- [ ] `Left`/`Right` changes fps and the change persists.
- [ ] `e` toggles art; the home screen clears and returns.
- [ ] `r` re-scans packs and refreshes the preview.
- [ ] `Esc` and `q` close the dialog.
- [ ] Resizing keeps art fitted according to the pack's `fit` mode (`stretch`, `contain`, `cover`, or `center`).
- [ ] `mono`, `theme`, `palette`, and `original` look correct on a truecolor terminal.
- [ ] 256-color and 16-color terminals degrade as documented.
- [ ] `NO_COLOR=1` and `TERM=dumb` produce mono art.
- [ ] Light and dark themes remain readable, including per-cell contrast lift when needed.
- [ ] An invalid pack appears under Problems and does not break the TUI.
- [ ] Editing a pack or `.opencode/art.json` updates the background within a few seconds without a restart.
- [ ] Removing the active pack keeps the last good frames, then falls back safely.
- [ ] A project `.opencode/art.json` wins over global settings.
- [ ] A project `enabled: false` blocks `/art on` with an explanation.
- [ ] `/art validate <path>` reports file and line for every error.
- [ ] `animations: false` shows a still frame and freezes canvas effects.
- [ ] `/art off` drops idle CPU; the renderer does not keep ticking.
- [ ] Leaving home unmounts `ArtLayer` and detaches its `ArtState` subscriber listener.

## CLI tests

`test/cli/cli.test.ts` runs the real binary in a child process. It covers:

- `init` scaffolding, valid output, and preview width.
- `init` refusing a non-empty non-pack directory without `--force`.
- Invalid folder names.
- `validate` printing every error and exiting 1.
- `preview --animate --loops` playback and loop bounds.
- PNG, JPEG, WebP, and GIF bakes, plus `--fit`.
- A deterministic scene baked in a child process, `--seed` / `meta.seed`, and `null` vs `#000000` sidecar resets.
- Running the CLI from inside a `node_modules` directory via `bin/strip-ts.cjs`.
- A bad scene and a hanging scene both exiting 1.
- `-h`, `--` end-of-flags, bad options, and a missing `ffmpeg`.

`test/cli/scene.test.ts` covers the scene helpers: `clamp`, `lerp`, `noise`,
`loadCanvas` dimensions, `drift`/`wave` modular wrapping at large/negative times,
determinism, color travel, and input immutability.

A real video decode with `ffmpeg` installed is not covered by the automated
suite; only the missing-binary path is. A manual bake with a 1-second MP4 and
`ffmpeg` on `PATH` produced a valid 5-frame pack. GIF fixtures live in
`test/fixtures/media`. Other media is generated in a temporary directory during
the test.

## Headless render smoke

The real `ArtRenderable` can be painted on OpenTUI's headless test renderer
with Bun 1.4.4:

```sh
bun run scripts/render-smoke.mjs frames/fool 100 24 original
bun run scripts/render-smoke.mjs frames/fool 80 20 original pause-after
```

The second form checks that pausing clears the cells and sets
`animationFps` to `undefined`. This is the closest check to the live terminal
without opening the TUI.

## Live update smoke

The host maps plugin `solid-js` imports to Solid's SSR build, where signals
never notify, so art updates are pushed through `ArtState.subscribe` instead
of plugin-side effects. Verify the whole path (on/off, style, `setDim(50)`, and
`ArtLayer` unmount listener cleanup on route change) with Bun:

```sh
bun run scripts/live-update-smoke.mjs
```

Expected output has `"painted":true`, `"offCleared":true`, `"restored":true`,
`"styleFgChanged":true`, `"dimChanged":true`, and `"unmountCleaned":true`.
Exit code 1 means a style, dim, on/off, or unmount cleanup check failed.

## CI

`.github/workflows/ci.yml` runs on Ubuntu and Windows with Node 24:

```text
npm ci
npm run typecheck
npm test
```

There are no secrets, deploys, or external services in CI. macOS is not in the
matrix; the plugin has no platform-specific branches.
