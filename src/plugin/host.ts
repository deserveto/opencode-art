import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { RGBA } from "@opentui/core"
import type { ResolvedTheme } from "@opencode/theme/tui"
import type { RGBA4, ThemeColors } from "../render/types.ts"

export interface ArtRoots {
  readonly projectRoot: string
  readonly projectArts: string
  readonly globalArts: string
  readonly bundledFrames: string
}

export function configRoot(): string {
  return process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config")
}

export function artRoots(projectDirectory: string | undefined): ArtRoots {
  const projectRoot = projectDirectory ?? process.cwd()
  return {
    projectRoot,
    projectArts: path.join(projectRoot, ".opencode", "arts"),
    globalArts: path.join(configRoot(), "opencode", "arts"),
    bundledFrames: fileURLToPath(new URL("../../frames/", import.meta.url)),
  }
}

/** Host-wide motion preference; absent or unreadable means animations are on. */
export async function readAnimations(): Promise<boolean> {
  try {
    const text = await readFile(path.join(configRoot(), "opencode", "cli.json"), "utf8")
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === "object" && parsed !== null && "animations" in parsed) {
      return (parsed as { animations?: unknown }).animations !== false
    }
  } catch {
    // Missing or unreadable config falls back to the host default.
  }
  return true
}

function to4(color: RGBA): RGBA4 {
  return [Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255), Math.round(color.a * 255)]
}

export function themeColors(theme: ResolvedTheme): ThemeColors {
  return {
    faint: to4(theme.text.faint),
    muted: to4(theme.text.muted),
    base: to4(theme.text.base),
    background: to4(theme.background.base),
  }
}
