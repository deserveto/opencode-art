---
name: opencode-art
description: Create animated ASCII backgrounds, logos, and banners for the OpenCode home screen as validated opencode-art packs.
---

# opencode-art

Turn a chat request into a pack. The plugin draws packs as data on the home screen only, never executes pack code, and never calls a model. The CLI bakes and validates the pack offline.

## When to use

- The user asks for a background, animated ASCII, home-screen art, a logo, or a banner.
- The user wants an image, GIF, or video turned into terminal art.
- The user wants an existing pack inspected, validated, or fixed.

## Do not use

- Do not edit `frames/fool`, the bundled pack. Copy it to a new id.
- Do not run or bake a `scene.mjs` from a pack you or the user do not trust. Scene files are executable code.
- Do not add model calls to a pack or the plugin. Creation happens in chat; the plugin only renders data.
- Do not fetch art or assets from the network.

## Choose a path

| Path | Pick it when | Result |
|---|---|---|
| `scene.mjs` | You need procedural motion: rain, waves, stars, parallax, a living skyline. | Baked frames |
| Frame sequence | You hand-draw frames or another tool emits a sequence. | Frame pack |
| Static canvas + effects | One picture should move a little, at the lowest CPU cost. | Canvas pack |
| Media conversion | The user has a PNG, JPEG, WebP, GIF, or video. | Canvas or frame pack |

**Scene (golden path).** Write a deterministic ESM module, then bake it. A 60 x 20 scene bakes in seconds and is easy to iterate. Use this unless the user already has art.

**Frame sequence.** Write `frames/000.txt`, `001.txt`, ... in lexicographic playback order. Every frame must be exactly `cols` x `rows`, and all frames must match. Do not add `effects` to a frame pack.

**Static canvas + effects.** Write one `canvas.txt` and list up to four effects in `art.json`. Without effects the canvas is drawn once and stops. With effects it is redrawn at `fps`. This is the smallest and lowest-CPU option.

**Media conversion.** `bake` reads PNG, JPEG, and WebP as a static canvas, and GIF or video as frames. An image output has no effects; add them to `art.json` afterward. Video needs `ffmpeg` on `PATH`.

## Pack layout

A pack is a directory. The folder name is the `id`.

```text
rainy-city/
  art.json
  frames/000.txt, 001.txt, ...   plus optional .ans sidecars
  canvas.txt, canvas.ans         canvas packs use these instead of frames
  scene.mjs, README.md           provenance and notes, never loaded
```

Rules:

- Exactly one of `frames` or `canvas`.
- `id` must equal the folder name and match `^[a-z0-9][a-z0-9_-]{0,31}$`.
- Manifest paths are relative to the pack root. Absolute paths, drive letters, `..`, and symlinks that escape the root are rejected.
- `.ans` sidecars are all-or-nothing: if one frame has one, every frame needs one. The `.txt` is canonical; stripping all SGR sequences from the `.ans` must produce it exactly.
- `scene.mjs` is provenance for re-baking. The plugin never reads it.

An animated manifest:

```json
{
  "schemaVersion": 1,
  "id": "rainy-city",
  "name": "Rainy City",
  "fps": 12,
  "cols": 60,
  "rows": 20,
  "defaultStyle": "mono",
  "ramp": " .:-=+*#%@",
  "frames": "frames",
  "source": { "type": "scene", "file": "scene.mjs" }
}
```

For a canvas pack, replace `frames` with `"canvas": "canvas.txt"` and add `effects`.

## Fields and caps

| Field | Required | Rule or cap |
|---|---|---|
| `schemaVersion` | yes | `1`; a higher version is rejected with an update message |
| `id` | yes | `^[a-z0-9][a-z0-9_-]{0,31}$`, equal to the folder name |
| `name` | yes | 1-80 printable characters |
| `description`, `author`, `license` | no | 500 / 80 / 40 characters; description and author must be printable; license is required for the public repo |
| `homepage` | no | `https://` URL, up to 200 characters |
| `fps` | yes | 1-30 |
| `cols`, `rows` | yes | 1-400 and 1-200; every line and frame must match exactly |
| `defaultStyle` | no | `mono`, `theme`, `palette`, or `original`; default `mono` |
| `ramp` | no | 2-64 unique width-1 glyphs, low to high density; default ` .:-=+*#%@` |
| `palette` | no | 2-32 `#rrggbb` stops, low to high brightness |
| `frames`, `canvas` | one of | relative paths; exactly one; 1-600 frames |
| `effects` | no | up to 4; canvas only; `shimmer`, `wave`, `drift`, `twinkle`, `scanline` |
| `source` | no | provenance object, ignored at runtime |
| Pack cap | | 20 MB total, 1 MB per file, 4096 unique colors per frame |

The bundled Fool is 180 x 50, 10 fps, 60 frames (6 second loop), ramp ` .:;-~=+*x%#w@&W`, default style `mono`, 64-color `.ans` sidecars, CC BY 4.0. Never edit it; copy it to a new id.

## CLI

```sh
node bin/opencode-art.cjs init <dir> [--force]
node bin/opencode-art.cjs bake <input> --out <dir> [--cols 180] [--rows 50] [--fps 10] [--loop 6] [--charset " .:-=+*#%@"] [--ramp ...] [--palette "#111,#eee"] [--colors 64] [--dither] [--mono] [--invert] [--aspect 0.5] [--force]
node bin/opencode-art.cjs validate <dir>
node bin/opencode-art.cjs preview <dir> [--frame N] [--width N]
node bin/opencode-art.cjs help
```

When the package is installed, `opencode-art` is usually on `PATH`; use it in place of `node bin/opencode-art.cjs`. If it is not, use `node <repo-or-plugin>/bin/opencode-art.cjs`.

- `--charset` and `--ramp` are aliases. `--loop` is seconds for scene, GIF, and video input.
- `--aspect 0.5` compensates for terminal cells being about twice as tall as wide.
- Exit codes: `0` success, `1` validation or user error, `2` unexpected failure.
- Video input needs `ffmpeg` on `PATH`.

## Scene API

```js
export const meta = { fps: 10, cols: 180, rows: 50, loop: 6 }

export function scene(t, ctx) {
  // Return string[] for mono, or { chars, colors } for color.
  return rows
}
```

- `t` is seconds, sampled at `frame / fps`; `ctx` is `{ cols, rows, frame, fps, palette, seed }`.
- `meta` requires `fps`, `cols`, and `rows`; `loop` defaults to `6`.
- Return `string[]` (exactly `rows` strings of exactly `cols` width-1 chars) or `{ chars, colors }` (`colors` is `rows` arrays of `#rrggbb` or `null`; `null` uses the style color). Trailing spaces are real cells, so keep every row at full width.
- Use `ctx.seed` for variation. Do not use `Math.random()`, `Date.now()`, timers, locale, or filesystem order. The bake uses fixed steps, so a deterministic scene re-bakes and loops identically.
- Use width-1 characters only: ASCII, box drawing, block elements. No emoji, CJK, combining marks, tabs, or control characters.
- Helpers are exported from `opencode-art/scene`: `loadCanvas`, `wave`, `shimmer`, `drift`, `twinkle`, `scanline`, `palette`, `noise`, `clamp`, `lerp`. The example below is import-free so it bakes with any CLI build.
- The CLI imports the scene in a child process with a timeout and memory cap. The plugin never loads a scene module, including `scene.mjs` inside a pack. Bake only scenes you trust.

## Workflow

Ask only for what is missing: size, fps, color, and project or user scope. Then run these steps in order.

```sh
ARTS=~/.config/opencode/arts   # PowerShell: $ARTS = "$HOME/.config/opencode/arts"

opencode-art init "$ARTS/rainy-city"
# write scene.mjs, canvas.txt, or frames/*.txt
opencode-art bake "$ARTS/rainy-city/scene.mjs" --out "$ARTS/rainy-city" --cols 60 --rows 20 --fps 12 --loop 4
opencode-art validate "$ARTS/rainy-city"
opencode-art preview "$ARTS/rainy-city" --frame 0 --width 60
```

Then tell the user `/art set rainy-city`. The watcher usually reloads the active pack on its own; `/art reload` forces a rescan. Use `--force` only when the user has agreed to replace an existing pack, and add it if `bake` refuses an initialized directory.

## Worked example: rainy city

Save this as `scene.mjs`. It draws a skyline, lit windows, a moon, rain, and wet-street puddles at 60 x 20, 12 fps, with a 4 second loop. The rain makes exactly one pass per loop, so frame 0 and the frame at `t = 4` match.

```js
export const meta = { fps: 12, cols: 60, rows: 20, loop: 4 }

const TOWERS = [
  [0, 8, 6], [8, 6, 9], [14, 9, 5], [23, 7, 8],
  [30, 10, 11], [40, 5, 6], [45, 8, 9], [53, 7, 5],
]

function hash(n) {
  n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  n ^= n >>> 13
  n = Math.imul(n, 0xc2b2ae35)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

export function scene(t, ctx) {
  const W = ctx.cols, H = ctx.rows, ground = H - 5
  const grid = Array.from({ length: H }, () => Array(W).fill(" "))
  const put = (x, y, ch) => {
    if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = ch
  }
  // Moon and puddles.
  const moon = ["  .  ", " (O) ", "  '  "]
  moon.forEach((row, y) => [...row].forEach((ch, x) => put(47 + x, 1 + y, ch)))
  for (let x = 2; x < W; x += 5) {
    if (hash(ctx.seed * 43 + x * 91) > 0.6) put(x, ground + 2 + (x % 2), "~")
  }

  // Skyline with lit and dark windows.
  for (const [x0, w, h] of TOWERS) {
    const top = ground - h, right = x0 + w - 1
    for (let y = top; y < ground; y++) {
      for (let x = x0; x < right; x++) put(x, y, "#")
    }
    for (let y = top + 2; y < ground - 1; y += 2) {
      for (let x = x0 + 2; x < right - 1; x += 3) {
        const r = hash(ctx.seed * 131 + x * 17 + y * 29)
        if (r > 0.64) put(x, y, "o")
        else if (r > 0.5) put(x, y, ":")
      }
    }
  }

  // Curb.
  for (let x = 0; x < W; x++) put(x, ground, "=")

  // Rain. One screen per loop, so frame 0 and the frame at t=4 match.
  const speed = H / meta.loop
  for (let x = 0; x < W; x += 2) {
    for (let k = 0; k < 2; k++) {
      const phase = hash(ctx.seed * 977 + x * 131 + k * 37)
      put(x, Math.floor((phase * H + t * speed) % H), "|")
    }
  }

  return grid.map((row) => row.join(""))
}
```

Bake, validate, and preview it:

```sh
ARTS=~/.config/opencode/arts
opencode-art init "$ARTS/rainy-city"
# save the scene above as "$ARTS/rainy-city/scene.mjs"
opencode-art bake "$ARTS/rainy-city/scene.mjs" --out "$ARTS/rainy-city" --cols 60 --rows 20 --fps 12 --loop 4
opencode-art validate "$ARTS/rainy-city"
opencode-art preview "$ARTS/rainy-city" --frame 0 --width 60
```

Then run `/art set rainy-city` or wait for the watcher.

## Arts paths and settings

| Layer | Path | Precedence |
|---|---|---|
| Project art | `<project>/.opencode/arts/<id>/` | highest |
| User art | `~/.config/opencode/arts/<id>/` | middle |
| Bundled art | `<plugin>/frames/<id>/` | lowest, read-only |
| Project settings | `<project>/.opencode/art.json` | overrides global |
| Global settings | OpenCode storage, not a pack file | overrides pack defaults |

The effective style and fps come from project settings, then global settings, then the pack's `defaultStyle` and `fps`, then plugin defaults (`enabled: true`, style `mono`, fps `10`). The same id in a higher scope wins. Use project art for repo-specific art and user art for personal art.

## Common failures

| Symptom or message | Cause | Fix |
|---|---|---|
| `expected 20 rows` or `expected 60 columns` | A frame has too few lines, or a line is short or long; trailing spaces count. | Make every frame exactly `rows` lines of exactly `cols` characters. |
| `invalid character "..."` | Emoji, CJK, combining mark, tab, or control character. | Use width-1 ASCII, box drawing, or block characters. |
| Missing or mismatched sidecar | Some frames lack `.ans`, or the sidecar text differs from the `.txt`. | Add all or none; regenerate each sidecar from the frame text. |
| `exceeds the 1048576-byte cap` or `over the 20971520-byte cap` | A file is over 1 MB, or the pack is over 20 MB. | Reduce dimensions, frames, or colors; split the pack. |
| `pack requires a newer opencode-art` | `schemaVersion` is above 1. | Update the plugin, or use v1 fields. |
| `id "x" does not match the folder name "y"` | The folder was renamed. | Rename the folder or fix `id`. |
| `effects is only valid with canvas` | A frame pack declares effects. | Remove `effects`; motion must be baked into frames. |
| `resolves outside the pack root` | Absolute path, drive letter, `..`, or an escaping symlink. | Use a path relative to the pack folder. |
| `original` falls back to `palette` | No sidecars, a 16-color terminal, or a contrast check failed. | Add sidecars, use `theme` or `mono`, or accept the fallback. |
| Changes do not appear | The new pack is invalid, so the last good frames stay. | Run `opencode-art validate <dir>` or `/art validate <id>`. |

## Safety and etiquette

- Ask before overwriting a non-empty pack directory. `init --force` and `bake --force` are destructive.
- Never edit `frames/fool`. Copy it to a new id if the user wants a starting point.
- Never execute a scene from an untrusted pack. The plugin does not run scene code; neither should you.
- Prefer `<project>/.opencode/arts/` for repo-specific art and the user arts directory for personal art.
