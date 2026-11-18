export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

export function hexToRgb(hex: string): Rgb | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  }
}

export function rgbToHex(color: Rgb): string {
  const part = (value: number): string => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, "0")
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`
}

interface Entry {
  r: number
  g: number
  b: number
  count: number
}

function histogram(samples: Uint8Array): Entry[] {
  const map = new Map<number, Entry>()
  for (let index = 0; index + 2 < samples.length; index += 3) {
    const r = samples[index]
    const g = samples[index + 1]
    const b = samples[index + 2]
    const key = (r << 16) | (g << 8) | b
    const entry = map.get(key)
    if (entry) entry.count++
    else map.set(key, { r, g, b, count: 1 })
  }
  return [...map.values()]
}

/** Median-cut palette over packed RGB samples. Deterministic. */
export function buildPalette(samples: Uint8Array, target: number): Rgb[] {
  const entries = histogram(samples)
  if (entries.length === 0) return [{ r: 0, g: 0, b: 0 }]
  let boxes: Entry[][] = [entries]
  while (boxes.length < Math.max(2, target)) {
    let bestIndex = -1
    let bestRange = 0
    let bestChannel: "r" | "g" | "b" = "r"
    for (let index = 0; index < boxes.length; index++) {
      const box = boxes[index]
      if (box.length < 2) continue
      for (const channel of ["r", "g", "b"] as const) {
        let min = 255
        let max = 0
        for (const entry of box) {
          const value = entry[channel]
          if (value < min) min = value
          if (value > max) max = value
        }
        const range = max - min
        if (range > bestRange) {
          bestRange = range
          bestIndex = index
          bestChannel = channel
        }
      }
    }
    if (bestIndex < 0 || bestRange === 0) break
    const box = boxes[bestIndex]
    box.sort((a, b) => a[bestChannel] - b[bestChannel])
    const total = box.reduce((sum, entry) => sum + entry.count, 0)
    let running = 0
    let split = 1
    for (let index = 0; index < box.length - 1; index++) {
      running += box[index].count
      split = index + 1
      if (running >= total / 2) break
    }
    boxes = [...boxes.slice(0, bestIndex), box.slice(0, split), box.slice(split), ...boxes.slice(bestIndex + 1)]
  }
  return boxes.map((box) => {
    let r = 0
    let g = 0
    let b = 0
    let weight = 0
    for (const entry of box) {
      r += entry.r * entry.count
      g += entry.g * entry.count
      b += entry.b * entry.count
      weight += entry.count
    }
    if (weight === 0) return { r: 0, g: 0, b: 0 }
    return { r: Math.round(r / weight), g: Math.round(g / weight), b: Math.round(b / weight) }
  })
}

export function nearestIndex(palette: readonly Rgb[], r: number, g: number, b: number): number {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < palette.length; index++) {
    const stop = palette[index]
    const dr = r - stop.r
    const dg = g - stop.g
    const db = b - stop.b
    const distance = dr * dr + dg * dg + db * db
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  }
  return best
}
