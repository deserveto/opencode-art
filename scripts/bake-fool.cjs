// Dev-only: bakes the bundled Fool pack (chars + truecolor sidecars).
// Reads the artwork's own luminance and RGB fields, resamples them to any grid,
// quantizes colors for a small install, and writes art.json + frames.
//
// Usage:
//   NODE_PATH=<folder containing node_modules/playwright> node scripts/bake-fool.cjs [art-dir] [out-dir]
//
// Env: COLUMNS=180 LINES=50 FPS=10 LOOP=6 COLORS=64
// The artwork index.html is copied to a temp file and never edited.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const art = process.argv[2] || path.join(process.env.USERPROFILE || os.homedir(), "OneDrive", "Documents", "Project", "ASCII", "The Fool Argon")
const out = process.argv[3] || path.join(__dirname, "..", "frames", "fool")
const cols = Number(process.env.COLUMNS || 180)
const rows = Number(process.env.LINES || 50)
const fps = Number(process.env.FPS || 10)
const loopSeconds = Number(process.env.LOOP || 6)
const colorCount = Math.min(256, Math.max(2, Number(process.env.COLORS || 64)))

const levels = [0.048, 0.14, 0.265, 0.41, 0.57, 0.75]
const buckets = [" ", ".", ":;", "-~=", "+*x", "%#w", "@&W"]
const ramp = " .:;-~=+*x%#w@&W"
const seeds = new Uint32Array(cols * rows)
for (let i = 0; i < seeds.length; i++) {
  let seed = Math.imul(i + 1, 73856093) ^ Math.imul(i % cols, 19349663)
  seed = Math.imul(seed ^ (seed >>> 13), 1274126177)
  seeds[i] = (seed ^ (seed >>> 16)) >>> 0
}

function resample(field, channels, srcCols, srcRows, dstCols, dstRows) {
  const result = new Float32Array(dstCols * dstRows * channels)
  for (let y = 0; y < dstRows; y++) {
    const fy = (y / Math.max(1, dstRows - 1)) * (srcRows - 1)
    const y0 = Math.floor(fy)
    const y1 = Math.min(srcRows - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < dstCols; x++) {
      const fx = (x / Math.max(1, dstCols - 1)) * (srcCols - 1)
      const x0 = Math.floor(fx)
      const x1 = Math.min(srcCols - 1, x0 + 1)
      const tx = fx - x0
      for (let c = 0; c < channels; c++) {
        const a = field[(y0 * srcCols + x0) * channels + c] * (1 - tx) + field[(y0 * srcCols + x1) * channels + c] * tx
        const b = field[(y1 * srcCols + x0) * channels + c] * (1 - tx) + field[(y1 * srcCols + x1) * channels + c] * tx
        result[(y * dstCols + x) * channels + c] = a * (1 - ty) + b * ty
      }
    }
  }
  return result
}

function glyphs(luminance, time) {
  const shimmer = Math.floor(time * 5)
  const chars = new Uint8Array(cols * rows)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col
      let level = 0
      while (level < levels.length && luminance[index] >= levels[level]) level++
      if (level === 0) {
        chars[index] = 32
        continue
      }
      const bucket = buckets[level]
      const offset = level === levels.length && luminance[index] > 0.85 ? seeds[index] + shimmer : seeds[index]
      chars[index] = bucket.charCodeAt(offset % bucket.length)
    }
  }
  return chars
}

function shade(r, g, b, brightness) {
  const factor = 0.78 + 0.34 * brightness
  return [
    Math.min(255, Math.max(0, Math.round(r * factor * 255))),
    Math.min(255, Math.max(0, Math.round(g * factor * 255))),
    Math.min(255, Math.max(0, Math.round(b * factor * 255))),
  ]
}

function medianCut(entries, target) {
  if (entries.length === 0) return [[0, 0, 0]]
  let boxes = [entries]
  while (boxes.length < target) {
    let best = -1
    let bestRange = 0
    let bestChannel = 0
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      if (box.length < 2) continue
      for (let c = 0; c < 3; c++) {
        let min = 255
        let max = 0
        for (const entry of box) {
          const value = entry.rgb[c]
          if (value < min) min = value
          if (value > max) max = value
        }
        const range = (max - min) * (box.reduce((sum, entry) => sum + entry.count, 0) > 0 ? 1 : 0)
        if (range > bestRange) {
          bestRange = range
          best = i
          bestChannel = c
        }
      }
    }
    if (best < 0 || bestRange === 0) break
    const box = boxes[best]
    box.sort((a, b) => a.rgb[bestChannel] - b.rgb[bestChannel])
    const total = box.reduce((sum, entry) => sum + entry.count, 0)
    let running = 0
    let split = 1
    for (let i = 0; i < box.length - 1; i++) {
      running += box[i].count
      split = i + 1
      if (running >= total / 2) break
    }
    boxes.splice(best, 1, box.slice(0, split), box.slice(split))
  }
  return boxes.map((box) => {
    let r = 0
    let g = 0
    let b = 0
    let weight = 0
    for (const entry of box) {
      r += entry.rgb[0] * entry.count
      g += entry.rgb[1] * entry.count
      b += entry.rgb[2] * entry.count
      weight += entry.count
    }
    if (weight === 0) return [0, 0, 0]
    return [Math.round(r / weight), Math.round(g / weight), Math.round(b / weight)]
  })
}

function nearest(palette, r, g, b, cache) {
  const key = (r << 16) | (g << 8) | b
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < palette.length; i++) {
    const stop = palette[i]
    const dr = r - stop[0]
    const dg = g - stop[1]
    const db = b - stop[2]
    const distance = dr * dr + dg * dg + db * db
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  cache.set(key, best)
  return best
}

function writeSidecar(file, chars, colors, palette) {
  const cache = new Map()
  const lines = []
  for (let row = 0; row < rows; row++) {
    let line = ""
    let active = -1
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col
      const char = String.fromCharCode(chars[index])
      if (char === " ") {
        if (active !== -1) {
          line += "\x1b[0m"
          active = -1
        }
        line += " "
        continue
      }
      const r = colors[index * 3]
      const g = colors[index * 3 + 1]
      const b = colors[index * 3 + 2]
      const stop = nearest(palette, r, g, b, cache)
      if (stop !== active) {
        const [pr, pg, pb] = palette[stop]
        line += `\x1b[38;2;${pr};${pg};${pb}m`
        active = stop
      }
      line += char
    }
    if (active !== -1) line += "\x1b[0m"
    lines.push(line)
  }
  fs.writeFileSync(file, lines.join("\n"), "utf8")
}

async function main() {
  const { chromium } = require("playwright")
  const source = fs.readFileSync(path.join(art, "index.html"), "utf8")
  const marker = "window.__asciiMotionTest = {"
  if (!source.includes(marker)) throw new Error("Could not find the artwork hook; check the index.html version")
  const temporary = path.join(os.tmpdir(), `fool-bake-${process.pid}.html`)
  fs.writeFileSync(
    temporary,
    source.replace(marker, "window.__asciiDebug = { scene, luminance, rgb, columns, rows };\n  " + marker),
  )

  const framesDir = path.join(out, "frames")
  fs.mkdirSync(framesDir, { recursive: true })
  const total = loopSeconds * fps
  const baked = []

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
    await page.goto("file:///" + path.resolve(temporary).replace(/\\/g, "/"))
    await page.waitForFunction(() => Boolean(window.__asciiDebug), null, { timeout: 30000 })
    const native = await page.evaluate(() => ({ cols: window.__asciiDebug.columns, rows: window.__asciiDebug.rows }))

    for (let i = 0; i < total; i++) {
      const time = i / fps
      const field = await page.evaluate((t) => {
        window.__asciiDebug.scene(t)
        return {
          luminance: Array.from(window.__asciiDebug.luminance),
          rgb: Array.from(window.__asciiDebug.rgb),
        }
      }, time)
      const luminance = resample(field.luminance, 1, native.cols, native.rows, cols, rows)
      const rgb = resample(field.rgb, 3, native.cols, native.rows, cols, rows)
      const chars = glyphs(luminance, time)
      const colors = new Uint8Array(cols * rows * 3)
      for (let cell = 0; cell < cols * rows; cell++) {
        const [r, g, b] = shade(rgb[cell * 3], rgb[cell * 3 + 1], rgb[cell * 3 + 2], luminance[cell])
        colors[cell * 3] = r
        colors[cell * 3 + 1] = g
        colors[cell * 3 + 2] = b
      }
      baked.push({ chars, colors })
      if (i === 0) {
        console.log("Preview of frame 0 (every 2nd row/column):")
        for (let row = 0; row < rows; row += 2) {
          let line = ""
          for (let col = 0; col < cols; col += 2) line += String.fromCharCode(chars[row * cols + col])
          console.log(line)
        }
      }
    }

    const histogram = new Map()
    for (const frame of baked) {
      for (let cell = 0; cell < cols * rows; cell++) {
        if (frame.chars[cell] === 32) continue
        const r = frame.colors[cell * 3]
        const g = frame.colors[cell * 3 + 1]
        const b = frame.colors[cell * 3 + 2]
        const key = (r << 16) | (g << 8) | b
        const current = histogram.get(key)
        if (current) current.count++
        else histogram.set(key, { rgb: [r, g, b], count: 1 })
      }
    }
    const palette = medianCut([...histogram.values()], colorCount)
    console.log(`Quantized ${histogram.size} colors to ${palette.length}.`)

    let bytes = 0
    for (let i = 0; i < baked.length; i++) {
      const base = String(i).padStart(3, "0")
      const chars = baked[i].chars
      const text = []
      for (let row = 0; row < rows; row++) {
        let line = ""
        for (let col = 0; col < cols; col++) line += String.fromCharCode(chars[row * cols + col])
        text.push(line)
      }
      const body = text.join("\n")
      fs.writeFileSync(path.join(framesDir, `${base}.txt`), body, "utf8")
      writeSidecar(path.join(framesDir, `${base}.ans`), chars, baked[i].colors, palette)
      bytes += Buffer.byteLength(body) + fs.statSync(path.join(framesDir, `${base}.ans`)).size
    }

    const manifest = {
      schemaVersion: 1,
      id: "fool",
      name: "The Fool",
      description: "The Fool Argon, animated: a tarot figure on a sinking rock above a living ocean.",
      author: "sangh",
      license: "CC-BY-4.0",
      fps,
      cols,
      rows,
      defaultStyle: "mono",
      ramp,
      frames: "frames",
      source: { type: "artwork", note: "Baked from The Fool Argon by scripts/bake-fool.cjs" },
    }
    fs.writeFileSync(path.join(out, "art.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8")
    console.log(`Baked ${baked.length} frames (${cols}x${rows}, ${fps} fps) into ${out}; ${(bytes / 1024 / 1024).toFixed(2)} MB of frames.`)
  } finally {
    await browser.close()
    fs.rmSync(temporary, { force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
