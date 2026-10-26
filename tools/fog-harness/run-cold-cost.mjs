#!/usr/bin/env node
// Ticket 0298 — the real-GPU cost of atlas's cold pass (D-391), against the cold weight at 0.
//
//   node tools/fog-harness/run-cold-cost.mjs [--size=1920x1080] [--dpr=1] [--dataset=150k]
//
// UNLIKE EVERY OTHER RUNNER HERE, THIS ONE IS HEADED AND ON A REAL CLOCK. The question is a frame-
// time question (05 §6.4 items 2 and 3) and `--virtual-time-budget` cannot answer it; SwiftShader
// cannot price a frame copy either. So it opens a real window — on WSL2 that is WSLg, whose Mesa
// D3D12 driver puts ANGLE on the host GPU — drives `cold-cost-harness.js` over the DevTools
// protocol, and refuses to report a figure when the renderer string says software (SwiftShader,
// llvmpipe): a CPU rasteriser's number recorded as the real-GPU one would be worse than none.
//
// Env: GALLIUM_DRIVER (default d3d12 — WSLg's Mesa otherwise picks llvmpipe), CHROMIUM (default /snap/bin/chromium, which is the one that reaches the GPU here),
// MESA_D3D12_DEFAULT_ADAPTER_NAME (passed through: e.g. NVIDIA to pick a discrete card over an iGPU).
// Exit 0 on `COLD COST PASS`.
import { execFileSync, spawn } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { harnessWorkdir } from "./workdir.mjs"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback
const [W, H] = arg("size", "1920x1080").split("x").map(Number)
const DPR = Number(arg("dpr", "1"))
const DATASET = arg("dataset", "150k")
const PORT = 9300 + Math.floor(Math.random() * 500)

const work = harnessWorkdir("fog-0298-cold-cost")
execFileSync(
  join(ROOT, "node_modules/.bin/esbuild"),
  [
    join(ROOT, "tools/fog-harness/cold-cost-harness.js"),
    "--bundle",
    "--format=iife",
    "--target=es2020",
    "--loader:.ts=ts",
    `--outfile=${join(work, "bundle.js")}`,
  ],
  { stdio: "inherit" },
)
const fixture = readFileSync(join(ROOT, `public/fog-fixtures/fog-${DATASET}.bin`)).toString("base64")
const page = join(work, "cold-cost.html")
writeFileSync(
  page,
  `<!doctype html><title>0298 cold cost</title>
<style>html,body{margin:0;overflow:hidden}#map{position:fixed;inset:0}
#out{position:fixed;left:0;top:0;margin:0;font:11px monospace;background:#fffd;max-height:100vh;overflow:auto}</style>
<body><div id="map"></div><pre id="out">pending</pre>
<script>window.FOG_FIXTURE_B64 = "${fixture}"</script>
<script>${readFileSync(join(work, "bundle.js"), "utf8")}</script></body>`,
)

const browser = spawn(
  process.env.CHROMIUM ?? "/snap/bin/chromium",
  [
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--ignore-gpu-blocklist",
    // A hidden or occluded window gets its rAF throttled, which would measure the throttle.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    `--user-data-dir=${join(work, "profile")}`,
    `--remote-debugging-port=${PORT}`,
    `--window-size=${W},${H}`,
    `--force-device-scale-factor=${DPR}`,
    `--app=file://${page}`,
  ],
  {
    stdio: "ignore",
    // WSLg's Mesa defaults to llvmpipe (a CPU rasteriser); d3d12 is the driver that reaches the host
    // GPU through /dev/dxg. Harmless off WSL: Mesa ignores a driver it does not have.
    env: { ...process.env, GALLIUM_DRIVER: process.env.GALLIUM_DRIVER ?? "d3d12" },
  },
)
const kill = () => {
  try {
    browser.kill("SIGTERM")
  } catch {}
}
process.on("exit", kill)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const found = list.find((t) => t.type === "page" && t.url.includes("cold-cost.html"))
      if (found) return found.webSocketDebuggerUrl
    } catch {}
    await wait(500)
  }
  throw new Error("chromium never exposed the page over DevTools")
}

const ws = new WebSocket(await target())
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})
let id = 0
const pending = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}
async function evaluate(expression) {
  const msgId = ++id
  const reply = new Promise((resolve) => pending.set(msgId, resolve))
  ws.send(JSON.stringify({ id: msgId, method: "Runtime.evaluate", params: { expression, returnByValue: true } }))
  return (await reply).result?.result?.value
}

const renderer = await evaluate(`(() => {
  const gl = document.createElement("canvas").getContext("webgl2")
  if (!gl) return "no webgl2"
  const info = gl.getExtension("WEBGL_debug_renderer_info")
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
})()`)
if (/swiftshader|llvmpipe|softpipe|software/i.test(String(renderer))) {
  console.error(`COLD COST REFUSED: the renderer is software (${renderer}).`)
  console.error("A CPU rasteriser cannot answer a real-GPU question; no figure is recorded.")
  process.exit(2)
}

const deadline = Date.now() + 10 * 60_000
let text = ""
for (;;) {
  text = String(await evaluate(`document.getElementById("out").textContent`))
  if (/^COLD COST (PASS|FAIL)/.test(text)) break
  if (Date.now() > deadline) {
    console.error(`COLD COST FAIL: timed out at "${text.split("\n")[0]}"`)
    process.exit(1)
  }
  await wait(1000)
}
console.log(text)
ws.close()
// Wait for chromium to let go of its profile, or the workdir cleanup races its last writes.
const exited = new Promise((resolve) => browser.once("exit", resolve))
kill()
await Promise.race([exited, wait(5000)])
process.exit(/^COLD COST PASS/.test(text) ? 0 : 1)
