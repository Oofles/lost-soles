#!/usr/bin/env node
// Ticket 0112 — the reduced-motion criterion in a real browser. See reduced-motion-harness.js.
//
//   node tools/a11y/run-reduced-motion.mjs
//
// Runs the page twice in headless Chromium over CDP, in real time (rAF does not run under a
// virtual-time budget): with `prefers-reduced-motion: reduce` emulated, where the rAF spy must read
// ZERO calls and MapLibre zero renders for 3 s after first paint, and without it, the control,
// where both must be well above zero. Exit 0 on `REDUCED MOTION HARNESS PASS`.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { harnessWorkdir } from "../fog-harness/workdir.mjs"
import { launch } from "./cdp.mjs"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const work = harnessWorkdir("a11y-0112-motion")

execFileSync(
  join(ROOT, "node_modules/.bin/esbuild"),
  [
    join(ROOT, "tools/a11y/reduced-motion-harness.js"),
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
  `<!doctype html><title>0112 reduced motion</title>
<style>html,body{margin:0}#map{width:800px;height:600px}</style>
<body><div id="map"></div><script>${readFileSync(join(work, "bundle.js"), "utf8")}</script></body>`,
)

/** Installed before any page script, so nothing can schedule a frame the spy does not see. */
const SPY = `(() => {
  const real = window.requestAnimationFrame.bind(window)
  const spy = { calls: 0 }
  window.__raf = spy
  window.requestAnimationFrame = (cb) => { spy.calls++; return real(cb) }
})()`

async function run(reduce) {
  const b = await launch({ profileDir: work })
  try {
    await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }] })
    await b.send("Page.addScriptToEvaluateOnNewDocument", { source: SPY })
    await b.send("Page.navigate", { url: `file://${join(work, "harness.html")}` })
    const deadline = Date.now() + 60_000
    for (;;) {
      const r = await b.evaluate("window.__result ?? null")
      if (r) return r
      if (Date.now() > deadline) throw new Error("the harness never reported")
      await new Promise((res) => setTimeout(res, 250))
    }
  } finally {
    await b.close()
  }
}

const reduced = await run(true)
const control = await run(false)
const fail = []
if (!reduced.reduced) fail.push("the emulation did not reach matchMedia")
if (reduced.rafAfterFirstPaint !== 0) fail.push(`reduce: ${reduced.rafAfterFirstPaint} rAF calls after first paint, expected 0`)
if (reduced.rendersAfterFirstPaint !== 0) fail.push(`reduce: ${reduced.rendersAfterFirstPaint} MapLibre renders after first paint, expected 0`)
if (reduced.uTime !== 0) fail.push(`reduce: u_time ${reduced.uTime}, expected 0`)
if (reduced.composites === 0) fail.push("reduce: the fog never composited — a static map, not a missing one, is the claim")
if (control.reduced) fail.push("control: reduced motion was on")
if (control.rafAfterFirstPaint < 30) fail.push(`control: only ${control.rafAfterFirstPaint} rAF calls in ${control.windowMs} ms — the spy cannot see a running loop`)
if (control.rendersAfterFirstPaint < 10) fail.push(`control: only ${control.rendersAfterFirstPaint} renders — the fog loop never ran`)

const head = fail.length === 0 ? "REDUCED MOTION HARNESS PASS" : `REDUCED MOTION HARNESS FAIL (${fail.length})`
console.log([head, ...fail.map((f) => `  x ${f}`), "", `reduce   ${JSON.stringify(reduced)}`, `control  ${JSON.stringify(control)}`].join("\n"))
process.exit(fail.length === 0 ? 0 : 1)
