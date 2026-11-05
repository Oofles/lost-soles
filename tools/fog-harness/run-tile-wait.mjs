#!/usr/bin/env node
// Ticket 0313 — the fog layer is added and draws while every basemap tile request is held open.
// Bundles tile-wait-harness.js (a real Map, the shipped basemap style and FogMaskLayer) with esbuild,
// runs it in headless Chromium on SwiftShader, and reports whether `style.load` reaches the fog while
// `load` (all tiles in) never fires. See the harness for the control case.
//
//   node tools/fog-harness/run-tile-wait.mjs
//
// REAL TIME, OVER THE DEVTOOLS PROTOCOL, FROM A THROWAWAY SERVER — `tune.mjs`'s setup, for its
// reasons: this harness needs tiles REQUESTED, which needs MapLibre's worker, which cannot start from
// file:// and does not run its message loop under `--virtual-time-budget`. The worker is bundled to
// one file and handed over as a blob.
import { execFileSync, spawn } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { harnessWorkdir } from "./workdir.mjs"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const work = harnessWorkdir("fog-0313-tile-wait")
const esbuild = join(ROOT, "node_modules/.bin/esbuild")

execFileSync(
  esbuild,
  [join(ROOT, "tools/fog-harness/tile-wait-harness.js"), "--bundle", "--format=iife", "--target=es2020",
   "--loader:.ts=ts", `--outfile=${join(work, "bundle.js")}`, "--log-level=warning"],
  { stdio: "inherit" },
)
execFileSync(
  esbuild,
  [join(ROOT, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"), "--bundle", "--format=esm",
   "--target=es2020", `--outfile=${join(work, "worker.js")}`, "--log-level=warning"],
  { stdio: "inherit" },
)
writeFileSync(join(work, "worker.cfg.js"), `window.__WORKER=${JSON.stringify(readFileSync(join(work, "worker.js"), "utf8"))}`)
// Separate classic scripts rather than inline: a large bundle inlined into HTML can contain `<!--`
// and `<script` sequences that throw the tokenizer into script-escaped states (`tune.mjs`).
writeFileSync(
  join(work, "harness.html"),
  `<!doctype html><meta charset="utf-8"><title>pending</title>
<style>html,body{margin:0}#map{width:1280px;height:800px}</style>
<body><div id="map"></div><pre id="out">pending</pre>
<script src="worker.cfg.js"></script>
<script src="bundle.js"></script></body>`,
)

const PORT = 8100 + Math.floor(Math.random() * 800)
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", work], { stdio: "ignore" })
const DT_PORT = PORT + 1000
const chromium = spawn(process.env.CHROMIUM ?? "/snap/bin/chromium", [
  "--headless", "--no-sandbox", "--enable-unsafe-swiftshader", "--hide-scrollbars",
  `--user-data-dir=${join(work, "profile")}`, "--window-size=1280,800",
  `--remote-debugging-port=${DT_PORT}`, "about:blank",
], { stdio: "ignore" })
const stop = () => { chromium.kill(); server.kill() }
process.on("exit", stop)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i++) {
  await sleep(500)
  try { target = (await (await fetch(`http://127.0.0.1:${DT_PORT}/json`)).json()).find((t) => t.type === "page") } catch {}
}
if (!target) throw new Error("chromium never exposed a DevTools page")
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener("open", r, { once: true }))
let seq = 0
const pending = new Map()
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => (await cdp("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value ?? ""

await cdp("Page.navigate", { url: `http://127.0.0.1:${PORT}/harness.html` })
let title = ""
for (let i = 0; i < 120 && !title.startsWith("TILE WAIT"); i++) {
  await sleep(500)
  title = await evaluate("document.title")
}
const text = title.startsWith("TILE WAIT")
  ? await evaluate("document.getElementById('out').textContent")
  : `(the harness never reported; title "${title}")`
console.log(text)
ws.close()
// Wait for chromium to go before exiting: the workdir's exit-time `rmSync` races a profile chromium
// is still writing, and fails with ENOTEMPTY.
const gone = new Promise((r) => chromium.once("exit", r))
stop()
await Promise.race([gone, sleep(5000)])
process.exit(/^TILE WAIT HARNESS PASS/.test(text.trim()) ? 0 : 1)
