# Commands and dialog

The plugin registers one slash command, `/art`. Arguments are space separated.
Subcommand names are case-insensitive.

## Commands

| Command | Behavior |
|---|---|
| `/art` | Open the art browser. |
| `/art create [scene\|image\|gif\|video\|logo]` | Open the prompt template picker (or select a template directly) and prefill the chat composer. |
| `/art on` | Enable art and persist the choice globally. |
| `/art off` | Disable art and persist the choice globally. |
| `/art toggle` | Flip the current enabled state and persist it. |
| `/art next` | Select the next loadable pack in scope order and wrap. Shows the pack name, id, and scope. |
| `/art set <id>` | Select a pack by id. An unknown id shows close matches. |
| `/art style <mono\|theme\|palette\|original>` | Set the color style globally. |
| `/art fps <1-30>` | Set playback fps. The value is rounded, then clamped to 1-30. |
| `/art dim <0-80>` | Dim foreground colors toward the theme background (0-80%). Value is rounded, then clamped to 0-80. |
| `/art reload` | Re-read the project settings, re-scan every arts folder, and reload the active pack. Reports the active id, pack count, and problem count. |
| `/art validate [id\|path]` | Validate one pack or every pack. See below. |
| `/art help` | Show the command list and the three arts paths. |

There is no `/art list`; the dialog is the list. `/art create` prepares an
adjustable prompt template for the agent in chat (and copies it to the terminal
clipboard via OSC 52 when supported).

### Creation templates

`/art create` accepts an optional template kind (`scene`, `image`, `gif`,
`video`, or `logo`; common aliases such as `canvas`, `png`, `mp4`, or `banner`
also work). Without an argument, it opens a picker dialog so you can choose what
kind of art or media input you want to use:

- `scene`: procedural looping animation (`scene.mjs`) from a description
- `image`: PNG, JPEG, or WebP converted into an ASCII canvas with optional effects
- `gif`: animated GIF converted into an ASCII frame sequence
- `video`: MP4, MOV, or WebM video converted into an ASCII frame sequence (requires `ffmpeg`)
- `logo`: custom ASCII logo, banner, or static canvas with optional live effects

Selecting a template prefills the chat composer with bracketed `[...]` fields
ready to adjust before pressing `Enter`.

A bare `/art` opens the dialog. An unknown subcommand shows
`Unknown command "..."` and suggests `/art help`. Missing arguments show a
usage toast instead of guessing.

### Validation details

`/art validate` accepts an id or a filesystem path. A path is recognized by a
`/` or `\` in the argument. A leading `~` is expanded to the home directory.

- Valid id or path: a success toast, or `<path>: valid` for a path.
- Invalid path: a dialog lists errors with file and line. Up to 40 lines
  are shown; the rest are written to the plugin log.
- Invalid id or all packs: a toast shows the issue count and opens the dialog.
  The Problems section lists the first error for each invalid pack.
- Unknown id: reports `No pack with id "..."`.

Discovery checks manifests and file stats. Frame contents are validated when a
pack loads; a bad pack never partially renders.

## Dialog

```text
+ ASCII Art -------------------------------------------------------------------+
| Packs (3) · active: fool                                                     |
| > fool*         bundled   The Fool                                           |
|   logo          user      Shimmer Mark                                       |
|   rain          project   Rain                                               |
| Preview: The Fool                                                            |
| Styles: mono · theme · palette · original                                    |
| Enabled: yes   Style: mono   FPS: 10   Dim: 0%   Frames: 1/60                |
| Problems: rain: art.json: expected 8 rows, found 7                           |
| Up/Down select · Enter apply · / filter · c create · s style · d dim · p play|
| [/] frame · Left/Right fps · e on/off · r reload · Esc/q close               |
| * active · truecolor · /art create · ~/.config/opencode/arts                 |
+------------------------------------------------------------------------------+
```

The exact layout adjusts to the terminal size. The preview shows the selected
pack fitted to the preview area (using its `fit` mode), in the effective style,
with the current `dim` setting. It starts paused on frame 0; press `p` to
animate it or `[` / `]` to step frames.

The pack list shows the id, an `*` active marker, scope (`project`, `user`, or
`bundled`), and a shortened display name. When more than 12 packs match, it
scrolls in a 12-row window around the selection with `↑ N more` / `↓ M more`
indicators. Press `/` to filter packs by id or name.

The status line reports `Enabled`, the effective `Style` (with the requested
style when it differs), `FPS`, `Dim`, and either `Canvas` or
`Frames: <current>/<total>` (plus `(playing)` while animating). Status is text,
not color alone.

The Problems section lists up to four invalid packs with the first error for
each. Invalid packs are not selectable.

### Keys

| Key | Action |
|---|---|
| `Up` / `k` | Select the previous pack (arrows also work in filter mode). |
| `Down` / `j` | Select the next pack (arrows also work in filter mode). |
| `Enter` | Apply the selected pack and persist it globally. |
| `/` | Filter packs by id or name (`Backspace` deletes, `Enter` or `Esc` exits filter mode). |
| `c` | Close the browser and open the `/art create` prompt template picker. |
| `s` | Cycle through the styles available for the selected pack. |
| `d` | Cycle dimming through `0%`, `25%`, `50%`, and `75%` and persist globally. |
| `p` | Play or pause preview animation. |
| `[` / `]` | Step backward or forward one preview frame (or effect step) and pause animation. |
| `Left` / `-` | Decrease fps by 1. |
| `Right` / `+` / `=` | Increase fps by 1. |
| `e` | Toggle enabled. |
| `r` | Reload packs and refresh the preview. |
| `Esc` / `q` | Close the dialog (outside filter mode). |

Available styles start with `mono` and `theme`. `palette` is added when the
pack declares a palette. `original` is added when at least one frame has color
sidecar data.

Changes apply live and persist to global settings. FPS is clamped to 1-30 and
dimming is clamped to 0-80% (`/art dim <0-80>` sets any integer in that range).
When a requested style is unavailable, the status line and a toast explain the
effective style.

## Settings

The plugin reads four layers, highest priority first:

| Layer | Where | Written by |
|---|---|---|
| Project | `<project>/.opencode/art.json` | You, by hand |
| Global | OpenCode durable storage under the `settings` key | `/art` and the dialog |
| Pack defaults | `defaultStyle` and `fps` in `art.json` | Pack author |
| Plugin defaults | `enabled: true`, `pack: "fool"`, `style: "mono"`, `fps` from the pack, `dim: 0` | Fixed |

The project file is committed and shared. Its shape:

```json
{
  "version": 1,
  "enabled": true,
  "pack": "fool",
  "style": "mono",
  "fps": 10,
  "dim": 0
}
```

All fields are optional (`dim` accepts an integer from `0` to `80`). A field
that is absent falls through to the next layer. A project value wins when
settings load and on reload. A pack selected in the dialog or with `/art set`
is written to global settings and used in later sessions; if the project sets
`pack`, `style`, `fps`, `dim`, or `enabled`, the project value takes precedence
and the plugin explains that in a toast when a conflicting global change is
made.

The plugin never writes the project file. This is deliberate: changing a
repository's settings is your decision, not a side effect of opening a dialog.
Edit the file by hand and commit it if the whole team should share it.

An invalid field is ignored individually so one typo does not wipe the file.
A file that is not a JSON object, cannot be read, or has a `version` other than
1 is ignored as a whole, with a warning. Unknown fields are preserved because
the plugin does not rewrite the file.

A project can disable art for a repository. `/art on` writes the global setting
but the project value still wins; the plugin says so in a toast.

`/art help` prints the three arts paths. The project settings path is
`<project>/.opencode/art.json`.

## Paths

| Scope | Path | Priority |
|---|---|---|
| Project | `<project>/.opencode/arts/<id>/` | Highest |
| User | `~/.config/opencode/arts/<id>/` | Middle |
| Bundled | `<package>/frames/<id>/` | Lowest |

- The project root is OpenCode's current project directory, with the process
  working directory as the fallback.
- `XDG_CONFIG_HOME` replaces `~/.config` for the user arts path when set.
- The same id in different scopes uses the higher scope.
- A duplicate id in one scope is resolved lexicographically; the first copy
  wins and the other is reported.
- Only one pack is active at a time.
- The bundled Fool is the last-resort fallback.

## Watch

The project arts folder (`<project>/.opencode/arts`), user arts folder
(`~/.config/opencode/arts`), and project settings file
(`<project>/.opencode/art.json`) are polled every 2 seconds (bundled frames are
not polled). The poll hashes file sizes and mtimes plus directory structure,
then waits 500 ms after a change before reloading. A change re-reads project
settings, re-scans all scopes, re-validates, and reloads the active pack if it
changed.

If the active pack disappears or becomes invalid, the last good frames stay on
screen. If there are none, the bundled Fool is used. Polling stops when art is
disabled or the plugin unloads.
