import type { Grid, Pack } from "../art/types.ts"
import { applyEffects } from "../effects/index.ts"
import { fitGrid } from "./fit.ts"

/** Fits one pack frame to the display size. */
export function fitFrame(pack: Pack, frameIndex: number, cols: number, rows: number): Grid | null {
  if (pack.frames.length === 0) return null
  const index = Math.max(0, Math.min(pack.frames.length - 1, Math.floor(frameIndex)))
  return fitGrid(pack.frames[index], cols, rows, pack.manifest.fit ?? "stretch")
}

/** Fit plus canvas effects, for callers that do not keep a fit cache. */
export function displayFrame(
  pack: Pack,
  frameIndex: number,
  cols: number,
  rows: number,
  time: number,
  fps: number,
  animations: boolean,
): Grid | null {
  const fitted = fitFrame(pack, frameIndex, cols, rows)
  if (!fitted) return null
  if (pack.kind !== "canvas" || !animations || pack.manifest.effects.length === 0) return fitted
  return applyEffects(fitted, pack.manifest.effects, time, { fps, seed: 0, ramp: pack.manifest.ramp })
}

/** Stop chosen by brightness: `floor(brightness * count)`, clamped. */
export function stopIndexFor(brightness: number, stopCount: number): number {
  if (stopCount <= 0) return 0
  const value = Number.isFinite(brightness) ? Math.max(0, Math.min(1, brightness)) : 0.5
  return Math.min(stopCount - 1, Math.floor(value * stopCount))
}

export interface PaintArea {
  readonly startX: number
  readonly startY: number
  readonly endX: number
  readonly endY: number
}

/** Clips a cell rectangle to the buffer, accounting for the paint origin. */
export function computePaintArea(
  cols: number,
  rows: number,
  originX: number,
  originY: number,
  bufferWidth: number,
  bufferHeight: number,
): PaintArea | null {
  const startX = Math.max(0, -originX)
  const startY = Math.max(0, -originY)
  const endX = Math.min(Math.max(0, cols), bufferWidth - originX)
  const endY = Math.min(Math.max(0, rows), bufferHeight - originY)
  if (endX <= startX || endY <= startY) return null
  return { startX, startY, endX, endY }
}
