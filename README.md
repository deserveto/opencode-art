# opencode-art

Animated ASCII art as a full-screen background on the OpenCode home screen.

The plugin is data-only. It reads pack folders and draws text cells; it never
executes code from a pack. The bundled **Fool** pack plays on the home screen,
sessions draw nothing, and art sits behind the host UI at `zIndex -1`.

- Package: `opencode-art`
- Command: `/art`
- Target: OpenCode 2.3.2, OpenTUI 0.8.4
- License: MIT for code, CC BY 4.0 for bundled art

Status: pre-release (0.1.0). The pack format, player, color styles, effects,
commands, dialog, settings, and watch loop are implemented. The authoring CLI
ships with the authoring milestone; see [docs/AUTHORING.md](docs/AUTHORING.md).

## Install

Use OpenCode's plugin command, which accepts an npm or Git package specifier:

```sh
opencode plugin add opencode-art
```

From Git instead:

```sh
opencode plugin add <repository-url>
```

The package exports `./tui` for the TUI part and `.` for the server part, which
registers the authoring skill. OpenCode resolves both from the installed
package.

### Local development

Point the TUI config at the repository instead of an installed package. In
`~/.config/opencode/cli.json`, add the repo to the plugin list:

```json
{
  "plugins": [
    { "package": "C:/dev/opencode-art" }
  ]
}
```

Use an absolute path. On Linux and macOS the config file is usually
`~/.config/opencode/cli.json`; on Windows it is
`%USERPROFILE%\.config\opencode\cli.json`. Restart or reload OpenCode after
changing the file.

## First run

Open the home screen. The bundled Fool pack should fill the background at
180 x 50 and 10 fps.

- Open a session: no art is drawn.
- Return home: the art returns immediately.
- Run `/art`: the browser opens.

If the terminal reports no color, the art is still drawn in `mono`. Run
`/art` to see the effective style and terminal capability.

## Commands

| Command | Action |
|---|---|
| `/art` | Open the art browser. |
| `/art on` / `/art off` / `/art toggle` | Enable or disable art and persist the choice. |
| `/art next` | Select the next pack in scope order and wrap. |
| `/art set <id>` | Select a pack by id. |
| `/art style <mono\|theme\|palette\|original>` | Set the color style. |
| `/art fps <1-30>` | Set playback fps; values are rounded and clamped. |
| `/art reload` | Re-scan and re-validate all pack folders. |
| `/art validate [id\|path]` | Validate one pack or every pack. A filesystem path is accepted. |
| `/art help` | Show commands and the arts paths. |

There is no `/art list`; the dialog is the list. There is no `/art create`;
creation happens in chat with the agent or by hand.

Full command and dialog reference: [docs/COMMANDS.md](docs/COMMANDS.md).

## Create art

Three ways to get a pack:

1. Ask the agent in chat. The package registers the `opencode-art` authoring
   skill from [skills/opencode-art/SKILL.md](skills/opencode-art/SKILL.md).
2. Copy an example from [examples/](examples) and edit the text.
3. Write a pack by hand from [docs/PACKS.md](docs/PACKS.md).

The shortest path is to copy a canvas pack, change `canvas.txt`, and let the
watcher reload it:

```sh
cp -r examples/pulse ~/.config/opencode/arts/my-pack
```

Then fix `id` in `art.json` to `my-pack`, edit `canvas.txt`, run `/art reload`,
and select it with `/art set my-pack`.

Packs live in three scopes, highest priority first:

| Scope | Path |
|---|---|
| Project | `<project>/.opencode/arts/<id>/` |
| User | `~/.config/opencode/arts/<id>/` (`XDG_CONFIG_HOME` is respected) |
| Bundled | `<package>/frames/<id>/` |

The folder name is the pack id. A duplicate id in one scope is resolved
lexicographically; the other copy is reported.

The authoring CLI `opencode-art init`, `bake`, `validate`, and `preview` ships
with the authoring milestone. It is an author-time tool only. The plugin never
imports `scene.mjs` and never runs scene code. See
[docs/AUTHORING.md](docs/AUTHORING.md) and [docs/SCENE_API.md](docs/SCENE_API.md).

## Settings

Settings apply in this order, highest priority first:

1. Project file: `<project>/.opencode/art.json` (committed and shared)
2. Global settings: OpenCode durable storage, written by `/art`
3. Pack defaults: `defaultStyle`, `fps`
4. Plugin defaults: `enabled: true`, `pack: "fool"`, `style: "mono"`,
   `fps` from the pack

The `/art` dialog and commands write global settings only. The plugin never
writes into a repository. A project override is a deliberate hand edit:

```json
{
  "version": 1,
  "enabled": true,
  "pack": "fool",
  "style": "mono",
  "fps": 10
}
```

All fields are optional. A project value wins over the global value on load
and reload. A project can, for example, disable art for a serious repository;
`/art on` cannot override that, and the plugin explains why in a toast. Invalid
fields are ignored one at a time. A file with a newer `version` is ignored as a
whole with a warning.

## Styles

| Style | Color source |
|---|---|
| `mono` | Theme `text.faint`; one color, always available. |
| `theme` | Three theme stops: `text.faint`, `text.muted`, `text.base`. |
| `palette` | Pack `palette` stops, ordered low to high brightness. |
| `original` | Per-cell RGB from `.ans` sidecars. |

`original` needs color sidecars and a terminal with at least 256 colors. On a
16-color terminal it falls back to `palette`; without sidecars it falls back to
`palette`, then `theme`. `NO_COLOR` and `TERM=dumb` force `mono`. The dialog
shows the effective style and a short reason when it differs from the request.

More detail: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Pack format at a glance

A pack has `art.json` and exactly one of `canvas` or `frames`.

```text
my-pack/
  art.json
  canvas.txt
  canvas.ans
```

```text
my-pack/
  art.json
  frames/
    000.txt
    000.ans
    001.txt
    001.ans
```

Every line must be exactly `cols` width-1 printable characters, and every frame
must have exactly `rows` lines. Tabs, control characters, combining marks, and
wide characters are rejected. Sidecars are optional but all-or-nothing per
pack; they add foreground color only and must strip to the matching `.txt`.

Full rules, caps, effects, and sidecar format: [docs/PACKS.md](docs/PACKS.md).
JSON Schema: [schemas/art.schema.json](schemas/art.schema.json), also exported
as `opencode-art/schema`.

## Watch

Pack folders are polled every 2 seconds with a 500 ms debounce. A change
reloads the active pack without a restart. If the active pack disappears, the
last good frames stay on screen and the bundled Fool is the fallback. Polling
stops when art is disabled.

## Examples

These are repository examples, not installed packs. Copy one into the user
arts directory to try it.

| Example | Shape | What it shows |
|---|---|---|
| [examples/logo](examples/logo) | 40 x 12 canvas | Palette plus `shimmer` |
| [examples/pulse](examples/pulse) | 40 x 12 canvas | Mono-friendly `wave` |
| [examples/rain](examples/rain) | 8 frames, 24 x 8 | A short animated loop |

## Compatibility

| Item | Value |
|---|---|
| OpenCode | 2.3.2 |
| OpenTUI | 0.8.4 (host version; 0.9.x is not the target) |
| OpenCode runtime | Bun 1.4.4, bundled with OpenCode |
| Node (tooling and CLI only) | 22.18 or newer; CI uses 24 |
| Platforms | Windows, macOS, Linux |

The plugin uses the host's OpenTUI, Solid, and plugin modules. It does not
bundle them. Do not install newer OpenTUI APIs into the plugin expecting them
to run on 2.3.2.

Details and terminal degradation: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Troubleshooting

| Symptom | Check |
|---|---|
| No art on the home screen | Run `/art on`. Check that your terminal has color or that `mono` is acceptable. |
| A pack is missing | Confirm `<arts>/<id>/art.json` exists and the folder name matches `id`. Run `/art reload`. |
| A pack is listed under Problems | Run `/art validate <id>` or `/art validate <path>` and fix the reported file and line. |
| Wrong shape or shifted art | Every line must be exactly `cols` characters and every frame exactly `rows` lines. Use width-1 glyphs only. |
| Art disappeared after an edit | The last good frames are kept while the new pack is invalid. Fix the pack and run `/art reload`. |
| `/art on` does not work | The project `.opencode/art.json` may set `enabled: false`. Edit the project file. |
| `original` looks like palette | The terminal has no 256-color support, the pack has no sidecars, or light-theme contrast adjustment rejected the authored colors. |
| Art is slow | Lower `/art fps` or choose `theme`/`mono`. The renderer also degrades once on its own. |

More fixes: [docs/AUTHORING.md](docs/AUTHORING.md#troubleshooting) and
[docs/PACKS.md](docs/PACKS.md#common-errors).

## Development

```sh
npm ci
npm run typecheck
npm test
```

The manual TUI checklist and test layout are in [docs/TESTING.md](docs/TESTING.md).
Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Code is MIT. See [LICENSE](LICENSE).

Bundled art in `frames/` and `examples/` is CC BY 4.0. See
[LICENSE-ART](LICENSE-ART) and the
[CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/).
