import type { Grid } from "../art/types.ts"

/**
 * Nearest-neighbour resample to `cols` × `rows`. Characters and colors use the
 * same source-cell mapping so they stay aligned. Pure and deterministic.
 */
export function fitGrid(grid: Grid, cols: number, rows: number): Grid {
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

  const colors = grid.colors
  for (let y = 0; y < outRows; y++) {
    const srcY = Math.min(srcRows - 1, Math.floor(((y + 0.5) * srcRows) / outRows))
    for (let x = 0; x < outCols; x++) {
      const srcX = Math.min(srcCols - 1, Math.floor(((x + 0.5) * srcCols) / outCols))
      const srcIndex = srcY * srcCols + srcX
      const destIndex = y * outCols + x
      outChars[destIndex] = grid.chars[srcIndex] ?? " "
      if (outColors && colors) {
        const colorIndex = srcIndex * 3
        outColors[destIndex * 3] = colors[colorIndex] ?? 0
        outColors[destIndex * 3 + 1] = colors[colorIndex + 1] ?? 0
        outColors[destIndex * 3 + 2] = colors[colorIndex + 2] ?? 0
      }
    }
  }

  return { cols: outCols, rows: outRows, chars: outChars.join(""), colors: outColors }
}
