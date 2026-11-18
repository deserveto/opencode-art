export interface PlayerOptions {
  readonly frameCount: number
  readonly fps: number
  readonly animated: boolean
  readonly staticCanvas: boolean
}

const MIN_FPS = 1
const MAX_FPS = 30

function clampFps(fps: number): number {
  if (!Number.isFinite(fps)) return 10
  return Math.min(MAX_FPS, Math.max(MIN_FPS, fps))
}

/**
 * Pure playback clock. `advance` consumes time, never more than one frame per
 * call: a long delta skips stale frames instead of queuing them.
 */
export class Player {
  private _frameCount: number
  private _fps: number
  private readonly _animated: boolean
  private readonly _staticCanvas: boolean
  private _index = 0
  private _elapsedMs = 0
  private _time = 0

  constructor(options: PlayerOptions) {
    const frames = Math.floor(options.frameCount)
    this._frameCount = Number.isFinite(frames) ? Math.max(1, frames) : 1
    this._fps = clampFps(options.fps)
    this._animated = options.animated !== false
    this._staticCanvas = options.staticCanvas === true
  }

  get index(): number {
    return this._index
  }

  /** Seconds of animation time; advances for canvas effects even at index 0. */
  get time(): number {
    return this._time
  }

  get frameCount(): number {
    return this._frameCount
  }

  get fps(): number {
    return this._fps
  }

  /** Accumulates a delta. Returns true when the visible frame changed. */
  advance(deltaMs: number): boolean {
    if (!this._animated || this._staticCanvas) return false
    const delta = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0
    if (delta === 0) return false

    this._time += delta / 1000
    this._elapsedMs += delta
    const interval = 1000 / this._fps
    if (this._elapsedMs < interval) return false

    // Skip whole intervals: remain under one interval, move one frame.
    this._elapsedMs %= interval
    if (this._frameCount <= 1) return false
    this._index = (this._index + 1) % this._frameCount
    return true
  }

  reset(): void {
    this._index = 0
    this._elapsedMs = 0
    this._time = 0
  }

  setFps(fps: number): void {
    this._fps = clampFps(fps)
  }
}
