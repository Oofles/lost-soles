#!/usr/bin/env node
// Ticket 0056 — render one frame of the finished fog over a stand-in basemap and write a PNG.
//
// NOT A TEST AND NOT A GATE. `harness.js` measures the claims; this makes a picture, so that the
// first person to look at the composite is not the operator. It costs ten seconds and it is the
// difference between "five judgement calls, please" and "five judgement calls on something I have
// at least seen".
//
//   node tools/fog-harness/render-png.mjs [out.png]
//
// The same three constraints as run.mjs — file://, no ES modules, under $HOME — and the same fix.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const OUT = process.argv[2] ?? join(ROOT, "tmp", "fog-0056.png")
/** `V1` (what ships), `ATLAS` or `ADVENTURE` — so `0119` can put the three side by side. */
const PALETTE_NAME = process.argv[3] ?? "V1"
/** Half the camera width in metres. 900 is a neighbourhood; 120 is a couple of streets. */
const HALF_W_M = Number(process.argv[4] ?? 900)
const work = mkdtempSync(join(process.env.HOME ?? tmpdir(), "fog-0056-png-"))

const MODULES = ["lib/fog/fog-uniforms.ts", "lib/fog/composite.ts", "lib/fog/mask.ts"]
execFileSync(
  "npx",
  ["tsc", ...MODULES.map((m) => join(ROOT, m)),
   "--target", "es2020", "--module", "es2020", "--moduleResolution", "bundler",
   "--strict", "--outDir", work],
  { stdio: "inherit" },
)
const compiled = MODULES.map((m) =>
  readFileSync(join(work, m.split("/").pop().replace(/\.ts$/, ".js")), "utf8")
    .replace(/^import\s[^;]*?from\s*["']\.[^"']*["'];?\s*$/gm, "")
    .replace(/^export /gm, ""),
).join("\n")

const driver = readFileSync(join(ROOT, "tools/fog-harness/render-png.js"), "utf8")
const page = join(work, "render.html")
writeFileSync(
  page,
  `<!doctype html><title>0056 render</title><body style="margin:0">
<canvas id="bg" width="1280" height="800"></canvas>
<canvas id="c" width="1280" height="800"></canvas>
<pre id="out">pending</pre>
<script>\n${compiled}\n</script>
<script>const PALETTE_NAME = ${JSON.stringify(PALETTE_NAME)}; const HALF_W_M = ${HALF_W_M}</script>
<script>\n${driver}\n</script>
</body>`,
)

const dom = execFileSync(
  process.env.CHROMIUM ?? "/usr/bin/chromium-browser",
  ["--headless", "--no-sandbox", "--enable-unsafe-swiftshader",
   "--virtual-time-budget=20000", "--dump-dom", `file://${page}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024, timeout: 120_000 },
)

const found = dom.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)
const text = found ? found[1] : ""
const dataUrl = text.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)
if (!dataUrl) {
  console.error(text.slice(0, 2000) || "(no <pre> — the page never ran)")
  process.exit(1)
}
writeFileSync(OUT, Buffer.from(dataUrl[1], "base64"))
console.log(`wrote ${OUT} (palette ${PALETTE_NAME}, half-width ${HALF_W_M} m)`)
