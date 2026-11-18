import { Plugin } from "@opencode/plugin"
import type { Skill } from "@opencode/plugin"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const SKILL_URL = new URL("./skills/opencode-art/SKILL.md", import.meta.url)

/** Skill.Info uses branded schema types; the values are plain strings. */
function embeddedSkill(path: string, content: string): Skill.Info {
  return {
    id: "opencode-art",
    name: "opencode-art",
    description:
      "Create and edit animated ASCII art packs for the opencode-art home-screen background: pack format, scene API, CLI bake/validate/preview.",
    path,
    content,
  } as unknown as Skill.Info
}

export default Plugin.define({
  id: "opencode-art.server",
  async setup(context) {
    let content: string
    let path: string
    try {
      path = fileURLToPath(SKILL_URL)
      content = await readFile(SKILL_URL, "utf8")
    } catch {
      return
    }
    await context.skill.transform((editor) => {
      editor.add(embeddedSkill(path, content))
    })
  },
})
