#!/usr/bin/env node
// Ticket 0055 — compile lib/fog/mask.ts alone, run it against a real WebGL2 context in headless
// Chromium, print the verdict. See harness.js for what is measured and why.
//
//   node tools/fog-harness/run.mjs
//
// EVERYTHING IS INLINED INTO ONE file:// PAGE, and all three constraints below are forced. This
// arrangement was found the expensive way in 0118 — each of the alternatives fails SILENTLY, with
// nothing but the placeholder in the dumped DOM and no error anywhere:
//
//   * ES MODULES CANNOT BE USED. A module script is fetched with CORS and a file:// page has origin
//     `null`, so the import is blocked.
//   * HTTP CANNOT BE USED EITHER. Served over 127.0.0.1, a snap-confined Chromium makes --dump-dom
//     hang until the child is killed on a timeout.
//   * THE PAGE MUST LIVE UNDER $HOME. A snap cannot read a file:// path outside it, which rules out
//     the usual temp directory.
//
// So the compiled module has its `export` keywords stripped and is concatenated with the driver as
// two classic scripts sharing one top-level scope. Crude, and the only arrangement of the three
// that runs at all.
//
// THIS IS NOT PART OF `npm test`. It needs a browser and a GPU, and the CI containers have neither;
// a suite that fails on a missing binary is a suite people learn to ignore. It is run by hand when
// the mask shader changes, and its output goes in the ticket's `## Operator validation` as the
// evidence for the claims a fake GL context cannot make.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const work = mkdtempSync(join(process.env.HOME ?? tmpdir(), "fog-0055-"))

execFileSync(
  "npx",
  [
    "tsc",
    join(ROOT, "lib/fog/mask.ts"),
    "--target", "es2020",
    "--module", "es2020",
    "--moduleResolution", "bundler",
    "--strict",
    "--outDir", work,
  ],
  { stdio: "inherit" },
)

const compiled = readFileSync(join(work, "mask.js"), "utf8").replace(/^export /gm, "")
const driver = readFileSync(join(ROOT, "tools/fog-harness/harness.js"), "utf8")
const page = join(work, "harness.html")
writeFileSync(
  page,
  `<!doctype html><title>0055 harness</title><body style="margin:0">
<canvas id="c" width="1280" height="800"></canvas>
<pre id="out">pending</pre>
<script>\n${compiled}\n</script>
<script>\n${driver}\n</script>
</body>`,
)

const dom = execFileSync(
  process.env.CHROMIUM ?? "/usr/bin/chromium-browser",
  [
    "--headless",
    "--no-sandbox",
    // SwiftShader is a real rasteriser with real blend hardware semantics. It is NOT a real phone
    // GPU, and 0055 does not claim it is — D-230 parked the Qualcomm/Mali ANGLE question on 0059.
    "--enable-unsafe-swiftshader",
    "--virtual-time-budget=20000",
    "--dump-dom",
    `file://${page}`,
  ],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  },
)

const found = dom.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)
const text = found
  ? found[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  : "(no <pre> in the dumped DOM — the harness never ran)"
console.log(text)
process.exit(/^HARNESS PASS/.test(text.trim()) ? 0 : 1)
