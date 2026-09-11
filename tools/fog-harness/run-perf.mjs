#!/usr/bin/env node
// Ticket 0059 — §6.4's instruments against a real MapLibre Map, headless.
//
//   node tools/fog-harness/run-perf.mjs
//
// Reports items 1, 4, 5 and 7 as RESULTS — counts, allocations and synchronous wall-clock, all of
// which are device-independent. Items 2, 3 and 6 are frame-time questions and the virtual clock this
// runs under cannot answer them; they are printed for plumbing and carry a warning rather than a
// verdict. The desktop browser and the phone answer those, through `?fog=perf`.
//
// Exit 0 on `PERF HARNESS PASS`. Set CHROMIUM to override the browser path.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { harnessWorkdir } from "./workdir.mjs"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const work = harnessWorkdir("fog-0059-perf")

/**
 * ONE CHROMIUM PER DATASET. Item 7's baseline is sampled before anything is loaded, and running
 * three datasets in one page left the previous one's half-million-string `Set` uncollected — the
 * baseline climbed 39 -> 67 -> 83 MB and the delta stopped meaning "what the fog costs". A fresh
 * process is the only baseline nobody has to argue about.
 */
const DATASETS = process.argv.slice(2).filter((arg) => !arg.startsWith("-"))
const LABELS = DATASETS.length > 0 ? DATASETS : ["50k", "150k", "500k"]

execFileSync(
  join(ROOT, "node_modules/.bin/esbuild"),
  [
    join(ROOT, "tools/fog-harness/perf-harness.js"),
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
  `<!doctype html><title>0059 perf harness</title>
<style>html,body{margin:0}#map{width:400px;height:800px}</style>
<body><div id="map"></div><pre id="out">pending</pre>
<script>${readFileSync(join(work, "bundle.js"), "utf8")}</script></body>`,
)

function run(label) {
  const dom = execFileSync(
    process.env.CHROMIUM ?? "/usr/bin/chromium-browser",
    [
      "--headless",
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      // `--enable-precise-memory-info` is what makes `performance.memory` report real numbers rather
      // than the 100 KB-quantised, deliberately-coarsened default. Item 7 asks for "low tens of MB",
      // which the coarse figure could answer — but the baseline subtraction cannot survive the
      // quantisation at 20 ms granularity, and a negative delta reads as a bug in the harness.
      "--enable-precise-memory-info",
      // Half a million cells on SwiftShader, encoded and decoded through the shipped wire format.
      "--virtual-time-budget=600000",
      "--dump-dom",
      `file://${join(work, "harness.html")}#${label}`,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
      timeout: 900_000,
    },
  )
  const found = dom.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)
  return found
    ? found[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    : `(no <pre> in the dumped DOM for ${label} — the harness never ran)`
}

let failed = 0
const histograms = new Map()

for (const label of LABELS) {
  const text = run(label)
  console.log(text)
  console.log("")
  if (!/^PERF HARNESS PASS/.test(text.trim())) failed++
  for (const line of text.split("\n")) {
    const match = /^HISTOGRAM (\S+) (.*)$/.exec(line)
    if (!match) continue
    const byZoom = new Map()
    for (const entry of match[2].split(" ").filter(Boolean)) {
      const [zoom, rest] = entry.split(":")
      byZoom.set(Number(zoom), Number(rest.split("@")[0]))
    }
    histograms.set(match[1], byZoom)
  }
}

/**
 * THE CANARY §6.4 CALLS THE REAL ONE: *"an absolute ceiling can pass by luck, while a count that is
 * the same at 50k and 500k cannot."*
 *
 * Compared across processes now, and with a tolerance rather than as equality, for two reasons the
 * first run of this harness established:
 *
 *   - `cullBucket` BULK-COPIES a whole group when the group's own bbox is inside the viewport, so a
 *     few discs just outside the box survive. Which groups exist depends on the dataset's extent, so
 *     two datasets covering the same screen can differ by a fraction of a percent. 150k and 500k came
 *     out 10,418 and 10,397 — ten times the data, 0.2% apart.
 *   - The 50k disc is 6.3 km across and the scripted path pans ~4 km, so at the coarse zooms its
 *     EDGE enters the viewport and the count is legitimately lower. A smaller number is never the
 *     failure this is looking for; growth is.
 *
 * So the assertion is one-sided and generous: a bigger dataset must not draw meaningfully more.
 *
 * ─── AND IT IS SCOPED TO z13 AND UP, WHICH IS §6.4's OWN SCOPE ──────────────
 *
 * *"the peak is 5,271 at z14 and it is identical at all three dataset sizes **from z13 up**"*. Below
 * z13 the count genuinely does track dataset size — the first run measured 303 / 720 / 1,976 at z9 —
 * and that is the bucket ladder working rather than the cull failing: at z9 the whole dataset is on
 * screen, so what bounds the count is how many res-8 cells it has, and the absolute numbers are tiny
 * BECAUSE the resolution is coarse. Asserting equality there would fail §6.1's design for doing what
 * §6.1 designed it to do.
 */
const labels = [...histograms.keys()]
const FROM_ZOOM = 13
if (labels.length > 1) {
  const drift = []
  const table = []
  const zooms = new Set()
  for (const byZoom of histograms.values()) for (const zoom of byZoom.keys()) zooms.add(zoom)
  for (const zoom of [...zooms].sort((a, b) => a - b)) {
    const counts = labels.map((label) => histograms.get(label).get(zoom))
    if (counts.some((c) => c === undefined)) continue
    table.push(`  z${String(zoom).padStart(2)}  ${labels.map((l, j) => `${l}=${counts[j]}`).join("  ")}`)
    if (zoom < FROM_ZOOM) continue
    const smallest = counts[0]
    for (let i = 1; i < counts.length; i++) {
      if (counts[i] > smallest * 1.05 + 10) {
        drift.push(`z${zoom}: ${labels.map((l, j) => `${l}=${counts[j]}`).join(" ")}`)
        break
      }
    }
  }
  console.log(`cross-dataset  visibleInstanceCount by zoom (${labels.join(" / ")})`)
  console.log(table.join("\n"))
  console.log(
    drift.length === 0
      ? `cross-dataset  PASS — from z${FROM_ZOOM} up the count does not grow with dataset size`
      : `cross-dataset  FAIL — from z${FROM_ZOOM} up the count grows with dataset size:\n  ${drift.join("\n  ")}`,
  )
  if (drift.length > 0) failed++
}

process.exit(failed === 0 ? 0 : 1)
