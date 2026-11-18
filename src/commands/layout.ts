export interface PreviewBox {
  readonly width: number
  readonly height: number
  readonly wide: boolean
}

/** The host caps xlarge at 116 cells; subtract the dialog border and padding. */
export function fitDialogWidth(terminalWidth: number): number {
  return Math.max(40, Math.min(112, terminalWidth - 6))
}

/** Fit the preview pane inside the dialog, stacking it under the list when narrow. */
export function previewBox(
  terminalWidth: number,
  pack: { readonly cols: number; readonly rows: number } | null,
): PreviewBox {
  const dialog = fitDialogWidth(terminalWidth)
  const wide = dialog >= 100
  // Wide: 34-cell list, 1 gap, 4 cells of preview border/padding.
  const room = wide ? dialog - 43 : dialog - 8
  const width = Math.max(20, Math.min(64, room))
  const cap = wide ? 22 : 14
  const height = pack ? Math.max(6, Math.min(cap, Math.round((pack.rows * width) / pack.cols))) : 12
  return { width, height, wide }
}
