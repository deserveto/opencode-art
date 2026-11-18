import type { Plugin } from "@opencode/plugin/tui"
import { STYLE_NAMES, type StyleName } from "../art/types.ts"
import type { ArtState } from "../plugin/state.ts"
import { ArtDialog } from "./dialog.tsx"
import { parseArtCommand } from "./parse.ts"

type Context = Plugin.Context

export function openArtDialog(context: Context, state: ArtState): void {
  try {
    state.refreshTheme()
    context.ui.dialog.set({ size: "xlarge", centered: true })
    context.ui.dialog.show(() => (
      <ArtDialog state={state} theme={context.theme} close={() => context.ui.dialog.clear()} />
    ))
  } catch (error) {
    context.ui.toast.show({
      message: `Could not open the art dialog: ${error instanceof Error ? error.message : String(error)}`,
      variant: "error",
    })
  }
}

export function artHelp(state: ArtState): string {
  return [
    "/art                 open the art browser",
    "/art on | off | toggle",
    "/art next            next pack in scope order",
    "/art set <id>        select a pack",
    "/art style <mono|theme|palette|original>",
    "/art fps <1-30>",
    "/art reload          re-scan packs",
    "/art validate [id|path]",
    "/art help",
    "",
    `project  ${state.roots.projectArts}`,
    `user     ${state.roots.globalArts}`,
    `bundled  ${state.roots.bundledFrames}`,
    "",
    "Create art by asking the agent in chat (opencode-art skill).",
  ].join("\n")
}

function isStyle(value: string | undefined): value is StyleName {
  return typeof value === "string" && (STYLE_NAMES as readonly string[]).includes(value)
}

async function safeAlert(context: Context, title: string, message: string): Promise<void> {
  try {
    await context.ui.dialog.alert({ title, message })
  } catch (error) {
    context.ui.toast.show({
      message: `${title}: ${message.split("\n")[0] ?? ""} (${error instanceof Error ? error.message : String(error)})`,
      variant: "error",
    })
  }
}

export async function runArtCommand(context: Context, state: ArtState, input?: string): Promise<void> {
  const command = parseArtCommand(input)
  const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") =>
    context.ui.toast.show({ message, variant })

  switch (command.kind) {
    case "dialog":
      openArtDialog(context, state)
      return
    case "help":
      await safeAlert(context, "opencode-art", artHelp(state))
      return
    case "on":
    case "off": {
      const want = command.kind === "on"
      await state.setEnabled(want)
      if (state.enabled() === want) toast(want ? "Art on" : "Art off", "success")
      return
    }
    case "toggle": {
      const want = !state.enabled()
      await state.toggleEnabled()
      if (state.enabled() === want) toast(want ? "Art on" : "Art off", "success")
      return
    }
    case "next":
      await state.next()
      return
    case "set":
      if (!command.id) {
        toast("Usage: /art set <id>. Open /art to browse packs.", "warning")
        return
      }
      await state.setPack(command.id)
      return
    case "style":
      if (!isStyle(command.style)) {
        toast(`Usage: /art style <${STYLE_NAMES.join("|")}>`, "warning")
        return
      }
      await state.setStyle(command.style)
      return
    case "fps": {
      const value = Number(command.value)
      if (!command.value || !Number.isFinite(value)) {
        toast("Usage: /art fps <1-30>", "warning")
        return
      }
      await state.setFps(value)
      return
    }
    case "reload": {
      await state.reload()
      const active = state.activeId() ?? "none"
      toast(
        `Reloaded ${active}: ${state.candidates().length} pack(s), ${state.problems().length} problem(s).`,
        "success",
      )
      return
    }
    case "validate": {
      const report = await state.validate(command.target)
      const errors = report.lines.filter((line) => !line.endsWith(": valid"))
      if (report.ok) {
        if (state.candidates().length === 0 && !command.target) {
          toast("No packs found.", "warning")
          return
        }
        if (report.warnings.length > 0) {
          if (command.target) {
            await safeAlert(context, "opencode-art validation", ["valid", ...report.warnings].join("\n"))
          } else {
            toast(
              `All packs valid, ${report.warnings.length} warning(s). Run /art validate <id> for detail.`,
              "warning",
            )
          }
          return
        }
        toast(command.target ? `${command.target}: valid` : "All packs valid.", "success")
        return
      }
      for (const line of errors) console.error(`[opencode-art] ${line}`)
      const detail = [...errors, ...report.warnings]
      if (command.target) {
        await safeAlert(context, "opencode-art validation", detail.slice(0, 40).join("\n"))
        return
      }
      toast(
        `${errors.length} issue(s)${report.warnings.length ? `, ${report.warnings.length} warning(s)` : ""}. Details are in /art → Problems.`,
        "error",
      )
      openArtDialog(context, state)
      return
    }
    case "unknown":
      toast(`Unknown command "${command.input}". Try /art help.`, "warning")
      return
  }
}
