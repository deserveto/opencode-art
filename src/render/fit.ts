import type { FitMode, Grid } from "../art/types.ts"

function copyCell(
  grid: Grid,
  srcCols: number,
  srcX: number,
  srcY: number,
  outCols: number,
  destX: number,
  destY: number,
  outChars: string[],
  outColors: Uint8Array | null,
): void {
  const srcIndex = srcY * srcCols + srcX
  const destIndex = destY * outCols + destX
  outChars[destIndex] = grid.chars[srcIndex] ?? " "
  const colors = grid.colors
  if (outColors && colors) {
    const colorIndex = srcIndex * 3
    outColors[destIndex * 3] = colors[colorIndex] ?? 0
    outColors[destIndex * 3 + 1] = colors[colorIndex + 1] ?? 0
    outColors[destIndex * 3 + 2] = colors[colorIndex + 2] ?? 0
  }
}

/**
 * Fits a grid to `cols` × `rows` using the requested mode (`"stretch"`,
 * `"contain"`, `"cover"`, or `"center"`). Characters and colors use the same
 * source-cell mapping so they stay aligned. Pure and deterministic.
 */
export function fitGrid(grid: Grid, cols: number, rows: number, mode: FitMode = "stretch"): Grid {
  const outCols = Number.isFinite(cols) ? Math.max(0, Math.floor(cols)) : 0
  const outRows = Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : 0
  const cells = outCols * outRows
  const hasColors = grid.colors !== null

  if (cells === 0) {
    return { cols: outCols, rows: outRows, chars: "", colors: hasColors ? new Uint8Array(0) : null }
  }

  const srcCols = Number.isFinite(grid.cols) ? Math.max(0, Math.floor(grid.cols)) : 0
  const srcRows = Number.isFinite(grid.rows) ? Math.max(0, Math.floor(grid.rows)) : 0
  const outChars = new Array<string>(cells)
  const outColors = hasColors ? new Uint8Array(cells * 3) : null

  if (srcCols === 0 || srcRows === 0) {
    outChars.fill(" ")
    return { cols: outCols, rows: outRows, chars: outChars.join(""), colors: outColors }
  }

  if (mode === "contain") {
    outChars.fill(" ")
    const scale = Math.min(outCols / srcCols, outRows / srcRows)
    const drawCols = Math.max(1, Math.min(outCols, Math.round(srcCols * scale)))
    const drawRows = Math.max(1, Math.min(outRows, Math.round(srcRows * scale)))
    const offsetX = Math.floor((outCols - drawCols) / 2)
    const offsetY = Math.floor((outRows - drawRows) / 2)
    for (let dy = 0; dy < drawRows; dy++) {
      const srcY = Math.min(srcRows - 1, Math.floor(((dy + 0.5) * srcRows) / drawRows))
      for (let dx = 0; dx < drawCols; dx++) {
        const srcX = Math.min(srcCols - 1, Math.floor(((dx + 0.5) * srcCols) / drawCols))
        copyCell(grid, srcCols, srcX, srcY, outCols, offsetX + dx, offsetY + dy, outChars, outColors)
      }
    }
    return { cols: outCols, rows: outRows, chars: outChars.join(""), colors: outColors }
  }

  if (mode === "cover") {
    const scale = Math.max(outCols / srcCols, outRows / srcRows)
    const virtCols = Math.max(outCols, Math.round(srcCols * scale))
    const virtRows = Math.max(outRows, Math.round(srcRows * scale))
    const cropX = Math.floor((virtCols - outCols) / 2)
    const cropY = Math.floor((virtRows - outRows) / 2)
    for (let y = 0; y < outRows; y++) {
      const srcY = Math.min(srcRows - 1, Math.floor(((y + cropY + 0.5) * srcRows) / virtRows))
      for (let x = 0; x < outCols; x++) {
        const srcX = Math.min(srcCols - 1, Math.floor(((x + cropX + 0.5) * srcCols) / virtCols))
        copyCell(grid, srcCols, srcX, srcY, outCols, x, y, outChars, outColors)
      }
    }
    return { cols: outCols, rows: outRows, chars: outChars.join(""), colors: outColors }
  }

  if (mode === "center") {
    outChars.fill(" ")
    const offsetX = Math.floor((outCols - srcCols) / 2)
    const offsetY = Math.floor((outRows - srcRows) / 2)
    const startX = Math.max(0, offsetX)
    const endX = Math.min(outCols, offsetX + srcCols)
    const startY = Math.max(0, offsetY)
    const endY = Math.min(outRows, offsetY + srcRows)
    for (let y = startY; y < endY; y++) {
      const srcY = y - offsetY
      for (let x = startX; x < endX; x++) {
        copyCell(grid, srcCols, x - offsetX, srcY, outCols, x, y, outChars, outColors)
      }
    }
    return { cols: outCols, rows: outRows, chars: outChars.join(""), colors: outColors }
  }

  for (let y = 0; y < outRows; y++) {
    const srcY = Math.min(srcRows - 1, Math.floor(((y + 0.5) * srcRows) / outRows))
    for (let x = 0; x < outCols; x++) {
      const srcX = Math.min(srcCols - 1, Math.floor(((x + 0.5) * srcCols) / outCols))
      copyCell(grid, srcCols, srcX, srcY, outCols, x, y, outChars, outColors)
    }
  }

  return { cols: outCols, rows: outRows, chars: outChars.join(""), colors: outColors }
}
