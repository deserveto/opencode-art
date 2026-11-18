# Pulse

A 40 x 12 static canvas: one sine line moved by a `wave` effect. It defaults to
`mono` and needs no color sidecar, so it works in every terminal.

## Copy it

Copy this folder into the user arts directory and keep the folder name `pulse`.

Linux and macOS:

```sh
cp -r examples/pulse ~/.config/opencode/arts/pulse
```

Windows PowerShell:

```powershell
Copy-Item examples\pulse "$env:USERPROFILE\.config\opencode\arts\pulse" -Recurse
```

If `XDG_CONFIG_HOME` is set, use `$XDG_CONFIG_HOME/opencode/arts/pulse` instead.

Then run `/art reload` and `/art set pulse`, or open `/art` and select it.

This example is not loaded by default. The bundled Fool is the only default
pack. The artwork is CC BY 4.0; see [LICENSE-ART](../../LICENSE-ART).
