# Shimmer Mark (logo)

A 40 x 12 static canvas: a bordered diamond with a `shimmer` effect and a
three-stop palette. It defaults to `palette`; `mono` and `theme` also work.

## Copy it

Copy this folder into the user arts directory and keep the folder name `logo`.

Linux and macOS:

```sh
cp -r examples/logo ~/.config/opencode/arts/logo
```

Windows PowerShell:

```powershell
Copy-Item examples\logo "$env:USERPROFILE\.config\opencode\arts\logo" -Recurse
```

If `XDG_CONFIG_HOME` is set, use `$XDG_CONFIG_HOME/opencode/arts/logo` instead.

Then run `/art reload` and `/art set logo`, or open `/art` and select it.

This example is not loaded by default. The bundled Fool is the only default
pack. The artwork is CC BY 4.0; see [LICENSE-ART](../../LICENSE-ART).
