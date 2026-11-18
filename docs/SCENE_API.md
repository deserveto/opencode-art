# Scene API

A scene is an ESM module that returns a grid for a given time. The authoring
CLI imports it, bakes fixed timesteps, and writes a normal pack. The plugin
never imports a scene module.

This interface ships with the authoring milestone. The CLI and the helper
entry are included in this repository.

## Contract

```js
export const meta = { fps: 10, cols: 180, rows: 50, loop: 6 }

export function scene(t, ctx) {
  // Return string[] for mono, or { chars, colors } for color.
  return rows
}
```

`meta` is required:

| Field | Required | Meaning |
|---|---|---|
| `fps` | yes | Frames per second to sample. |
| `cols` | yes | Grid width. |
| `rows` | yes | Grid height. |
| `loop` | no | Loop length in seconds. Defaults to `6`. |
| `seed` | no | Default integer seed for `ctx.seed`. Overridden by `--seed`; defaults to `0`. |

The baker samples `t = i / fps` at a fixed step. `t` is in seconds. It bakes
`loop * fps` frames, capped at 600. `loop` is the intended loop length; it is
not a field in the resulting pack.

`ctx` provides:

| Field | Meaning |
|---|---|
| `cols` | Grid width, same as `meta.cols`. |
| `rows` | Grid height, same as `meta.rows`. |
| `frame` | Frame index being baked, starting at 0. |
| `fps` | Sampling rate, same as `meta.fps`. |
| `palette` | Palette passed to the bake, as an array of color strings. |
| `seed` | Integer seed for deterministic variation, from `--seed`, `meta.seed`, or `0`. |
| `helpers` | The helper functions below, for scenes that cannot import `opencode-art/scene`. |

## Return values

Mono:

```js
return ["  ..  ", " .@@. ", "  ..  "]
```

For a mono scene, return an array of exactly `rows` strings, each exactly
`cols` width-1 characters.

Color:

```js
return {
  chars: rows,
  colors: colorRows,
}
```

For a color scene, `chars` is the same array of strings and `colors` is an
array of `rows` arrays. Each cell is a `#rrggbb` string or `null`. `null` means
the default style color (the theme faint color in `original` style, emitted as
a reset in the `.ans` sidecar), while explicit `#000000` is preserved as black.

The returned grid must be exact. The bake fails if a row is short, long, or
contains a wide, combining, or control character. Trailing spaces are cells and
must be present.

## Determinism

A scene must return the same output for the same `t`, `ctx`, and seed.

- Use `ctx.seed` with a seeded helper for randomness.
- Do not use `Math.random()`.
- Do not use `Date.now()`, timers, network access, or environment-dependent
  values.
- Do not depend on the machine, locale, or filesystem iteration order.

Deterministic scenes can be re-baked and diffed, and they do not flicker
between runs. A clean loop still depends on the scene: make the first and last
sampled frames match.

## Isolation

The CLI imports the scene in a child process with:

- a 60 second timeout
- a memory cap
- a separate process, outside the TUI

A crash, a hang, or an invalid return fails the bake and reports the error. It
cannot affect a running TUI. The plugin itself never loads `scene.mjs`,
including when the file sits next to a baked pack. In a pack, `scene.mjs` is
provenance only.

Scene code is executable code. Bake only scenes you trust.

## Helpers

The package's `./scene` entry exports these author-time helpers:

| Helper | Signature and role |
|---|---|
| `clamp` | `clamp(value, min = 0, max = 1)`: bound a number. |
| `lerp` | `lerp(a, b, t)`: interpolate between two numbers. |
| `noise` | `noise(seed)`: return a deterministic `(index) => number` in [0, 1). |
| `palette` | `palette(stops)`: normalize an array of color strings to lowercase. |
| `loadCanvas` | `loadCanvas(text, cols, rows)`: parse exact-dimension text into `{ chars }`; throws on a size mismatch. |
| `wave` | `wave(grid, time, options?)`: shift cells along an axis; options `axis`, `amplitude`, `speed`. |
| `shimmer` | `shimmer(grid, time, options?)`: swap adjacent glyphs; options `seed`, `intensity`. |
| `drift` | `drift(grid, time, options?)`: wrapped scroll; options `axis`, `speed`. |
| `twinkle` | `twinkle(grid, time, options?)`: sparse glyphs blink to spaces; options `seed`, `intensity`, `speed`. |
| `scanline` | `scanline(grid, time, options?)`: a moving band nudges glyphs on the built-in density ramp; options `axis`, `speed`, `intensity`. |

The motion helpers are author-time utilities. They are separate from the
runtime pack effects and use their own defaults, so do not expect identical
pixels from a helper and the effect of the same name. The signatures above
match `src/scene/index.ts`. The CLI entrypoint ships with the authoring
milestone.

## Examples

### Mono wave

This is the worked example from [AUTHORING.md](AUTHORING.md):

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

### Seeded color

A diagonal sparkle field with stable color. The pattern advances one cell per
frame and wraps.

```js
export const meta = { fps: 8, cols: 24, rows: 8, loop: 3 }

export function scene(t, ctx) {
  const chars = []
  const colors = []
  const tick = Math.floor(t * ctx.fps) + ctx.seed
  for (let y = 0; y < ctx.rows; y++) {
    let line = ""
    const row = []
    for (let x = 0; x < ctx.cols; x++) {
      const lit = (x + y + tick) % 7 < 3
      line += lit ? "*" : " "
      row.push(lit ? "#89b4fa" : null)
    }
    chars.push(line)
    colors.push(row)
  }
  return { chars, colors }
}
```

### Static canvas scene

A scene can animate an existing drawing with `loadCanvas`. Read the `.txt`
file yourself, then pass its text with the exact dimensions:

```js
import { loadCanvas } from "opencode-art/scene"

export const meta = { fps: 12, cols: 6, rows: 3, loop: 4 }

export function scene(t, ctx) {
  const text = "  ..  \n .@@. \n  ..  " // replace with readFile(...)
  const base = loadCanvas(text, ctx.cols, ctx.rows)
  return base.chars
}
```

`loadCanvas` throws if the text is not exactly `cols` x `rows`, which makes a
stale canvas fail the bake instead of shifting the grid.

## Bake and validate

Bake and validate a scene:

```sh
opencode-art bake scene.mjs --out ~/.config/opencode/arts/my-scene --cols 40 --rows 12 --fps 10 --seed 1 --fit contain
opencode-art validate ~/.config/opencode/arts/my-scene
opencode-art preview ~/.config/opencode/arts/my-scene --frame 0 --width 80
opencode-art preview ~/.config/opencode/arts/my-scene --width 80 --animate --loops 1
```

The bake writes `frames/*.txt`, optional `frames/*.ans`, and `art.json`, then
validates the output. Add `scene.mjs` to the pack yourself if you want the
source kept as provenance. The plugin never reads it.

If the bake reports an error, fix the scene and run it again. The command does
not report success on invalid output.
