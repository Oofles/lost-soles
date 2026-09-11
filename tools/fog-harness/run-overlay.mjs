#!/usr/bin/env node
// Ticket 0059 — the React half, in headless Chromium.
//
//   node tools/fog-harness/run-overlay.mjs
//
// `run-perf.mjs` proves the instruments against a real MapLibre Map and touches no React. This
// proves the ~180 lines of React the operator actually interacts with: the `?fog=perf` branch in
// `ExploredProvider`, and all of `PerfOverlay`. See overlay-harness.jsx for what is real and what
// is faked. Exit 0 on `OVERLAY HARNESS PASS`.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { harnessWorkdir } from "./workdir.mjs"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const work = harnessWorkdir("fog-0059-overlay")

execFileSync(
  join(ROOT, "node_modules/.bin/esbuild"),
  [
    join(ROOT, "tools/fog-harness/overlay-harness.jsx"),
    "--bundle",
    "--format=iife",
    "--target=es2020",
    "--loader:.ts=ts",
    "--loader:.tsx=tsx",
    /**
     * `--jsx=automatic`, and it is not optional. `tsconfig.json` sets `jsx: "preserve"` because Next
     * does its own transform, which leaves esbuild falling back to the CLASSIC runtime —
     * `React.createElement` against a `React` that none of these components import. The page then
     * dies at module scope with `Uncaught ReferenceError: React is not defined` and `--dump-dom`
     * reports the `<pre>` still saying "pending", with no error anywhere in the output.
     *
     * `vitest.config.ts` documents the same trap for the same reason. Two tools, one tsconfig, one
     * fallback.
     */
    "--jsx=automatic",
    // `maplibre-gl/dist/maplibre-gl.css` is imported for its side effect by the component tree.
    // `text` turns it into a harmless string; `empty` would work too. There is no stylesheet to
    // apply because there is no map.
    "--loader:.css=text",
    // React reads this at module scope and the development build warns about everything otherwise.
    "--define:process.env.NODE_ENV=\"production\"",
    `--outfile=${join(work, "bundle.js")}`,
  ],
  { stdio: "inherit" },
)

writeFileSync(
  join(work, "harness.html"),
  `<!doctype html><title>0059 overlay harness</title>
<style>html,body{margin:0}</style>
<body><div id="root"></div><pre id="out">pending</pre>
<script>${readFileSync(join(work, "bundle.js"), "utf8")}</script></body>`,
)

/**
 * THE FLAG GOES IN THE QUERY STRING OF A `file://` URL, which is legal and is what the components
 * read — `perfDataset(window.location.search)`. `here:50k` regenerates the disc around
 * `readCamera() ?? EXTRACT_FALLBACK` rather than fetching a fixture, and a `fetch` of a `file://`
 * URL from a null origin is blocked — so this is also the only dataset mode that CAN run here.
 */
const dom = execFileSync(
  process.env.CHROMIUM ?? "/usr/bin/chromium-browser",
  [
    "--headless",
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--enable-precise-memory-info",
    "--virtual-time-budget=300000",
    ...(process.env.FOG_VERBOSE ? ["--enable-logging=stderr", "--v=0"] : []),
    "--dump-dom",
    `file://${join(work, "harness.html")}?fog=perf:here:50k`,
  ],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", process.env.FOG_VERBOSE ? "inherit" : "ignore"],
    maxBuffer: 64 * 1024 * 1024,
    timeout: 600_000,
  },
)

const found = dom.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/)
const text = found
  ? found[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  : "(no <pre> in the dumped DOM — the harness never ran)"
console.log(text)
process.exit(/^OVERLAY HARNESS PASS/.test(text.trim()) ? 0 : 1)
