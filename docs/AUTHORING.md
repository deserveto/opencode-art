# Authoring

The golden path is a short prompt to a procedural scene:

1. Ask the agent in chat for a background.
2. The agent writes a deterministic `scene.mjs`.
3. The authoring CLI bakes it into a pack.
4. The watcher reloads the active pack without a restart.
5. `/art set <id>` selects it if another pack was active.

The plugin never calls a model and never runs scene code. The agent uses the
conversation model that is already configured in OpenCode. Scene modules run
only inside the authoring CLI, on the author's machine.

## Availability

The `opencode-art` CLI is an author-time tool. It ships with the authoring
milestone and is included in this repository. It needs Node 22.18 or newer.
`bin/opencode-art.cjs` registers a Node TypeScript-stripping hook
([strip-ts.cjs](../bin/strip-ts.cjs)) so the CLI works even when installed
inside `node_modules`. The plugin never imports it and never runs scene code.

You can also create a pack without the CLI:

- Ask the agent to write `art.json`, `canvas.txt`, or `frames/*.txt` directly.
- Copy an example and edit it by hand.

Everything the CLI writes is a normal pack. You can always build a pack by
hand from [PACKS.md](PACKS.md).

## Four authoring paths

| Input | Output | Best for |
|---|---|---|
| Hand-written text | `frames/*.txt` | Pixel art, logo frames, anything you can draw in a text editor. |
| Static canvas plus effects | `canvas.txt` plus `effects` | A still image that should move. Lowest CPU. |
| Image, GIF, or video | Canvas or frames, via `bake` | Converting existing artwork. |
| JavaScript scene | Frames, via `bake` | Procedural motion, generative backgrounds, the golden path. |

Image input produces a static canvas with no effects. Add effects to
`art.json` afterward if you want motion. GIF, video, and scene input produce a
frame sequence.

## Quick start by hand

1. Create a folder in the user arts directory. The folder name is the id:

   ```text
   ~/.config/opencode/arts/my-pack/
   ```

2. Write `canvas.txt` at exactly the size declared in `art.json`.
3. Write `art.json` with a matching `id`, `cols`, and `rows`.
4. Run `/art reload`.
5. Run `/art validate my-pack` or `/art validate ~/.config/opencode/arts/my-pack`.
6. Run `/art set my-pack`, or select it in `/art`.

Start from [examples/pulse](../examples/pulse) for a canvas or
[examples/rain](../examples/rain) for frames.

## Authoring loop with the CLI

These commands ship with the authoring milestone.

```sh
opencode-art init ~/.config/opencode/arts/my-pack
# write scene.mjs or canvas.txt
opencode-art bake scene.mjs --out ~/.config/opencode/arts/my-pack
opencode-art validate ~/.config/opencode/arts/my-pack
opencode-art preview ~/.config/opencode/arts/my-pack --frame 0 --width 80
```

Then run `/art reload` if the watcher has not already picked up the change.

### `init <dir>`

Scaffolds `art.json`, a 40 x 10 `canvas.txt`, and a short README. It refuses a
non-empty directory, including an existing pack, unless `--force` is passed.
With `--force` it replaces the scaffold files and removes any old `frames/`
directory or `canvas.ans` so the result is a clean canvas pack.

### `bake <input> --out <dir>`

Bakes an image, GIF, video, or `.mjs`/`.js` scene into a pack. Supported image
input is PNG, JPEG, and WebP. Animated GIF and video produce frames. A scene
module produces frames.

| Option | Meaning | Default |
|---|---|---|
| `--cols` | Output width, 1-400. | `180` |
| `--rows` | Output height, 1-200. | `50` |
| `--fps` | Frames per second, 1-30. | `10` |
| `--loop` | Seconds for scene, video, or GIF input. | `6` |
| `--charset` or `--ramp` | 2-64 unique width-1 glyphs, low to high density. | ` .:-=+*#%@` |
| `--palette` | 2-32 comma-separated hex stops for color output. | none |
| `--colors` | Quantize to this many colors, 2-256. | `64` |
| `--dither` | Floyd-Steinberg dithering. Implies a mono pack and conflicts with `--palette`. | off |
| `--mono` | Force a mono pack with no color sidecars. Conflicts with `--palette`. | off |
| `--invert` | Invert luminance. | off |
| `--aspect` | Sample aspect ratio. Terminal cells are about twice as tall as wide. | `0.5` |
| `--fit` | Fit mode written to `art.json`: `stretch`, `contain`, `cover`, or `center`. | omitted (`stretch` at runtime) |
| `--seed` | Integer seed passed to scene `ctx.seed`. | `0` (or `meta.seed`) |
| `--timeout` | Scene timeout in seconds. | `60` |
| `--force` | Bypass the output-directory safety check. | off |

Behavior:

- Output is validated before the command reports success.
- No network access and no telemetry.
- Image decoders are pure JavaScript, with no native modules.
- Video input needs `ffmpeg` on `PATH`. A missing binary is a clear error.
- For a scene, a flag overrides the matching `meta` value. Without the flag,
  `meta` wins.
- Baking into an existing pack folder with the same id replaces its frame or
  canvas files and rewrites `art.json`. Use a new folder or a backup if you
  want to keep the old pack.
- `--force` bypasses the output-directory check. Without it, only an empty
  directory or an existing pack with the matching id is accepted.
- The output pack is ordinary data. If `scene.mjs` is kept in the pack, it is
  provenance and is never imported by the plugin.

### `validate <dir>`

Validates a pack and prints errors with file and line (up to 100, then a
count). Exit code 1 on failure. This is the same validation the loader uses.

### `preview <dir> [--frame N] [--width N] [--animate] [--loops N]`

Prints a downscaled preview to stdout using the pack's `fit` mode (`stretch` by
default). Without `--animate`, it prints a single still frame (default `--frame
0`, clamped to the last frame). Pass `--animate` to play all frames at the
pack's `fps`, and `--loops N` (1-20, default `1`) to repeat the loop. The
default width is 80. Use it to check dimensions, framing, and density before
opening the TUI.

### `help`

Prints usage.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Validation error or user error. |
| `2` | Unexpected failure. |

## Worked scene

A scene is an ESM module with deterministic output. This one draws a moving
sine band at 40 x 12, in mono, and loops every 2 seconds.

```js
export const meta = { fps: 10, cols: 40, rows: 12, loop: 2 }

const ramp = " .:-=+*#%@"

export function scene(t, ctx) {
  const rows = []
  for (let y = 0; y < ctx.rows; y++) {
    let line = ""
    for (let x = 0; x < ctx.cols; x++) {
      const wave = 0.5 + 0.5 * Math.sin((x / ctx.cols) * Math.PI * 2 + t * Math.PI)
      const distance = Math.abs(y / (ctx.rows - 1) - wave)
      const level = Math.max(0, 1 - distance * 2)
      line += ramp[Math.min(ramp.length - 1, Math.floor(level * ramp.length))]
    }
    rows.push(line)
  }
  return rows
}
```

Save it as `scene.mjs`, then bake it:

```sh
opencode-art bake scene.mjs --out ~/.config/opencode/arts/wave --cols 40 --rows 12 --fps 10
```

The same function can return color:

```js
return {
  chars: rows,
  colors: rows.map((line) =>
    [...line].map((char) => (char === " " ? null : "#89b4fa"))
  ),
}
```

`chars` must contain exactly `ctx.rows` strings of exactly `ctx.cols` width-1
characters. `colors` is optional. `null` means the default style color.

Scene rules:

- Use `t` in seconds and `ctx.seed` for randomness (`--seed` overrides `meta.seed`, defaulting to `0`).
- Do not use `Math.random()` or `Date.now()`. The bake uses fixed timesteps.
- `meta` is required, with `fps`, `cols`, and `rows`. `loop` defaults to 6, and `seed` is optional.
- The CLI imports the scene in a child process with a 60 second timeout and a
  memory cap. A crash or hang fails the bake, not the plugin.

Full contract and helpers: [SCENE_API.md](SCENE_API.md).

## Canvas packs and effects

A canvas is one picture. Motion comes from `effects` in `art.json`:

```json
{
  "schemaVersion": 1,
  "id": "pulse",
  "name": "Pulse",
  "fps": 12,
  "cols": 40,
  "rows": 12,
  "defaultStyle": "mono",
  "canvas": "canvas.txt",
  "effects": [
    { "type": "wave", "intensity": 0.3, "speed": 1, "axis": "x" }
  ]
}
```

Effects compose in array order, never change dimensions, and move colors with
their cells. Four effects are allowed per canvas. A canvas without effects is
drawn once and stops. See [PACKS.md](PACKS.md#effects) for parameters.

Tips:

- Use an even cell distribution. A canvas with one glyph per column and large
  empty areas looks sparse after `wave` shifts it.
- `shimmer` and `twinkle` use `seed`; choose one so the pattern is stable.
- `drift` and `wave` are resolution-independent because effects run at display
  size.
- Keep the `ramp` ordered low to high density. `.:-~=+*#%@` is a good start.
- A palette of 3-5 stops is enough for readable art. More stops do not add
  detail after terminal quantization.

## Palettes and ramps

- `ramp` must contain 2-64 unique width-1 glyphs. Order it from empty to dense.
- `palette` must contain 2-32 `#rrggbb` colors, ordered low to high brightness.
- `palette` style maps a cell's brightness to the nearest palette stop. It does
  not interpolate, so keep stops visually distinct.
- `original` ignores the ramp for color and uses sidecar RGB per cell.
- Without a `palette`, `palette` style uses the active theme stops. The art
  still follows light and dark mode.

## Sidecars

A `.ans` sidecar adds foreground color. It contains the same characters as its
`.txt` companion, with SGR sequences between them.

- Color all or none of the frames. A partial set is rejected.
- Keep the `.txt` canonical. The sidecar must strip exactly to it.
- Only foreground color is allowed. Background color, cursor movement, erase,
  OSC, and hyperlinks are stripped with a warning.
- At most 4096 unique colors per frame.
- The bundled Fool uses truecolor SGR quantized to 64 stops so the pack stays
  small.

Example sidecar line:

```text
\x1b[38;2;137;180;250m/\x1b[0m\x1b[38;2;245;194;231m@\x1b[0m
```

The matching `.txt` line is `/@`.

## The agent skill and `/art create` TUI

The package's server part registers the `opencode-art` skill from
[skills/opencode-art/SKILL.md](../skills/opencode-art/SKILL.md). The skill
teaches the pack format, the scene API, the authoring loop, the arts paths, and
the common failures.

Run `/art create` (or press `c` inside `/art`) to open the single-screen creation
TUI:

| Command | Behavior |
|---|---|
| `/art create` | Open the creation TUI in `auto` mode. |
| `/art create <path>` | Open the creation TUI prefilled with an image, GIF, video, or `.mjs` file path. |
| `/art create scene [idea]` | Open the creation TUI in `scene` mode (optional idea prefilled). |
| `/art create logo [idea]` | Open the creation TUI in `logo` mode (optional idea prefilled). |
| `/art create image\|gif\|video` | Open the creation TUI preset to that media mode. |

How the creation TUI executes when you press `Enter`:

1. **Direct CLI Bake (Media & `.mjs` files — 0 LLM tokens)**
   When `Source` is a valid file path (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`,
   `.mp4`, `.mov`, `.webm`, or `.mjs`), the TUI spawns `opencode-art bake` in a
   background child process, applies your chosen `Style`, `Fit`, `Effect`, and
   optional `.opencode/art.json` pin (`Pin Git: yes`), reloads packs, and
   activates the new background immediately.
2. **Compact 2-Line Chat Prompt (AI `scene` / `logo`)**
   When `Source` is a text description, the TUI closes and inserts a ready-to-send
   2-line prompt into the chat composer with no `[...]` placeholders:

   ```text
   Create an opencode-art scene pack "cyberpunk-rainy-street" in "/home/user/.config/opencode/arts/cyberpunk-rainy-street" (180x50, 12 fps, 4s loop, style: palette, fit: cover). Init, write deterministic scene.mjs, bake, validate, preview, and tell me /art set cyberpunk-rainy-street.
   Scene: cyberpunk rainy street with neon signs and puddle reflections
   ```

The agent can create the pack directly. With the CLI, it can also
`init`, write `scene.mjs`, `bake`, `validate`, and `preview` in a loop until the
art is good.

Safety rules for the agent and for you:

- Never edit the bundled Fool pack. Copy it if you want a starting point.
- Never run scene code from a pack you do not trust. The plugin does not, and
  neither should your shell.
- Ask before overwriting an existing pack directory.

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Wrong dimensions | A line lost a trailing space, or a frame has fewer lines. | Use an editor with a ruler; confirm every line is exactly `cols` and every frame exactly `rows`. |
| Wide or combining glyphs | Emoji, CJK, accented combining sequences, zero-width characters. | Use width-1 ASCII, box drawing, or block characters. |
| Tabs or control characters | Pasted text contains `\t` or ANSI escapes in the `.txt`. | Expand tabs to spaces and strip control characters. Escapes belong only in `.ans`. |
| Missing or partial sidecars | Some frames have `.ans`, some do not. | Add a sidecar for every frame, or remove all of them. |
| Sidecar does not match | The `.ans` text differs from the `.txt`. | Regenerate the sidecar from the frame text. |
| Frame or pack too large | A frame is over 1 MB, or the pack is over 20 MB. | Lower `cols`/`rows`, reduce frames, or quantize colors. |
| Unknown future `schemaVersion` | The pack was written for a newer plugin. | Update opencode-art. |
| `id` does not match the folder | The folder was renamed. | Rename the folder or change `id`. |
| Effects on a frame pack | `effects` is set with `frames`. | Remove `effects`; motion must be baked into frames. |
| Path escape | An absolute path, drive letter, `..`, or a symlink leaves the pack root. | Use a path relative to the pack folder. |
| Style not available | No color, no sidecars, or a 16-color terminal. | Use `theme` or `mono`, add sidecars, or use a 256-color terminal. |
| Art is slow | Large grid, high fps, or `original` style. | Lower fps, reduce size, or use `palette`/`theme`. |
| Changes do not appear | The new pack is invalid. | Run `/art validate <id>`; the last good frames stay on screen while the pack is invalid. |
| `/art on` has no effect | The project file sets `enabled: false`. | Edit `<project>/.opencode/art.json`. |
