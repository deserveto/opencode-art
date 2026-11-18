# Scene API

A scene is an ESM module that returns a grid for a given time. The authoring
CLI imports it, bakes fixed timesteps, and writes a normal pack. The plugin
never imports a scene module.

This interface ships with the authoring milestone. The current pre-release
build does not include the CLI yet.

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

The baker samples `t = i / fps` at a fixed step. `t` is in seconds. `loop` is
the intended loop length; it is not a field in the resulting pack.

`ctx` provides:

| Field | Meaning |
|---|---|
| `cols` | Grid width, same as `meta.cols`. |
| `rows` | Grid height, same as `meta.rows`. |
| `frame` | Frame index being baked, starting at 0. |
| `fps` | Sampling rate, same as `meta.fps`. |
| `palette` | Palette passed to the bake, or the default. |
| `seed` | Integer seed for deterministic variation. |

## Return values

Mono:

```js
return ["  ..  ", " .@@. ", "  ..  "]
```

`chars` is an array of `rows` strings, each exactly `cols` width-1 characters.

Color:

```js
return {
  chars: rows,
  colors: colorRows,
}
```

`colors` is an array of `rows` arrays. Each cell is a `#rrggbb` string or
`null`. `null` means the default style color.

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

Deterministic scenes can be re-baked and diffed. They also loop correctly and
do not flicker between runs.

## Isolation

The CLI imports the scene in a child process with:

- a 60 second timeout
- a memory cap
- no access to the plugin's runtime

A crash, a hang, or an invalid return fails the bake and reports the error. It
cannot affect a running TUI. The plugin itself never loads `scene.mjs`,
including when the file sits next to a baked pack. In a pack, `scene.mjs` is
provenance only.

Scene code is executable code. Bake only scenes you trust.

## Helpers

The package's `./scene` entry exports these helpers for scenes:

| Helper | Role |
|---|---|
| `loadCanvas` | Load a `.txt` canvas into rows so a scene can animate an existing drawing. |
| `wave` | Apply the same sine displacement model as the `wave` pack effect. |
| `shimmer` | Apply the same deterministic sparkle model as the `shimmer` effect. |
| `drift` | Apply the same wrapped scroll model as the `drift` effect. |
| `twinkle` | Apply the same sparse fade model as the `twinkle` effect. |
| `scanline` | Apply the same moving band model as the `scanline` effect. |
| `palette` | Build a color ramp from palette stops. |
| `noise` | Deterministic noise from a numeric seed. |
| `clamp` | Bound a number to a minimum and maximum. |
| `lerp` | Interpolate between two numbers. |

The helpers share the pack effects' deterministic math, so a baked scene and a
canvas with the same effect look consistent. The exact argument shapes are
fixed with the CLI in the authoring milestone.

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

A scene can animate an existing drawing with `loadCanvas`. The helper loads a
`.txt` canvas from the pack being baked and returns rows in the same shape a
scene returns, so the scene can shift or decorate them. Its exact argument
shape is fixed with the CLI in the authoring milestone.

## Bake and validate

Once the CLI ships:

```sh
opencode-art bake scene.mjs --out ~/.config/opencode/arts/my-scene --cols 40 --rows 12 --fps 10
opencode-art validate ~/.config/opencode/arts/my-scene
opencode-art preview ~/.config/opencode/arts/my-scene --frame 0 --width 80
```

The bake writes `frames/*.txt`, optional `frames/*.ans`, and `art.json`, then
validates the output. Add `scene.mjs` to the pack yourself if you want the
source kept as provenance. The plugin never reads it.

If the bake reports an error, fix the scene and run it again. A failed bake
does not change the existing pack unless `--force` overwrote it.
