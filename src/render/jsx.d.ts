import type { ArtRenderable, ArtRenderableOptions } from "./renderable.ts"

declare module "@opentui/solid/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "art-background": ArtRenderableOptions & { ref?: (element: ArtRenderable) => void }
    }
  }
}
