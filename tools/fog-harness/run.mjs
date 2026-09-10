#!/usr/bin/env node
// Tickets 0055 and 0056 — compile the fog's GL modules, run them against a real WebGL2 context in
// headless Chromium, print the verdict. See harness.js for what is measured and why.
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

// THREE MODULES NOW, NOT ONE. 0055 compiled `mask.ts` alone because it had no imports at all;
// 0056's `composite.ts` has exactly one, to `fog-uniforms.ts`, which is constants and nothing else.
// Rather than duplicate those constants into the shader module — where a taste pass would then have
// two places to edit and one of them wrong — the concatenation strips `import` lines as well as
// `export` keywords and lets the three files share one top-level scope, in dependency order.
//
// THE CONSTRAINT THAT MATTERS IS UNCHANGED: nothing in these files may import anything that needs a
// DOM, MapLibre, or a bundler. That is what keeps the GPU claims measurable at all.
const MODULES = ["lib/fog/fog-uniforms.ts", "lib/fog/composite.ts", "lib/fog/mask.ts"]

execFileSync(
  "npx",
  [
    "tsc",
    ...MODULES.map((m) => join(ROOT, m)),
    "--target", "es2020",
    "--module", "es2020",
    "--moduleResolution", "bundler",
    "--strict",
    "--outDir", work,
  ],
  { stdio: "inherit" },
)

const compiled = MODULES.map((module) => {
  const name = module.split("/").pop().replace(/\.ts$/, ".js")
  return readFileSync(join(work, name), "utf8")
    // A local import is resolved by the shared scope instead. A BARE import would not be, so it is
    // left alone and shows up as a syntax error in the page rather than as a silent wrong answer.
    .replace(/^import\s[^;]*?from\s*["']\.[^"']*["'];?\s*$/gm, "")
    .replace(/^export /gm, "")
}).join("\n")
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
