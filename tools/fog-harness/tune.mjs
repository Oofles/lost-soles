#!/usr/bin/env node
// Ticket 0119 — render the fog over the REAL basemap, with labels, once per palette variant.
//
//   node tools/fog-harness/tune.mjs [variants.json] [--zoom 16] [--out tmp/0119]
//
// `variants.json` is `{ "<name>": { <FogPalette overrides on V1> } | null }`; `null` means the fog
// layer is not added at all — the legibility baseline `0119` compares against. With no file, it
// renders `off` and `V1`. One PNG per variant lands in `--out`.
//
// WHERE IT STANDS: a synthetic loop through downtown Orlando. The legibility check needs real
// streets with real names under it, so Point Nemo will not do — but it must not be anywhere the
// operator runs (D-199). A public downtown, synthetic geometry, a trace nobody ran. That is also
// what lets the screenshots be committed with the ticket.
//
// Network: the page fetches the real archive from CloudFront plus Protomaps' public glyphs and
// sprites, from a throwaway 127.0.0.1 server. The distribution sends no CORS headers, so the
// headless browser runs with web security off. This is a local screenshot tool, never a server.
//
// Output belongs in the gitignored `tmp/` by default. Only commit a screenshot of THIS synthetic
// loop — never one rendered from the operator's own cells (D-199, `08` §7.2).
import { execFileSync, spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { harnessWorkdir } from "./workdir.mjs"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args.splice(i, 2)[1] : d }
const ZOOM = Number(flag("zoom", 16))
const OUT = resolve(ROOT, flag("out", "tmp/0119"))
const VARIANTS = args[0] ? JSON.parse(readFileSync(args[0], "utf8")) : { off: null, V1: {} }
mkdirSync(OUT, { recursive: true })

const work = harnessWorkdir("fog-0119")

execFileSync(
  join(ROOT, "node_modules/.bin/esbuild"),
  [
    join(ROOT, "tools/fog-harness/tune-harness.js"),
    "--bundle", "--format=iife", "--target=es2020", "--loader:.ts=ts",
    `--alias:@=${ROOT}`,
    `--outfile=${join(work, "bundle.js")}`,
  ],
  { stdio: "inherit" },
)
// THE WORKER, BUNDLED TO ONE FILE AND HANDED OVER AS A BLOB. MapLibre 6's worker is an ES module
// that imports a shared chunk, and without a reachable worker the map draws its background layer and
// parses no tile — the flat grey frame scripts/copy-maplibre-worker.mjs documents. A file:// page
// cannot start that module worker, and serving over 127.0.0.1 hangs the snap Chromium (see
// run-maplibre.mjs). One self-contained bundle turned into a blob: URL in the page sidesteps both.
execFileSync(
  join(ROOT, "node_modules/.bin/esbuild"),
  [join(ROOT, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"), "--bundle", "--format=esm",
   "--target=es2020", `--outfile=${join(work, "worker.js")}`, "--log-level=warning"],
  { stdio: "inherit" },
)
const workerSrc = readFileSync(join(work, "worker.js"), "utf8")

// The route colours come from app/tokens.css, as `documentRoutePalette` reads them in the app.
const tokens = Object.fromEntries(
  [...readFileSync(join(ROOT, "app/tokens.css"), "utf8").matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)]
    .map((m) => [m[1], m[2].trim()]),
)
const resolveToken = (name) => {
  let v = tokens[name]
  while (v?.startsWith("var(--")) v = tokens[v.slice(6, -1)]
  if (!v) throw new Error(`app/tokens.css does not resolve --${name}`)
  return v
}
const route = { glow: resolveToken("route-glow"), core: resolveToken("route-line") }

// A ~650 m x 720 m loop of downtown blocks, plus a spur east, so one frame at z16 holds revealed
// ground, the frontier on several headings, and unexplored ground on every side.
const trace = [
  [28.5465, -81.381], [28.5465, -81.3745], [28.5433, -81.3745], [28.5433, -81.369],
  [28.5433, -81.3745], [28.54, -81.3745], [28.54, -81.381], [28.5465, -81.381],
]
const centre = { lat: 28.5433, lng: -81.3765 }

// DRIVEN OVER THE DEVTOOLS PROTOCOL, IN REAL TIME. `--screenshot` with `--virtual-time-budget` never
// finishes loading this style: the sprite and glyph decodes stall under virtual time and `load` never
// fires, so every capture was the flat grey background. Real time plus an explicit "ready" signal
// from the page (`document.title`) is what makes the capture deterministic. `file://` cannot start
// MapLibre's module worker's message loop either, hence the throwaway static server.
const PORT = 8100 + Math.floor(Math.random() * 800)
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", work], { stdio: "ignore" })
const DT_PORT = PORT + 1000
const chromium = spawn(process.env.CHROMIUM ?? "/snap/bin/chromium", [
  "--headless", "--no-sandbox", "--enable-unsafe-swiftshader", "--hide-scrollbars",
  "--disable-web-security", `--user-data-dir=${join(work, "profile")}`,
  "--window-size=1280,800", `--remote-debugging-port=${DT_PORT}`, "about:blank",
], { stdio: "ignore" })
process.on("exit", () => { chromium.kill(); server.kill() })

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
await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })

for (const [name, variant] of Object.entries(VARIANTS)) {
  const cfg = { variant, workerSrc, centre, zoom: ZOOM, route, trace }
  // Separate classic scripts rather than inline: a 2 MB bundle inlined into HTML contains `<!--` and
  // `<script` sequences that throw the tokenizer into script-escaped states, and nothing runs.
  writeFileSync(join(work, `${name}.cfg.js`), `window.__TUNE=${JSON.stringify(cfg)}`)
  writeFileSync(
    join(work, `${name}.html`),
    `<!doctype html><meta charset="utf-8"><title>pending</title>
<style>html,body{margin:0;overflow:hidden}#map{width:1280px;height:800px}</style>
<body><div id="map"></div>
<script src="${name}.cfg.js"></script>
<script src="bundle.js"></script></body>`,
  )
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PORT}/${name}.html` })
  let title = ""
  for (let i = 0; i < 240 && !title.startsWith("TUNE"); i++) {
    await sleep(500)
    title = (await cdp("Runtime.evaluate", { expression: "document.title", returnByValue: true })).result?.result?.value ?? ""
  }
  if (!title.startsWith("TUNE READY")) throw new Error(`${name}: the map never went idle (title "${title}")`)
  await sleep(500)
  const shot = await cdp("Page.captureScreenshot", { format: "png" })
  const png = join(OUT, `${name}.png`)
  writeFileSync(png, Buffer.from(shot.result.data, "base64"))
  console.log(`${name.padEnd(14)} ${title.slice(11).padEnd(12)} ${png}`)
}
ws.close()
process.exit(0)
