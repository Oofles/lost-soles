#!/usr/bin/env node
// MAPLIBRE WORKER — copy it into public/ so the browser can actually fetch it.
//
// Ticket 0053. This exists because of a real, shipped bug, and the mechanism is
// worth writing down because nothing about the symptom points at the cause.
//
// MapLibre 6 is ESM-only and derives its worker URL from `import.meta.url`:
//
//     let t = config.WORKER_URL || (() => {
//       let t = import.meta.url                       // <-- webpack inlines this
//       if (!/^https?:/.test(t)) return ""            // <-- so this returns ""
//       return new URL(`./maplibre-gl-worker.mjs`, t).href
//     })()
//
// Webpack replaces `import.meta.url` at BUILD time with the absolute path of the
// module on the build machine — `file:///home/.../node_modules/maplibre-gl/dist/
// maplibre-gl.mjs`. That is not `http(s):`, so the worker URL becomes the empty
// string, the browser resolves "" against the current page, and the server answers
// with the app's own HTML. The console error is:
//
//     Failed to load module script: The server responded with a non-JavaScript
//     MIME type of "text/html".
//
// and the visible symptom is a map that renders its BACKGROUND LAYER and nothing
// else — a flat #cccccc screen, because the style loads on the main thread but no
// tile is ever parsed. Nothing in that picture says "worker".
//
// The fix is to serve the worker ourselves and point `setWorkerUrl` at it.
//
// ─── WHY .js AND NOT .mjs ────────────────────────────────────────────────────
//
// The worker imports `./maplibre-gl-shared.mjs`, so both files must be served, from
// the same directory, with a JavaScript MIME type. `.js` is served as JavaScript by
// every host without configuration; `.mjs` is not universally mapped, and getting it
// wrong reproduces the exact error above. So both are copied with a `.js` extension
// and the worker's import specifier is rewritten to match. The rewrite is ASSERTED
// below — if a future MapLibre changes the import shape, this fails loudly at build
// rather than shipping a worker that 404s.
//
//   node scripts/copy-maplibre-worker.mjs              copy (runs from `prebuild`)
//   node scripts/copy-maplibre-worker.mjs --self-test  prove the rewrite assertion bites

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const DIST = join(ROOT, "node_modules", "maplibre-gl", "dist")
const OUT = join(ROOT, "public", "maplibre")

const SHARED_FROM = "./maplibre-gl-shared.mjs"
const SHARED_TO = "./maplibre-gl-shared.js"

/** The version this build is pinned to, read from package.json rather than repeated. */
function pinnedVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
  return pkg.dependencies["maplibre-gl"]
}

function rewriteWorker(source) {
  if (!source.includes(SHARED_FROM)) {
    throw new Error(
      `maplibre-gl-worker.mjs no longer imports "${SHARED_FROM}".\n` +
        "The worker's dependency shape changed, so copying it verbatim would ship a\n" +
        "worker whose import 404s — the same failure this script exists to fix.\n" +
        "Re-read dist/maplibre-gl-worker.mjs and update scripts/copy-maplibre-worker.mjs.",
    )
  }
  return source.replaceAll(SHARED_FROM, SHARED_TO)
}

if (process.argv.includes("--self-test")) {
  let threw = false
  try {
    rewriteWorker("import{a}from'./something-else.mjs';")
  } catch {
    threw = true
  }
  if (!threw) {
    console.error("SELF-TEST FAILED: the missing-import assertion did not fire.")
    process.exit(1)
  }
  const rewritten = rewriteWorker(`import{a}from"${SHARED_FROM}";`)
  if (!rewritten.includes(SHARED_TO) || rewritten.includes(SHARED_FROM)) {
    console.error("SELF-TEST FAILED: the import specifier was not rewritten.")
    process.exit(1)
  }
  console.log("copy-maplibre-worker: self-test passed")
} else {
  const installed = JSON.parse(
    readFileSync(join(ROOT, "node_modules", "maplibre-gl", "package.json"), "utf8"),
  ).version

  // The pin is exact (no ^ or ~) on purpose — 0053's Notes explain why. If that ever
  // drifts, the copied worker could be a different build from the bundled library,
  // which fails in ways far stranger than a 404.
  if (installed !== pinnedVersion()) {
    console.error(
      `maplibre-gl is pinned to ${pinnedVersion()} but ${installed} is installed.\n` +
        "The worker copied here must be the same build as the bundled library.",
    )
    process.exit(1)
  }

  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "maplibre-gl-worker.js"),
    rewriteWorker(readFileSync(join(DIST, "maplibre-gl-worker.mjs"), "utf8")),
  )
  writeFileSync(
    join(OUT, "maplibre-gl-shared.js"),
    readFileSync(join(DIST, "maplibre-gl-shared.mjs"), "utf8"),
  )
  console.log(`copy-maplibre-worker: public/maplibre/ written from maplibre-gl@${installed}`)
}
