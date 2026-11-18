import type { ArtRenderableOptions } from "./renderable.ts"

declare module "@opentui/solid/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "art-background": ArtRenderableOptions
    }
  }
}
