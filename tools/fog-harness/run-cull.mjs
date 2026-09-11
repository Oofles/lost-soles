#!/usr/bin/env node
// Ticket 0058 — the cull, end to end. Bundles a real `maplibre-gl` Map plus the shipped
// `ZoomBucketStore`, `FogViewportController` and `FogMaskLayer` with esbuild, runs it in headless
// Chromium on SwiftShader, drives a scripted camera path, and reads the coverage back off the canvas.
//
//   node tools/fog-harness/run-cull.mjs
//
// This is what `viewport-controller.test.ts` cannot do: it drives a fake map whose `getBounds()` this
// repository wrote. See cull-harness.js.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { harnessWorkdir } from "./workdir.mjs"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
// Under $HOME because a snap-confined Chromium cannot read a file:// path outside it.
const work = harnessWorkdir("fog-0058-cull")

// IIFE, not ESM: the page is loaded over file:// (a snap Chromium will not serve over 127.0.0.1
// without --dump-dom hanging), and a module script from a null origin is blocked by CORS. Bundling
// to a classic script is what makes file:// viable at all.
execFileSync(
  join(ROOT, "node_modules/.bin/esbuild"),
  [
    join(ROOT, "tools/fog-harness/cull-harness.js"),
    "--bundle",
    "--format=iife",
    "--target=es2020",
    "--loader:.ts=ts",
    `--outfile=${join(work, "bundle.js")}`,
  ],
  { stdio: "inherit" },
)

writeFileSync(
  join(work, "harness.html"),
  `<!doctype html><title>0058 cull harness</title>
<style>html,body{margin:0}#map{width:1280px;height:800px}</style>
<body><div id="map"></div><pre id="out">pending</pre>
<script>${readFileSync(join(work, "bundle.js"), "utf8")}</script></body>`,
)

const dom = execFileSync(
  process.env.CHROMIUM ?? "/usr/bin/chromium-browser",
  [
    "--headless",
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--virtual-time-budget=30000",
    "--dump-dom",
    `file://${join(work, "harness.html")}`,
  ],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  },
)

const found = dom.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)
const text = found
  ? found[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
  : "(no <pre> in the dumped DOM — the harness never ran)"
console.log(text)
process.exit(/^CULL HARNESS PASS/.test(text.trim()) ? 0 : 1)
