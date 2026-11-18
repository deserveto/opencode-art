# Rain

An animated pack: 8 frames, each 24 x 8, played at 8 fps. Every frame uses
width-1 glyphs only (`.`, `|`, `/`) and there are no color sidecars.

`defaultStyle` is `mono`. `theme` and `palette` also work; `original` is not
available without `.ans` sidecars.

## Copy it

Copy this folder into the user arts directory and keep the folder name `rain`.

Linux and macOS:

```sh
cp -r examples/rain ~/.config/opencode/arts/rain
```

Windows PowerShell:

```powershell
Copy-Item examples\rain "$env:USERPROFILE\.config\opencode\arts\rain" -Recurse
```

If `XDG_CONFIG_HOME` is set, use `$XDG_CONFIG_HOME/opencode/arts/rain` instead.

Then run `/art reload` and `/art set rain`, or open `/art` and select it.

This example is not loaded by default. The bundled Fool is the only default
pack. The artwork is CC BY 4.0; see [LICENSE-ART](../../LICENSE-ART).
