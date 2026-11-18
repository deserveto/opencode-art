# The Fool

The bundled default pack. 180×50, 10 fps, six-second loop, 60 frames.

Artwork: "The Fool" by sangh, CC BY 4.0 (see `LICENSE-ART` at the repo root).

The frames come from the standalone *The Fool Argon* artwork. Regenerate them
with `scripts/bake-fool.cjs`; it reads the artwork's luminance and RGB fields
from a temporary copy and never edits the source HTML. The console-first
character layer is preserved, and colors are quantized to 64 stops so the pack
stays around 3.4 MB.

Switch to color with `/art style original` (truecolor terminals) or
`/art style palette`.
