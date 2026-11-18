# Migrating from `ascii-bg`

The old local plugin lives at `~/.config/opencode/plugins/ascii-bg` and is
referenced from `~/.config/opencode/cli.json`. It keeps working until you
remove it. The new plugin has a different package id and command, so both can
be installed at once while you compare, but do not leave both enabled: each
draws its own background.

## Before you switch

1. Complete the acceptance checks in `docs/TESTING.md` against a local install.
2. Back up the config and the old folder:

   ```powershell
   Copy-Item ~/.config/opencode/cli.json ~/.config/opencode/cli.json.pre-opencode-art
   Copy-Item -Recurse ~/.config/opencode/plugins/ascii-bg ~/.config/opencode/plugins/ascii-bg.pre-opencode-art
   ```

3. Note the current plugin entry:

   ```json
   { "package": "./plugins/ascii-bg", "options": { "enabled": true, "fps": 10, "zIndex": -1 } }
   ```

## Switch

Published package:

```sh
opencode plugin add opencode-art
```

Local checkout while developing on Windows:

```json
{
  "plugins": [
    { "package": "C:/dev/opencode-art" }
  ]
}
```

The server part (authoring skill) loads from the plugins folder; link the
checkout there:

```powershell
New-Item -ItemType Junction -Path "$HOME/.config/opencode/plugins/opencode-art" -Target "C:/dev/opencode-art"
```

Use an absolute path. Remove the `ascii-bg` entry and move its folder out of
`plugins/` while testing so only one background renders. Restart OpenCode.

What carries over:

- The bundled Fool art is part of the new package; the old frames folder is
  not needed.
- The old plugin had no settings store. The new global settings are created on
  the first `/art` change. If you want to commit a project choice, add
  `<project>/.opencode/art.json`.
- `/bg` becomes `/art`. The old command is not registered by the new plugin.

## Rollback

Restore the backup and restart:

```powershell
Copy-Item ~/.config/opencode/cli.json.pre-opencode-art ~/.config/opencode/cli.json -Force
```

The old folder is untouched until you delete it. To remove the new plugin:

```sh
opencode plugin remove opencode-art
```

For a local path entry, delete that object from `cli.json` and restart.

## Removing the old plugin

Only after the new plugin passes the live checklist and you have used it for a
few sessions:

```powershell
Remove-Item -Recurse ~/.config/opencode/plugins/ascii-bg
```

Keep `ascii-bg.pre-opencode-art` until you are sure. It is a byte-for-byte copy
of the working folder.
