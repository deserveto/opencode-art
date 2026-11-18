/**
 * Author-time helpers for scene modules. These run only inside the CLI child
 * process. The plugin never imports this module or any scene.
 */

export interface SceneGrid {
  chars: string[]
  colors?: Array<Array<string | null>>
}

const DENSITY = " .:-=+*#%@"

export function clamp(value: number, min = 0, max = 1): number {
  return value < min ? min : value > max ? max : value
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t)
}

/** Deterministic 32-bit hash in [0, 1). */
export function noise(seed: number): (index: number) => number {
  return (index: number): number => {
    let n = Math.imul(index + 1 + Math.imul(seed | 0, 0x9e3779b9), 0x85ebca6b)
    n ^= n >>> 13
    n = Math.imul(n, 0xc2b2ae35)
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296
  }
}

export function palette(stops: readonly string[]): readonly string[] {
  return stops.map((stop) => stop.toLowerCase())
}

/** Parse a canvas into a scene grid; exact dimensions are required. */
export function loadCanvas(text: string, cols: number, rows: number): SceneGrid {
  const body = text.replace(/\r\n/g, "\n").replace(/\n$/, "")
  const lines = body.split("\n")
  if (lines.length !== rows) throw new Error(`loadCanvas: expected ${rows} rows, found ${lines.length}`)
  for (let y = 0; y < rows; y++) {
    if (lines[y].length !== cols) {
      throw new Error(`loadCanvas: row ${y + 1} expected ${cols} columns, found ${lines[y].length}`)
    }
  }
  return { chars: lines }
}

const wrap = (v: number, n: number): number => (n <= 0 ? 0 : ((v % n) + n) % n)

function size(grid: SceneGrid): { cols: number; rows: number } {
  const rows = grid.chars.length
  const cols = grid.chars[0]?.length ?? 0
  return { cols, rows }
}

function copyGrid(grid: SceneGrid): SceneGrid {
  return {
    chars: [...grid.chars],
    ...(grid.colors ? { colors: grid.colors.map((row) => [...row]) } : {}),
  }
}

/** Shift cells along an axis by a sine offset. Dimensions never change. */
export function wave(grid: SceneGrid, time: number, options: { axis?: "x" | "y"; amplitude?: number; speed?: number } = {}): SceneGrid {
  const { cols, rows } = size(grid)
  const axis = options.axis ?? "y"
  const amplitude = Math.max(0, options.amplitude ?? 2)
  const speed = options.speed ?? 1
  const result: SceneGrid = {
    chars: Array.from({ length: rows }, () => " ".repeat(cols)),
    ...(grid.colors ? { colors: Array.from({ length: rows }, () => Array<string | null>(cols).fill(null)) } : {}),
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const phase = axis === "x" ? y : x
      const offset = Math.round(Math.sin(time * speed * Math.PI * 2 + phase * 0.25) * amplitude)
      const fromX = axis === "x" ? wrap(x - offset, cols) : x
      const fromY = axis === "y" ? wrap(y - offset, rows) : y
      const char = grid.chars[fromY]?.[fromX] ?? " "
      result.chars[y] = `${result.chars[y].slice(0, x)}${char}${result.chars[y].slice(x + 1)}`
      if (grid.colors && result.colors) result.colors[y][x] = grid.colors[fromY]?.[fromX] ?? null
    }
  }
  return result
}

/** Sparkle: swap cells with their neighbour when the hash says so. */
export function shimmer(grid: SceneGrid, time: number, options: { seed?: number; intensity?: number } = {}): SceneGrid {
  const { cols } = size(grid)
  const result = copyGrid(grid)
  const random = noise(options.seed ?? 0)
  const intensity = clamp(options.intensity ?? 0.25)
  const step = Math.floor(time * 5)
  for (let y = 0; y < grid.chars.length; y++) {
    for (let x = 0; x < cols; x++) {
      if (random(y * cols + x + step * 31) > intensity) continue
      if (x + 1 >= cols) continue
      const left = result.chars[y][x]
      result.chars[y] = `${result.chars[y].slice(0, x)}${result.chars[y][x + 1]}${left}${result.chars[y].slice(x + 2)}`
      if (result.colors) {
        const next = result.colors[y][x + 1]
        result.colors[y][x + 1] = result.colors[y][x]
        result.colors[y][x] = next
      }
    }
  }
  return result
}

/** Wrapped scroll along an axis. */
export function drift(grid: SceneGrid, time: number, options: { axis?: "x" | "y"; speed?: number } = {}): SceneGrid {
  const { cols, rows } = size(grid)
  const axis = options.axis ?? "x"
  const shift = Math.round(time * (options.speed ?? 1) * 4)
  const result: SceneGrid = { chars: [], ...(grid.colors ? { colors: [] } : {}) }
  for (let y = 0; y < rows; y++) {
    let line = ""
    const colors: Array<string | null> = []
    for (let x = 0; x < cols; x++) {
      const fromX = axis === "x" ? wrap(x - shift, cols) : x
      const fromY = axis === "y" ? wrap(y - shift, rows) : y
      line += grid.chars[fromY][fromX]
      if (grid.colors) colors.push(grid.colors[fromY][fromX])
    }
    result.chars.push(line)
    if (grid.colors) result.colors?.push(colors)
  }
  return result
}

/** Sparse cells fade to a space and back. */
export function twinkle(grid: SceneGrid, time: number, options: { seed?: number; intensity?: number; speed?: number } = {}): SceneGrid {
  const { cols } = size(grid)
  const random = noise(options.seed ?? 0)
  const intensity = clamp(options.intensity ?? 0.08)
  const speed = options.speed ?? 1
  const result = copyGrid(grid)
  for (let y = 0; y < grid.chars.length; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid.chars[y][x] === " ") continue
      const value = random(y * cols + x)
      if (value > intensity) continue
      const blink = Math.sin(time * speed * Math.PI * 2 + value * 40) > 0
      if (!blink) continue
      result.chars[y] = `${result.chars[y].slice(0, x)} ${result.chars[y].slice(x + 1)}`
      if (result.colors) result.colors[y][x] = null
    }
  }
  return result
}

/** A moving band nudges glyphs up or down the built-in density ramp. */
export function scanline(grid: SceneGrid, time: number, options: { axis?: "x" | "y"; speed?: number; intensity?: number } = {}): SceneGrid {
  const { cols } = size(grid)
  const axis = options.axis ?? "y"
  const speed = options.speed ?? 1
  const intensity = clamp(options.intensity ?? 0.4)
  const result = copyGrid(grid)
  const span = axis === "x" ? cols : grid.chars.length
  const center = ((time * speed * 10) % span + span) % span
  for (let y = 0; y < grid.chars.length; y++) {
    for (let x = 0; x < cols; x++) {
      const position = axis === "x" ? x : y
      const distance = Math.abs(position - center)
      if (distance > Math.max(1, Math.round(intensity * 4))) continue
      const char = grid.chars[y][x]
      const index = DENSITY.indexOf(char)
      if (index < 0) continue
      const next = distance < intensity * 2 ? Math.min(DENSITY.length - 1, index + 1) : Math.max(0, index - 1)
      result.chars[y] = `${result.chars[y].slice(0, x)}${DENSITY[next]}${result.chars[y].slice(x + 1)}`
    }
  }
  return result
}
