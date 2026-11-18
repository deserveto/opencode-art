# Commands and dialog

The plugin registers one slash command, `/art`. Arguments are space separated.
Subcommand names are case-insensitive.

## Commands

| Command | Behavior |
|---|---|
| `/art` | Open the art browser. |
| `/art on` | Enable art and persist the choice globally. |
| `/art off` | Disable art and persist the choice globally. |
| `/art toggle` | Flip the current enabled state and persist it. |
| `/art next` | Select the next loadable pack in scope order and wrap. Shows the pack name, id, and scope. |
| `/art set <id>` | Select a pack by id. An unknown id shows close matches. |
| `/art style <mono\|theme\|palette\|original>` | Set the color style globally. |
| `/art fps <1-30>` | Set playback fps. The value is rounded, then clamped to 1-30. |
| `/art reload` | Re-read the project settings, re-scan every arts folder, and reload the active pack. Reports the pack and problem count. |
| `/art validate [id\|path]` | Validate one pack or every pack. See below. |
| `/art help` | Show the command list and the three arts paths. |

There is no `/art list`; the dialog is the list. There is no `/art create`;
creation happens in chat with the agent or by editing files.

A bare `/art` opens the dialog. An unknown subcommand shows
`Unknown command "..."`. Missing arguments show a usage toast instead of
guessing.

### Validation details

`/art validate` accepts an id or a filesystem path. A path is recognized by a
`/` or `\` in the argument. A leading `~` is expanded to the home directory.

- Valid id or path: a success toast, or `<path>: valid` for a path.
- Invalid path: a dialog lists every error with file and line. Up to 20 lines
  are shown; all error lines are also written to the plugin log.
- Invalid id or all packs: a toast shows the issue count and opens the dialog.
  The Problems section lists the first error for each invalid pack.
- Unknown id: reports `No pack with id "..."`.

Packs are validated before they become selectable. A bad pack never partially
renders.

## Dialog

```text
+ ASCII Art ------------------------------------------------------+
| Packs (3)                 | Preview                            |
| > fool          bundled   | The Fool                           |
|   logo          user      | Styles: mono · theme · palette ... |
|   rain          project   | ... still frame ...                |
|                                                                 |
| Enabled: yes   Style: mono   FPS: 10   Frames: 60               |
| Problems                                                        |
| rain: art.json: expected 8 rows, found 7                        |
| Up/Down select · Enter apply · s style · Left/Right fps · ...   |
| Create art by asking the agent in chat · ~/.config/opencode/arts |
+-----------------------------------------------------------------+
```

The exact layout adjusts to the terminal size. The preview is a still frame of
the selected pack, fitted to the preview area, in the effective style. It does
not animate.

The pack list shows the id, scope (`project`, `user`, or `bundled`), an
`active` marker, and a shortened display name. The preview line lists the
styles available for that pack.

The status line reports `Enabled`, the effective `Style` (with the requested
style when it differs), `FPS`, and whether the pack is a canvas or how many
frames it has. Status is text, not color alone.

The Problems section lists up to four invalid packs with the first error for
each. Invalid packs are not selectable.

### Keys

| Key | Action |
|---|---|
| `Up` / `k` | Select the previous pack. |
| `Down` / `j` | Select the next pack. |
| `Enter` | Apply the selected pack and persist it globally. |
| `s` | Cycle through the styles available for the selected pack. |
| `Left` / `-` | Decrease fps by 1. |
| `Right` / `+` / `=` | Increase fps by 1. |
| `e` | Toggle enabled. |
| `r` | Reload packs and refresh the preview. |
| `Esc` / `q` | Close the dialog. |

Available styles start with `mono` and `theme`. `palette` is added when the
pack declares a palette. `original` is added when at least one frame has color
sidecar data.

Changes apply live and persist to global settings. FPS is clamped to 1-30.
When a requested style is unavailable, the status line and a toast explain the
effective style.

## Settings

The plugin reads four layers, highest priority first:

| Layer | Where | Written by |
|---|---|---|
| Project | `<project>/.opencode/art.json` | You, by hand |
| Global | OpenCode durable storage under the `settings` key | `/art` and the dialog |
| Pack defaults | `defaultStyle` and `fps` in `art.json` | Pack author |
| Plugin defaults | `enabled: true`, `pack: "fool"`, `style: "mono"`, `fps` from the pack | Fixed |

The project file is committed and shared. Its shape:

```json
{
  "version": 1,
  "enabled": true,
  "pack": "fool",
  "style": "mono",
  "fps": 10
}
```

All fields are optional. A field that is absent falls through to the next
layer.

The plugin never writes the project file. This is deliberate: changing a
repository's settings is your decision, not a side effect of opening a dialog.
Edit the file by hand and commit it if the whole team should share it.

An invalid field is ignored individually so one typo does not wipe the file.
A file that is not a JSON object, cannot be read, or has a `version` newer than
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

Pack folders are polled every 2 seconds. The poll hashes directory mtimes,
file names, sizes, and mtimes, then waits 500 ms after a change before
reloading. A change re-scans all scopes, re-validates, and reloads the active
pack if it changed.

If the active pack disappears or becomes invalid, the last good frames stay on
screen. If there are none, the bundled Fool is used. Polling stops when art is
disabled or the plugin unloads.
