import { runChild } from "./child.ts"
import type { RgbaImage } from "./media.ts"

export interface VideoOptions {
  readonly cols: number
  readonly rows: number
  readonly fps: number
  readonly loop: number
  readonly timeoutMs: number
}

/**
 * Decode a video into RGBA frames through an optional ffmpeg binary. Frames
 * arrive at `cols x (rows * 2)` so the normal aspect-correcting grid pass can
 * average vertical pairs.
 */
export async function decodeVideo(file: string, options: VideoOptions): Promise<RgbaImage[]> {
  const width = options.cols
  const height = options.rows * 2
  const frames = Math.min(600, Math.max(1, Math.round(options.loop * options.fps)))
  const filter = `fps=${options.fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`
  let result
  try {
    result = await runChild(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        file,
        "-t",
        String(options.loop),
        "-vf",
        filter,
        "-frames:v",
        String(frames),
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ],
      { timeoutMs: options.timeoutMs },
    )
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") {
      throw new Error("ffmpeg was not found on PATH. Install ffmpeg for video input, or bake a PNG, JPEG, WebP, or GIF.")
    }
    throw error
  }
  if (result.timedOut) throw new Error(`ffmpeg timed out after ${Math.round(options.timeoutMs / 1000)}s`)
  if (result.code !== 0) {
    const detail = result.stderr.trim().split("\n").slice(-3).join("\n")
    throw new Error(`ffmpeg failed${detail ? `: ${detail}` : ""}`)
  }

  const frameBytes = width * height * 3
  const decoded: RgbaImage[] = []
  const total = Math.floor(result.stdout.length / frameBytes)
  for (let index = 0; index < total; index++) {
    const offset = index * frameBytes
    const data = new Uint8ClampedArray(width * height * 4)
    for (let pixel = 0; pixel < width * height; pixel++) {
      const source = offset + pixel * 3
      const target = pixel * 4
      data[target] = result.stdout[source]
      data[target + 1] = result.stdout[source + 1]
      data[target + 2] = result.stdout[source + 2]
      data[target + 3] = 255
    }
    decoded.push({ width, height, data })
  }
  if (decoded.length === 0) throw new Error("ffmpeg produced no frames; check the input file and --loop")
  return decoded
}
