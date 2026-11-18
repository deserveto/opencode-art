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
| `test/commands.test.ts` | `/art` argument parsing, case folding, missing arguments, unknown names. |
| `test/plugin.test.ts` | Pack selection, project overrides, fallback, persistence, reload behavior. |
| `test/settings.test.ts` | Field-by-field settings validation, newer versions, precedence, failed global writes. |
| `test/watch.test.ts` | Poll signatures, content changes, debounced reload, clean stop. |
| `test/art/manifest.test.ts` | Required fields, caps, id/folder match, effects, unknown fields. |
| `test/art/grid.test.ts` | Line endings, trailing spaces, dimensions, width-1 glyph rejection. |
| `test/art/load.test.ts` | Frame ordering, sidecar loading, pack caps, UTF-8, symlinks. |
| `test/art/discover.test.ts` | Scope precedence, duplicates, invalid packs, lazy discovery. |
| `test/art/sidecar.test.ts` | SGR allowlist, strip invariant, warnings, color cap. |
| `test/art/paths.test.ts` | Path escapes, absolute paths, drive letters, symlink containment. |
| `test/integration/fool.test.ts` | The bundled Fool loads with 60 frames and color. |
| `test/cli/cli.test.ts` | The real CLI binary: init, validate, preview, image and GIF bakes, scenes, timeouts, bad options, and a missing `ffmpeg`. |
| `test/cli/scene.test.ts` | Scene helpers: dimensions, color travel, determinism, and input immutability. |
| `test/render/brightness.test.ts` | Ramp rank, density table, out-of-bounds cells. |
| `test/render/capabilities.test.ts` | Host capabilities, environment fallback, `NO_COLOR`, `TERM=dumb`. |
| `test/render/colors.test.ts` | Hex parsing, xterm 256 mapping, 16/256 quantization, contrast. |
| `test/render/effects.test.ts` | Determinism, dimensions, color travel, composition, `t = 0`, degenerate input. |
| `test/render/fit.test.ts` | Nearest-neighbor fit, character/color alignment, trailing spaces, empty grids. |
| `test/render/index.test.ts` | The render barrel exposes the public API. |
| `test/render/player.test.ts` | Frame accumulation, skipped frames, wrap, static canvas, `animations: false`. |
| `test/render/renderable.test.ts` | Display frame selection, canvas effects, paint clipping, import without a renderer. |
| `test/render/styles.test.ts` | Mono, theme, palette, original, fallbacks, quantization, light theme. |

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
- [ ] The preview is a still frame in the effective style.
- [ ] `Enter` selects a pack and the choice survives a restart.
- [ ] `s` cycles the available styles; unavailable styles fall back with a reason.
- [ ] `Left`/`Right` changes fps and the change persists.
- [ ] `e` toggles art; the home screen clears and returns.
- [ ] `r` re-scans packs and refreshes the preview.
- [ ] `Esc` and `q` close the dialog.
- [ ] Resizing keeps art edge to edge without cropping.
- [ ] `mono`, `theme`, `palette`, and `original` look correct on a truecolor terminal.
- [ ] 256-color and 16-color terminals degrade as documented.
- [ ] `NO_COLOR=1` and `TERM=dumb` produce mono art.
- [ ] Light and dark themes remain readable.
- [ ] An invalid pack appears under Problems and does not break the TUI.
- [ ] Editing a pack updates the background within a few seconds without a restart.
- [ ] Removing the active pack keeps the last good frames, then falls back safely.
- [ ] A project `.opencode/art.json` wins over global settings.
- [ ] A project `enabled: false` blocks `/art on` with an explanation.
- [ ] `/art validate <path>` reports file and line for every error.
- [ ] `animations: false` shows a still frame and freezes canvas effects.
- [ ] `/art off` drops idle CPU; the renderer does not keep ticking.

## CLI tests

`test/cli/cli.test.ts` runs the real binary in a child process. It covers:

- `init` scaffolding, valid output, and preview width.
- `init` refusing a non-empty non-pack directory without `--force`.
- Invalid folder names.
- `validate` printing every error and exiting 1.
- PNG, JPEG, WebP, and GIF bakes.
- A deterministic scene baked in a child process.
- A bad scene and a hanging scene both exiting 1.
- Bad options and a missing `ffmpeg`.

A real video decode with `ffmpeg` installed is not covered; only the
missing-binary path is. GIF fixtures live in `test/fixtures/media`. Other media
is generated in a temporary directory during the test.

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

## CI

`.github/workflows/ci.yml` runs on Ubuntu and Windows with Node 24:

```text
npm ci
npm run typecheck
npm test
```

There are no secrets, deploys, or external services in CI. macOS is not in the
matrix; the plugin has no platform-specific branches.
