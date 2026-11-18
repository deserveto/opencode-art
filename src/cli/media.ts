import { readFile } from "node:fs/promises"
import { decode as decodeJpeg } from "jpeg-js"
import { decode as decodePng } from "fast-png"
import { decompressFrames, parseGIF } from "gifuct-js"
import { decode as decodeWebp } from "@stacksjs/ts-webp"

export interface RgbaImage {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

export interface AnimatedFrames {
  readonly width: number
  readonly height: number
  readonly frames: readonly RgbaImage[]
  /** Delay before each frame, in milliseconds. */
  readonly delays: readonly number[]
}

function fromPixels(data: ArrayLike<number>, width: number, height: number, channels: number, depth: number): RgbaImage {
  const out = new Uint8ClampedArray(width * height * 4)
  const scale = depth === 16 ? 1 / 257 : 1
  for (let pixel = 0; pixel < width * height; pixel++) {
    const source = pixel * channels
    const target = pixel * 4
    if (channels === 1) {
      const value = Math.round((data[source] ?? 0) * scale)
      out[target] = value
      out[target + 1] = value
      out[target + 2] = value
      out[target + 3] = 255
    } else if (channels === 2) {
      const value = Math.round((data[source] ?? 0) * scale)
      out[target] = value
      out[target + 1] = value
      out[target + 2] = value
      out[target + 3] = Math.round((data[source + 1] ?? 0) * scale)
    } else if (channels === 3) {
      out[target] = Math.round((data[source] ?? 0) * scale)
      out[target + 1] = Math.round((data[source + 1] ?? 0) * scale)
      out[target + 2] = Math.round((data[source + 2] ?? 0) * scale)
      out[target + 3] = 255
    } else {
      out[target] = Math.round((data[source] ?? 0) * scale)
      out[target + 1] = Math.round((data[source + 1] ?? 0) * scale)
      out[target + 2] = Math.round((data[source + 2] ?? 0) * scale)
      out[target + 3] = Math.round((data[source + 3] ?? 0) * scale)
    }
  }
  return { width, height, data: out }
}

export function extensionOf(file: string): string {
  const dot = file.lastIndexOf(".")
  return dot < 0 ? "" : file.slice(dot + 1).toLowerCase()
}

export async function decodeStill(file: string): Promise<RgbaImage> {
  const buffer = await readFile(file)
  const extension = extensionOf(file)
  if (extension === "png") {
    const decoded = decodePng(buffer)
    return fromPixels(decoded.data, decoded.width, decoded.height, decoded.channels ?? 4, decoded.depth ?? 8)
  }
  if (extension === "jpg" || extension === "jpeg") {
    const decoded = decodeJpeg(buffer, { useTArray: true, formatAsRGBA: true })
    return { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) }
  }
  if (extension === "webp") {
    const decoded = decodeWebp(new Uint8Array(buffer))
    return { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) }
  }
  if (extension === "gif") {
    const animated = await decodeAnimation(file)
    const first = animated.frames[0]
    if (!first) throw new Error(`${file}: GIF has no frames`)
    return first
  }
  throw new Error(`unsupported image type ".${extension}": use PNG, JPEG, WebP, or GIF`)
}

export async function decodeAnimation(file: string): Promise<AnimatedFrames> {
  const buffer = await readFile(file)
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const gif = parseGIF(arrayBuffer)
  const parsed = decompressFrames(gif, true)
  const width = gif.lsd.width
  const height = gif.lsd.height
  const canvas = new Uint8ClampedArray(width * height * 4)
  const frames: RgbaImage[] = []
  const delays: number[] = []
  let saved: Uint8ClampedArray | null = null

  for (const frame of parsed) {
    if (frame.disposalType === 3) saved = new Uint8ClampedArray(canvas)
    const { top, left, width: frameWidth, height: frameHeight } = frame.dims
    const patch = frame.patch
    for (let y = 0; y < frameHeight; y++) {
      for (let x = 0; x < frameWidth; x++) {
        const source = (y * frameWidth + x) * 4
        const alpha = patch[source + 3] ?? 0
        if (alpha === 0) continue
        const target = ((top + y) * width + (left + x)) * 4
        if (target < 0 || target + 3 >= canvas.length) continue
        canvas[target] = patch[source]
        canvas[target + 1] = patch[source + 1]
        canvas[target + 2] = patch[source + 2]
        canvas[target + 3] = alpha
      }
    }
    frames.push({ width, height, data: new Uint8ClampedArray(canvas) })
    delays.push(frame.delay > 0 ? frame.delay : 100)

    if (frame.disposalType === 2) {
      for (let y = top; y < top + frameHeight; y++) {
        for (let x = left; x < left + frameWidth; x++) {
          const target = (y * width + x) * 4
          if (target >= 0 && target + 3 < canvas.length) canvas.fill(0, target, target + 4)
        }
      }
    } else if (frame.disposalType === 3 && saved) {
      canvas.set(saved)
      saved = null
    }
  }

  if (frames.length === 0) throw new Error(`${file}: GIF has no frames`)
  return { width, height, frames, delays }
}
