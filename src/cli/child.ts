import { spawn } from "node:child_process"

export interface ChildOptions {
  readonly timeoutMs: number
  readonly env?: NodeJS.ProcessEnv
  readonly collectStdout?: boolean
}

export interface ChildResult {
  readonly code: number | null
  readonly stdout: Buffer
  readonly stderr: string
  readonly timedOut: boolean
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" })
  } else {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // Already gone.
    }
  }
}

export function runChild(command: string, args: readonly string[], options: ChildOptions): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
    }, options.timeoutMs)

    child.stdout?.on("data", (chunk: Buffer) => {
      if (options.collectStdout !== false) stdout.push(chunk)
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8")
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (timedOut) {
        resolve({ code, stdout: Buffer.concat(stdout), stderr, timedOut: true })
        return
      }
      resolve({ code, stdout: Buffer.concat(stdout), stderr, timedOut: false })
    })
  })
}
