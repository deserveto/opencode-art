/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { STYLE_NAMES, type StyleName } from "../art/types.ts"
import type { ArtState } from "../plugin/state.ts"
import { ArtCreateDialog } from "./create-dialog.tsx"
import { ArtDialog } from "./dialog.tsx"
import { parseArtCommand } from "./parse.ts"
import {
  CREATE_TEMPLATE_KINDS,
  artHelp,
  captureFocusedEditor,
  openCreateArtPrompt,
  resolvePromptTemplate,
  safeAlert,
  type EditablePromptTarget,
} from "./templates.ts"

export { artHelp, openCreateArtPrompt }

type Context = Plugin.Context

export function openCreateArtDialog(
  context: Context,
  state: ArtState,
  options?: {
    readonly template?: string
    readonly source?: string
    readonly preferredEditor?: EditablePromptTarget | null
  },
): void {
  const editor = options?.preferredEditor ?? captureFocusedEditor(context)
  if (options?.template && !options.source && !resolvePromptTemplate(options.template)) {
    context.ui.toast.show({
      message: `Usage: /art create [${CREATE_TEMPLATE_KINDS.join("|")}]`,
      variant: "warning",
    })
    return
  }
  try {
    state.refreshTheme()
    context.ui.dialog.show(() => (
      <ArtCreateDialog
        context={context}
        state={state}
        theme={context.theme}
        formatPath={(value) => context.ui.format.path(value)}
        close={() => context.ui.dialog.clear()}
        preferredEditor={editor}
        initialTemplate={options?.template}
        initialSource={options?.source}
      />
    ))
    context.ui.dialog.set({ size: "large", centered: true })
  } catch (error) {
    context.ui.toast.show({
      message: `Could not open the create dialog: ${error instanceof Error ? error.message : String(error)}`,
      variant: "error",
    })
  }
}

export function openArtDialog(context: Context, state: ArtState): void {
  const editor = captureFocusedEditor(context)
  try {
    state.refreshTheme()
    // show() resets presentation to medium; apply the size after it opens.
    context.ui.dialog.show(() => (
      <ArtDialog
        state={state}
        theme={context.theme}
        formatPath={(value) => context.ui.format.path(value)}
        close={() => context.ui.dialog.clear()}
        onCreate={() => {
          openCreateArtDialog(context, state, { preferredEditor: editor })
        }}
      />
    ))
    context.ui.dialog.set({ size: "xlarge", centered: true })
  } catch (error) {
    context.ui.toast.show({
      message: `Could not open the art dialog: ${error instanceof Error ? error.message : String(error)}`,
      variant: "error",
    })
  }
}

function isStyle(value: string | undefined): value is StyleName {
  return typeof value === "string" && (STYLE_NAMES as readonly string[]).includes(value)
}

export async function runArtCommand(context: Context, state: ArtState, input?: string): Promise<void> {
  const command = parseArtCommand(input)
  const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") =>
    context.ui.toast.show({ message, variant })

  switch (command.kind) {
    case "dialog":
      openArtDialog(context, state)
      return
    case "create":
      openCreateArtDialog(context, state, { template: command.template, source: command.source })
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
    case "dim": {
      const value = Number(command.value)
      if (!command.value || !Number.isFinite(value)) {
        toast("Usage: /art dim <0-80>", "warning")
        return
      }
      await state.setDim(value)
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
