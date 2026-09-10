#!/usr/bin/env node
// Ticket 0118 — compile lib/fog/spike-mask.ts alone, run it in headless Chromium on
// SwiftShader, print the verdict. Throwaway; see README.md.
//
// EVERYTHING IS INLINED INTO ONE file:// PAGE, and both halves of that are forced:
//
//   * ES MODULES CANNOT BE USED. A module script is fetched with CORS and a file://
//     page has origin `null`, so the import is blocked — and the failure is silent, the
//     dumped DOM just shows the placeholder with no error in it.
//   * HTTP CANNOT BE USED EITHER. Chromium here is a snap; served over 127.0.0.1,
//     --dump-dom never returns and the child has to be killed on a timeout.
//
// So the compiled module has its `export` keywords stripped and is concatenated with
// the driver as two classic scripts sharing one top-level scope. Crude, and the only
// arrangement of the three that actually runs.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
// Under $HOME because a snap cannot read a file:// path outside it.
const work = mkdtempSync(join(process.env.HOME ?? tmpdir(), "spike-0118-"))

execFileSync(
  "npx",
  ["tsc", join(ROOT, "lib/fog/spike-mask.ts"), "--target", "es2020", "--module", "es2020",
   "--moduleResolution", "bundler", "--strict", "--outDir", work],
  { stdio: "inherit" },
)

const module_ = readFileSync(join(work, "spike-mask.js"), "utf8").replace(/^export /gm, "")
const driver = readFileSync(join(ROOT, "tools/spike-harness/harness.js"), "utf8")
const page = join(work, "harness.html")
writeFileSync(
  page,
  `<!doctype html><title>0118 harness</title><body style="margin:0">
<canvas id="c" width="1280" height="800"></canvas>
<pre id="out">pending</pre>
<script>\n${module_}\n</script>
<script>\n${driver}\n</script>
</body>`,
)

const dom = execFileSync(
  process.env.CHROMIUM ?? "/usr/bin/chromium-browser",
  ["--headless", "--no-sandbox", "--enable-unsafe-swiftshader",
   "--virtual-time-budget=20000", "--dump-dom", `file://${page}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
)

const found = dom.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)
const text = found
  ? found[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  : "(no <pre> in the dumped DOM — the harness never ran)"
console.log(text)
process.exit(/^HARNESS PASS/.test(text.trim()) ? 0 : 1)
