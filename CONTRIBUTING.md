# Contributing

Thanks for helping. This project has two contribution surfaces: code and art
packs. Both need the same thing: the TUI must never break, and a pack must
never execute code at runtime.

## Pack contributions

Repository packs live under `examples/<id>/`. They are not loaded by default;
the bundled Fool in `frames/fool` is the only default pack. Do not add packs to
`frames/`.

A pack pull request must have:

- `art.json` with `schemaVersion`, `id`, `name`, `fps`, `cols`, `rows`, and
  exactly one of `frames` or `canvas`.
- A folder name equal to `id`.
- A `license` field. CC BY 4.0 is the default for this repository. If you do
  not own the artwork or have permission to license it, do not submit it.
- A `README.md` that says what the pack shows and how to copy it.
- Passing validation with no errors. Warnings should be explained in the pull
  request.
- Every line exactly `cols` width-1 printable characters, and every frame
  exactly `rows` lines. Trailing spaces count.
- Width-1 glyphs only: no tabs, control characters, combining marks, zero-width
  characters, emoji, or CJK.
- Sidecars, if present, for every frame, matching the `.txt` text exactly.
- No executable content. `scene.mjs` is allowed only as provenance; it is never
  run by the plugin. Do not add helper modules, package manifests, or scripts
  inside a pack.
- No third-party code or third-party art without a compatible license and
  attribution in the pack.

Art quality bar:

- The composition is intentional at the declared size. Random noise and empty
  frames are not enough.
- Motion either loops cleanly or ends deliberately. State the loop length in
  the README.
- The pack is readable in mono. Color is an enhancement, not the only way to
  see the art.
- The pack stays well under the caps. Prefer a small, finished pack over a
  large, unpolished one.
- The README is honest about what the pack requires, including sidecars and
  terminal color.

Validate before opening a pull request:

```sh
# In the TUI, for a pack outside the arts folders:
/art validate ./examples/my-pack
```

When the authoring CLI is available:

```sh
opencode-art validate ./examples/my-pack
```

The same rules apply. `validate` is the source of truth.

## Code contributions

```sh
npm ci
npm run typecheck
npm test
```

Requirements:

- TypeScript is strict and `noUnusedLocals` is on. Imports of local TypeScript
  files use the `.ts` extension, matching the existing code.
- New behavior needs a test. New validation rules need a test for the passing
  case and each failure mode.
- No new runtime dependency without a discussion. The plugin uses the host's
  OpenTUI, Solid, and plugin modules and does not bundle them.
- Target OpenCode 2.3.2 and OpenTUI 0.8.4. Do not use newer APIs without a
  compatibility plan.
- Packs stay data-only. Do not import, evaluate, or execute anything from a
  pack directory at runtime.
- Keep the plugin's failure paths non-fatal: a bad pack, a failed write, or a
  render error must not throw out of setup or crash the TUI.
- Update the relevant docs when behavior changes:
  [PACKS.md](docs/PACKS.md), [AUTHORING.md](docs/AUTHORING.md),
  [SCENE_API.md](docs/SCENE_API.md), [COMMANDS.md](docs/COMMANDS.md),
  [COMPATIBILITY.md](docs/COMPATIBILITY.md), [TESTING.md](docs/TESTING.md).

Keep changes focused. A bug fix should fix the root cause once in the shared
code, not patch each caller. If you change a function, check its callers, tests,
and fixtures in the same change.

## Documentation contributions

- Every claim must match the code that exists now. If an interface is specified
  but not implemented, say so.
- Use short sections and tables. Plain language, no marketing voice.
- Link to files inside this repository. The CC BY 4.0 license is the only
  external link needed.
- Do not add em dashes. Use plain hyphens.
- Keep command names, keys, options, and paths exact. Do not invent aliases.

## Security

Pack loading is a trust boundary. Path traversal, absolute paths, symlink
escapes, ANSI injection, and oversized files are rejected by design. Changes in
this area need tests and a clear explanation in the pull request. Do not weaken
a check to make a pack load.

If you find a security issue, open an issue with a minimal reproduction and
avoid posting exploit details for a live user.

## Licensing

By contributing code, you agree that it is licensed under MIT. By contributing
art, you agree that it is licensed under CC BY 4.0 unless the pack declares a
different compatible license. See [LICENSE](LICENSE) and
[LICENSE-ART](LICENSE-ART).
