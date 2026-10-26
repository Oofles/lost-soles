// Ticket 0112 — the smallest Chrome DevTools Protocol client that will do: launch headless Chromium
// with a debugging port, open one page, send commands, close. No dependency: Node 22's global
// WebSocket speaks the protocol, and the repo carries no Playwright or Puppeteer on purpose.
//
// Why CDP and not `--dump-dom` like `tools/fog-harness`: the two 0112 checks need what a flag cannot
// give. Reduced motion needs `Emulation.setEmulatedMedia` and REAL time — rAF does not run under
// `--virtual-time-budget` (fog-harness/README.md). 200% zoom needs `setDeviceMetricsOverride` at a
// device scale factor of 2, which is exactly what browser zoom does to a 1280px window: a 640 CSS px
// viewport drawn at 2 device pixels per CSS pixel.
//
// On WSL, CHROMIUM=/snap/bin/chromium (the default here), and pages must live under $HOME, which
// `harnessWorkdir` guarantees.
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"

const CHROMIUM = process.env.CHROMIUM ?? "/snap/bin/chromium"

/** Launch Chromium, attach to its first page target, and hand back `send` and `close`. */
export async function launch({ profileDir }) {
  const profile = mkdtempSync(join(profileDir, "profile-"))
  const proc = spawn(
    CHROMIUM,
    [
      "--headless",
      "--no-sandbox",
      "--no-first-run",
      "--enable-unsafe-swiftshader",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  )
  const wsBrowser = await new Promise((resolve, reject) => {
    let err = ""
    const t = setTimeout(() => reject(new Error(`chromium did not start:\n${err.slice(-2000)}`)), 30_000)
    proc.stderr.on("data", (d) => {
      err += d
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err)
      if (m) {
        clearTimeout(t)
        resolve(m[1])
      }
    })
    proc.on("exit", (code) => reject(new Error(`chromium exited ${code}:\n${err.slice(-2000)}`)))
  })
  const port = new URL(wsBrowser).port
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((t) => t.type === "page")
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)))

  let id = 0
  const pending = new Map()
  const listeners = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data ?? ""}`))
      else resolve(msg.result)
    } else if (msg.method) {
      for (const l of listeners) l(msg)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id
      pending.set(n, { resolve, reject })
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  const once = (method) => new Promise((resolve) => listeners.push((m) => m.method === method && resolve(m.params)))

  /** Evaluate an expression in the page and return its value (awaiting a promise). */
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`page threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result.value
  }

  /**
   * `Browser.close`, then wait for the process to go, THEN remove the profile. A SIGKILL reaches only
   * the snap wrapper, and the browser behind it goes on writing into the profile for a moment after
   * an immediate `rm` — which leaves it behind under tmp/ (memory: tmp leftovers break the guards).
   */
  const close = async () => {
    const exited = new Promise((r) => (proc.exitCode !== null ? r() : proc.once("exit", r)))
    try {
      const b = new WebSocket(wsBrowser)
      await new Promise((r, j) => ((b.onopen = r), (b.onerror = j)))
      b.send(JSON.stringify({ id: 1, method: "Browser.close" }))
    } catch {
      proc.kill("SIGKILL")
    }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))])
    try {
      ws.close()
    } catch {}
    rmSync(profile, { recursive: true, force: true })
  }
  await send("Page.enable")
  await send("Runtime.enable")
  return { send, once, evaluate, close }
}
