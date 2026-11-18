# Compatibility

## Target versions

| Component | Version |
|---|---|
| OpenCode | 2.3.2 |
| OpenTUI | 0.8.4 |
| OpenCode runtime | Bun 1.4.4 (bundled) |
| Node for tooling and the CLI | 22.18 or newer; CI uses 24 |
| TypeScript | 5.9 or newer for development |

The plugin uses the host's copies of `@opentui/core`, `@opentui/solid`,
`solid-js`, `effect`, and `@opencode/plugin`. It does not bundle them. They are
optional peer dependencies for package managers that want the hint.

OpenTUI 0.9.x is not the compatibility target. Do not use 0.9-only APIs in this
plugin while it targets OpenCode 2.3.2.

## Placement

Art is an absolute custom renderable at the `app` slot with `zIndex -1`. It
fills the terminal from the top-left corner and paints behind host content.

- The home screen draws art.
- Any other route clears the frame and stops the animation clock.
- Starting directly in a session draws nothing.
- Returning home redraws immediately.
- Resizing fits the frame again to the new terminal size. Frames are resampled
  with nearest-neighbor; characters and colors use the same mapping.

The renderable only keeps the animation clock alive while art is enabled, the
route is home, animations are on, and the pack actually moves. A static canvas
without effects never starts an animation loop.

## Terminal capability

Detection uses the host first and the environment as a fallback:

| Capability | Primary source | Fallback |
|---|---|---|
| Truecolor | `renderer.capabilities.rgb` | `COLORTERM` contains `truecolor` or `24bit` |
| 256 colors | `renderer.capabilities.ansi256` | `TERM` contains `256color` |
| 16 colors | A color terminal without RGB or 256 | A non-empty `TERM` that is not `dumb` |

`NO_COLOR` with any non-empty value forces `mono`. `TERM=dumb` forces `mono`.
A missing or unreadable host capability object falls back to the environment.

The dialog footer shows the effective capability as `truecolor`, `256 colors`,
`16 colors`, or `no color`.

## Color quantization

| Tier | Behavior |
|---|---|
| Truecolor | Exact RGB. |
| 256 colors | Each color is mapped to the nearest xterm 256 entry. Entries 16-255 are used because entries 0-15 depend on the user's terminal theme. |
| 16 colors | Theme and palette stops are mapped to the conventional ANSI 16 colors. |
| No color | Everything is `mono` using the theme faint text color. |

`original` keeps exact sidecar RGB on truecolor. On 256-color terminals it is
kept but quantized. On 16-color terminals it falls back to `palette` (or
`theme` when the pack has no palette). A cell with no foreground color uses the
theme faint color; pure black is treated the same way.

## Style resolution

| Style | Requires | Result |
|---|---|---|
| `mono` | Nothing | Theme `text.faint`. |
| `theme` | Nothing | Three theme stops: `text.faint`, `text.muted`, `text.base`, quantized for the terminal. |
| `palette` | Nothing, but a pack palette gives the authored colors | Pack palette stops or theme stops, quantized for the terminal. |
| `original` | `.ans` sidecars and 256+ colors | Per-cell sidecar RGB, quantized when needed. |

`original` falls back in this order:

1. No color sidecars: `palette`, or `theme` when the pack has no palette.
2. No 256-color support: `palette`, or `theme` when the pack has no palette.
3. Light theme and failed contrast check: `palette`, or `theme` when the pack
   has no palette.

When the effective style differs from the request, the dialog shows both and a
toast explains the reason once per pack and request.

### Light and dark themes

`mono` and `theme` read the active theme, so they follow light and dark mode
automatically. `palette` uses the pack palette when one exists and theme stops
otherwise. A pack palette is fixed by the author and does not change with the
theme.

`original` colors are authored against a background. On a light theme the
resolver samples the sidecar colors and checks them against the theme
background. A color passes if it already has 2.2:1 contrast, or if blending it
at most 25 percent toward the theme foreground reaches 3:1. If more than a
quarter of the sampled colors fail, the pack uses `palette` (or `theme` when it
has no palette). The dialog labels the adjustment instead of hiding it.

There is no per-cell color blending in the current implementation. It is pass
or fall back.

## Animations and motion

OpenCode's `animations: false` setting in `cli.json` is respected:

- Frame packs show frame 0 and do not advance.
- Canvas packs show the base canvas at `t = 0`; effects do not run.
- Static canvases have no loop in either case.

The user FPS setting applies to frame playback and to the effect step rate. It
defaults to the pack's `fps` and is clamped to 1-30.

The renderer has two one-shot safety nets:

1. If the 30-frame rolling average of paint time is over 12 ms and the style is
   `original`, it switches to `palette` once and toasts.
2. If the average is over 20 ms, it halves the effective fps once, never below
   5, and toasts.

Neither net oscillates. A style change by the user can reselect `original`.

## SSH and tmux

There is no SSH-specific code. The plugin uses the capability flags the host
reports. If a terminal multiplexer or remote shell does not forward truecolor,
the plugin sees the lower capability and the art degrades as described above.
`NO_COLOR` still forces `mono`.

## Glyph width

Every cell must be one width-1 printable character. This is enforced at
validation time, not patched at render time. Wide characters, emoji, combining
marks, format characters, tabs, and control characters are rejected.

Box drawing and block characters are width-1 and allowed. Terminals with
unusual width tables can still shift a grid; the validation rule is the
portable subset.

## Platforms

The plugin uses Node/Bun filesystem and path APIs and has no platform-specific
branches. CI runs the type check and tests on Ubuntu and Windows. macOS is not
in CI; it uses the same code path as Linux.

## Out of scope

- Multiple art layers, per-pane backgrounds, or mouse interaction.
- Images, audio, or video playback inside the TUI.
- A gallery, marketplace, or URL installs.
- Running scene code in the plugin. Scenes run only in the authoring CLI.
- A separate player outside OpenCode.
