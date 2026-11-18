# Pack format

A pack is a directory. Its folder name is its id. A pack contains `art.json`
and exactly one of:

- `canvas`: a static picture, optionally with effects
- `frames`: an animated sequence

The plugin reads packs as data. Nothing in a pack directory is imported or
executed at runtime.

## Layout

Static canvas:

```text
my-pack/
  art.json
  canvas.txt
  canvas.ans        optional foreground colors
  scene.mjs         optional provenance, never read by the plugin
  README.md         optional
```

Animated frames:

```text
my-pack/
  art.json
  frames/
    000.txt
    000.ans         optional foreground colors
    001.txt
    001.ans
  scene.mjs         optional provenance, never read by the plugin
  README.md         optional
```

Rules:

- The folder name must equal `id` in `art.json`.
- `frames` is a directory of `.txt` files. Lexicographic order is playback
  order. Zero-padded names such as `000.txt` are the convention.
- `scene.mjs` exists for provenance and re-baking. The plugin never imports it,
  never reads it, and never executes it.
- All paths in `art.json` are relative to the pack root. Absolute paths, drive
  letters, `..`, and symlinks that resolve outside the root are rejected.
- The pack data cap counts `art.json`, frame or canvas files, and sidecars.
  Other files in the folder are ignored by the loader.

## Manifest examples

Canvas with effects:

```json
{
  "schemaVersion": 1,
  "id": "logo",
  "name": "Shimmer Mark",
  "description": "A small bordered diamond that sparkles.",
  "author": "sangh",
  "license": "CC-BY-4.0",
  "fps": 10,
  "cols": 40,
  "rows": 12,
  "defaultStyle": "palette",
  "ramp": " .:-=+*#%@",
  "palette": ["#313244", "#89b4fa", "#f5c2e7"],
  "canvas": "canvas.txt",
  "effects": [
    { "type": "shimmer", "intensity": 0.25, "speed": 1, "seed": 7 }
  ]
}
```

Animated frames:

```json
{
  "schemaVersion": 1,
  "id": "rain",
  "name": "Rain",
  "description": "A short loop of falling rain.",
  "author": "sangh",
  "license": "CC-BY-4.0",
  "fps": 8,
  "cols": 24,
  "rows": 8,
  "defaultStyle": "mono",
  "frames": "frames"
}
```

The JSON Schema is [schemas/art.schema.json](../schemas/art.schema.json) and is
also exported as `opencode-art/schema`.

## Fields

| Field | Required | Type | Rules |
|---|---|---|---|
| `schemaVersion` | yes | integer | Exactly `1`. A higher version is rejected with an update message. |
| `id` | yes | string | `^[a-z0-9][a-z0-9_-]{0,31}$`; must equal the folder name. |
| `name` | yes | string | 1-80 printable characters. |
| `description` | no | string | At most 500 printable characters. |
| `author` | no | string | At most 80 printable characters. |
| `license` | no | string | At most 40 characters. Required for packs accepted into this repository. |
| `homepage` | no | string | `https://` URL, at most 200 characters. |
| `fps` | yes | number | 1-30. Playback rate and effect step rate. |
| `cols` | yes | integer | 1-400. Every frame line and canvas line must match. |
| `rows` | yes | integer | 1-200. Frame line count and canvas line count must match. |
| `defaultStyle` | no | enum | `mono`, `theme`, `palette`, or `original`. Default `mono`. |
| `ramp` | no | string | 2-64 unique width-1 glyphs, low to high density. Default ` .:-=+*#%@`. |
| `palette` | no | string[] | 2-32 `#rrggbb` stops, low to high brightness. |
| `frames` | one of | string | Pack-relative directory containing the sequence. |
| `canvas` | one of | string | Pack-relative `.txt` file. |
| `effects` | no | object[] | At most 4. Only valid with `canvas`. |
| `source` | no | object | Provenance metadata. Ignored at runtime; unknown subfields are ignored. |

Unknown top-level fields produce a warning and are ignored. They do not reject
the pack.

`defaultStyle` is only a default. The user setting overrides it globally, and a
project `.opencode/art.json` overrides that. A pack with no `palette` still
accepts `palette` style; it uses the theme stops. The dialog only offers
`palette` for packs that declare a palette.

## Frames and canvas

- Files are UTF-8. A leading BOM is ignored.
- LF and CRLF line endings are accepted.
- One optional trailing newline is stripped.
- Every line must contain exactly `cols` width-1 printable characters.
- Every frame must contain exactly `rows` lines.
- Trailing spaces are meaningful cells and are preserved.
- Tabs, control characters, combining marks, zero-width characters, format
  characters, emoji, and East Asian wide or fullwidth characters are rejected.
- All frames in a pack must have the same dimensions as `cols` x `rows`.
- A pack has 1-600 frames. A canvas pack counts as one frame.
- A frame pack loops after `frameCount / fps` seconds. There is no `loop`
  field for frame packs.
- A canvas without effects is drawn once and stops. A canvas with effects is
  redrawn at `fps`. With OpenCode `animations: false`, a canvas is shown at
  `t = 0` and effects do not run.

The width-1 rule keeps the grid aligned. Box drawing characters are width-1 and
allowed. Emoji and CJK characters are not.

## Effects

Effects only work on a canvas. `effects` with `frames` is a validation error.
Effects are applied in array order and never change the grid dimensions.

| Type | Parameters | Behavior |
|---|---|---|
| `shimmer` | `intensity`, `speed`, `seed` | Sparse glyph sparkle. Cells swap glyphs inside their density bucket. |
| `wave` | `intensity`, `speed`, `axis` | Sine displacement of the grid. Amplitude grows with `intensity`, up to 6 cells. |
| `drift` | `intensity`, `speed`, `axis` | Wrapped scroll. Up to 6 cells per second at full intensity and speed. |
| `twinkle` | `intensity`, `speed`, `seed` | Sparse cells alternate between their glyph and a space. |
| `scanline` | `intensity`, `speed`, `axis` | A moving band, about 8 percent of the axis, dims color cells or lowers glyph density. |

Parameter rules:

| Parameter | Default | Range |
|---|---|---|
| `intensity` | `0.5` | 0-1 |
| `speed` | `1` | 0-4 |
| `seed` | `0` | integer |
| `axis` | `x` | `x` or `y` |

Colors move with their cells for `wave` and `drift`. Effects are deterministic
for the same pack, time, and fps. Missing parameters use the defaults above. An
unknown effect type is a validation error.

## Color sidecars

A `.ans` file adds foreground color to its matching `.txt` file. It contains
the same characters as the `.txt`, with SGR sequences between them.

Allowed sequences:

- `\x1b[38;2;R;G;Bm` truecolor
- `\x1b[38;5;Nm` 256-color
- `\x1b[30m` through `\x1b[37m`, and `\x1b[90m` through `\x1b[97m` basic and
  bright foreground
- `\x1b[0m` and `\x1b[39m` reset

Everything else is stripped with a warning: background colors, cursor
movement, erase, OSC sequences, hyperlinks, and other escapes. Raw escapes are
never passed through to the terminal.

The invariant: strip every SGR sequence from a sidecar line and you get exactly
the matching `.txt` line. The `.txt` is the canonical character data.

Rules:

- Sidecars are optional, but all-or-nothing: if any frame has a `.ans`, every
  frame must have one with the same basename.
- `canvas.ans` is optional on its own; a canvas has only one frame.
- A sidecar has at most 4096 unique colors. The bundled Fool uses 64.
- A cell with no preceding foreground sequence has no sidecar color. In
  `original` style it uses the theme faint color, not black.
- A sidecar whose text does not match its frame, or that exceeds the color cap,
  rejects the pack. Unsupported escape sequences are stripped with a warning.

## Caps

| Resource | Limit |
|---|---|
| `cols` | 1-400 |
| `rows` | 1-200 |
| Frames per pack | 1-600 |
| FPS | 1-30 |
| Pack data (manifest, frames, sidecars) | 20 MB |
| Single frame, canvas, sidecar, or manifest file | 1 MB |
| Palette stops | 2-32 |
| Ramp glyphs | 2-64 |
| Effects per canvas | 4 |
| Unique colors per frame | 4096 |
| `id` length | 1-32 characters |
| `name` / `description` / `author` / `license` | 80 / 500 / 80 / 40 characters |
| `homepage` | 200 characters |

The loader rejects oversized packs with the cap in the message. The authoring
CLI fits and quantizes output before writing, and errors if the result still
exceeds a cap.

## Validation

Discovery checks the manifest and the frame/sidecar stats. Frame contents are
validated when a pack loads. A pack with any error is never partially rendered:
it is listed in the dialog's Problems section and, when selected, the last good
art stays while the error is reported.

Additional checks:

- JSON parse errors report the file and, when available, the line.
- `id` must match the folder name.
- `frames` and `canvas` are mutually exclusive and one is required.
- `effects` with `frames` is an error.
- Every manifest path resolves inside the pack root.
- Symlinks are followed only when the resolved path stays inside the root.
- A duplicate id within one scope is resolved lexicographically; the first
  copy wins and the other is reported.
- Unknown top-level fields warn but do not reject.
- `schemaVersion` greater than 1 rejects the pack with an update message.
- Text is decoded as strict UTF-8. A replacement character is not accepted.

## Common errors

| Message or symptom | Cause | Fix |
|---|---|---|
| `expected 50 rows, found 49` | A frame has the wrong number of lines. | Make every frame exactly `rows` lines. |
| `expected 180 columns, found 179` | A line is short or long. Trailing spaces count. | Pad or trim every line to exactly `cols` characters. |
| `invalid character "…" (U+2026)` | A wide, combining, control, or zero-width glyph. | Use a width-1 printable character. |
| Missing sidecar | Some frames have `.ans` and some do not. | Add the sidecar for every frame, or remove all of them. |
| Sidecar text does not match | The `.ans` characters differ from the `.txt`. | Regenerate the sidecar from the frame text. |
| `exceeds the 1048576-byte cap` | One frame or sidecar is too large. | Reduce `cols`/`rows`, or split the pack. |
| `over the 20971520-byte (20 MB) cap` | The whole pack is too large. | Reduce frames, dimensions, or color count. |
| `pack requires a newer opencode-art` | `schemaVersion` is above 1. | Update the plugin, or lower the version if the pack really uses v1 fields. |
| `id "x" does not match the folder name "y"` | The folder was renamed without the manifest. | Rename the folder or fix `id`. |
| `effects is only valid with canvas` | A frame pack declares effects. | Remove `effects`; motion comes from the frames. |
| `resolves outside the pack root` | An absolute path, drive letter, `..`, or escaping symlink. | Use a path relative to the pack folder. |
| `original` falls back to palette or theme | No sidecars, 16-color terminal, or a failed light-theme contrast check. | Provide sidecars, use a 256-color terminal, or accept the fallback. |

## Bundled Fool

The default pack is `frames/fool`:

| Property | Value |
|---|---|
| Grid | 180 x 50 |
| FPS | 10 |
| Frames | 60 (6 second loop) |
| Colors | 64-color `.ans` sidecars |
| Default style | `mono` |
| License | CC BY 4.0 |

Regenerate it with `scripts/bake-fool.cjs`. The script requires `playwright`
(dev-only, not a package dependency), reads a temporary copy of the source
artwork, and writes `art.json` plus all frames. See
[frames/fool/README.md](../frames/fool/README.md).
