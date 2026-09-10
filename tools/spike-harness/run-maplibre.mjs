#!/usr/bin/env node
// Ticket 0118 — the MapLibre half of the harness. Bundles a real maplibre-gl Map plus
// this spike's layer with esbuild, runs it in headless Chromium on SwiftShader, and
// reports whether MapLibre's OWN projection prelude compiles against the mask shader's
// attributes inside the real `prerender` hook.
//
// This is what tools/spike-harness/run.mjs cannot do: that one substitutes STUB_PRELUDE,
// so it proves MAX-into-R8 and nothing about MapLibre's shader plumbing.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const work = mkdtempSync(join(process.env.HOME ?? tmpdir(), "spike-0118-ml-"))

// IIFE, not ESM: the page is loaded over file:// (a snap Chromium will not serve over
// 127.0.0.1 without --dump-dom hanging), and a module script from a null origin is
// blocked by CORS. Bundling to a classic script is what makes file:// viable.
execFileSync(
  join(ROOT, "node_modules/.bin/esbuild"),
  [join(ROOT, "tools/spike-harness/maplibre-harness.js"),
   "--bundle", "--format=iife", "--target=es2020", "--loader:.ts=ts",
   `--outfile=${join(work, "bundle.js")}`],
  { stdio: "inherit" },
)

writeFileSync(
  join(work, "harness.html"),
  `<!doctype html><title>0118 maplibre harness</title>
<style>html,body{margin:0}#map{width:1280px;height:800px}</style>
<body><div id="map"></div><pre id="out">pending</pre>
<script>${readFileSync(join(work, "bundle.js"), "utf8")}</script></body>`,
)

const dom = execFileSync(
  process.env.CHROMIUM ?? "/usr/bin/chromium-browser",
  ["--headless", "--no-sandbox", "--enable-unsafe-swiftshader",
   "--virtual-time-budget=30000", "--dump-dom", `file://${join(work, "harness.html")}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024, timeout: 180_000 },
)

const found = dom.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)
const text = found
  ? found[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  : "(no <pre> in the dumped DOM — the harness never ran)"
console.log(text)
process.exit(/^MAPLIBRE HARNESS PASS/.test(text.trim()) ? 0 : 1)
