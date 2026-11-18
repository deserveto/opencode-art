import type { RgbaImage } from "./media.ts"

export interface GlyphFrame {
  readonly cols: number
  readonly rows: number
  /** Row-major characters, no newlines. */
  readonly chars: string
  /** Row-major RGB, no colors when null. */
  readonly colors: Uint8Array | null
}

export interface GridOptions {
  readonly cols: number
  readonly rows: number
  readonly ramp: string
  readonly aspect: number
  readonly invert: boolean
  readonly dither: boolean
  readonly color: boolean
}

interface Bounds {
  readonly offsetX: number
  readonly offsetY: number
  readonly drawCols: number
  readonly drawRows: number
}

function fitBounds(image: RgbaImage, cols: number, rows: number, aspect: number): Bounds {
  const targetRows = image.height * (cols / image.width) * aspect
  if (targetRows <= rows) {
    const drawRows = Math.max(1, Math.round(targetRows))
    return { offsetX: 0, offsetY: Math.floor((rows - drawRows) / 2), drawCols: cols, drawRows }
  }
  const drawCols = Math.max(1, Math.round(image.width * (rows / (image.height * aspect))))
  return { offsetX: Math.floor((cols - drawCols) / 2), offsetY: 0, drawCols, drawRows: rows }
}

function average(image: RgbaImage, x0: number, y0: number, x1: number, y1: number): { r: number; g: number; b: number; a: number } {
  const left = Math.max(0, Math.min(image.width - 1, x0))
  const right = Math.max(left + 1, Math.min(image.width, x1))
  const top = Math.max(0, Math.min(image.height - 1, y0))
  const bottom = Math.max(top + 1, Math.min(image.height, y1))
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  let count = 0
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const index = (y * image.width + x) * 4
      const alpha = image.data[index + 3]
      r += image.data[index]
      g += image.data[index + 1]
      b += image.data[index + 2]
      a += alpha
      count++
    }
  }
  if (count === 0) return { r: 0, g: 0, b: 0, a: 0 }
  return { r: r / count, g: g / count, b: b / count, a: a / count }
}

/** Convert one RGBA image to a character grid, preserving aspect and color. */
export function imageToFrame(image: RgbaImage, options: GridOptions): GlyphFrame {
  const { cols, rows } = options
  if (!(image.width > 0) || !(image.height > 0)) throw new Error("image has no pixels")
  const ramp = options.ramp.length >= 2 ? options.ramp : " .:-=+*#%@"
  const bounds = fitBounds(image, cols, rows, options.aspect)
  const colors = options.color ? new Uint8Array(cols * rows * 3) : null
  const luminance = new Float32Array(cols * rows)
  const cells: Array<{ r: number; g: number; b: number; visible: boolean }> = []

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cellX = x - bounds.offsetX
      const cellY = y - bounds.offsetY
      if (cellX < 0 || cellX >= bounds.drawCols || cellY < 0 || cellY >= bounds.drawRows) {
        luminance[y * cols + x] = 0
        cells.push({ r: 0, g: 0, b: 0, visible: false })
        continue
      }
      const x0 = Math.floor((cellX / bounds.drawCols) * image.width)
      const x1 = Math.max(x0 + 1, Math.ceil(((cellX + 1) / bounds.drawCols) * image.width))
      const y0 = Math.floor((cellY / bounds.drawRows) * image.height)
      const y1 = Math.max(y0 + 1, Math.ceil(((cellY + 1) / bounds.drawRows) * image.height))
      const pixel = average(image, x0, y0, x1, y1)
      const visible = pixel.a >= 16
      const value = visible ? 0.2126 * pixel.r + 0.7152 * pixel.g + 0.0722 * pixel.b : 0
      luminance[y * cols + x] = (options.invert ? 255 - value : value) / 255
      cells.push({ r: Math.round(pixel.r), g: Math.round(pixel.g), b: Math.round(pixel.b), visible })
    }
  }

  if (options.dither) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const index = y * cols + x
        const old = luminance[index]
        const scaled = old * (ramp.length - 1)
        const chosen = Math.max(0, Math.min(ramp.length - 1, Math.round(scaled)))
        const error = scaled - chosen
        luminance[index] = chosen / (ramp.length - 1)
        const spread = (dx: number, dy: number, factor: number): void => {
          const tx = x + dx
          const ty = y + dy
          if (tx < 0 || tx >= cols || ty >= rows) return
          luminance[ty * cols + tx] += (error * factor) / (ramp.length - 1)
        }
        spread(1, 0, 7 / 16)
        spread(-1, 1, 3 / 16)
        spread(0, 1, 5 / 16)
        spread(1, 1, 1 / 16)
      }
    }
  }

  const lines: string[] = []
  for (let y = 0; y < rows; y++) {
    let line = ""
    for (let x = 0; x < cols; x++) {
      const index = y * cols + x
      const cell = cells[index]
      if (!cell?.visible) {
        line += " "
        continue
      }
      const value = luminance[index]
      const chosen = Math.max(0, Math.min(ramp.length - 1, Math.round(value * (ramp.length - 1))))
      const char = ramp[chosen]
      line += char === " " ? " " : char
      if (colors && char !== " ") {
        colors[index * 3] = cell.r
        colors[index * 3 + 1] = cell.g
        colors[index * 3 + 2] = cell.b
      }
    }
    lines.push(line)
  }

  return { cols, rows, chars: lines.join(""), colors }
}

/** Pick source frames at a fixed output rate over `loop` seconds. */
export function sampleAnimation(
  width: number,
  height: number,
  frames: readonly RgbaImage[],
  delays: readonly number[],
  fps: number,
  loop: number,
): RgbaImage[] {
  const total = Math.min(600, Math.max(1, Math.round(loop * fps)))
  const duration = delays.reduce((sum, delay) => sum + delay, 0)
  if (duration <= 0) return [frames[0]]
  const result: RgbaImage[] = []
  for (let index = 0; index < total; index++) {
    const time = (index / fps) * 1000
    let target = time % duration
    let chosen = 0
    for (let frame = 0; frame < delays.length; frame++) {
      target -= delays[frame]
      if (target < 0) {
        chosen = frame
        break
      }
    }
    result.push(frames[chosen] ?? { width, height, data: new Uint8ClampedArray(width * height * 4) })
  }
  return result
}
