#!/usr/bin/env node
// Ticket 0194 — render the SAME ground at res 10 and res 11, side by side, as finished mist.
//
//   node tools/fog-harness/render-cells.mjs <out.png> <lat> <lng> <halfWidthM> [res,res]
//
// Reads `tmp/0194/cells-<res>.json` from `res-compare.ts`. Same three constraints as run.mjs —
// file://, no ES modules, under $HOME — and the same fix.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { harnessWorkdir } from "./workdir.mjs"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const OUT = process.argv[2] ?? join(ROOT, "tmp", "0194", "res-compare.png")
const CENTRE_LAT = Number(process.argv[3] ?? 30.1225)
const CENTRE_LNG = Number(process.argv[4] ?? -81.4201)
const HALF_W_M = Number(process.argv[5] ?? 400)
const RESOLUTIONS = (process.argv[6] ?? "10,11").split(",").map(Number)
const work = harnessWorkdir("fog-0194")

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

// The palette comes from app/tokens.css, never from this file — check-design-tokens.mjs bans a
// raw hex anywhere else and failed an Amplify build over exactly that in 0056.
const tokensCss = readFileSync(join(ROOT, "app/tokens.css"), "utf8")
const TOKENS = Object.fromEntries(
  [...tokensCss.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)].map((m) => [m[1], m[2]]),
)
for (const name of ["parch-100", "parch-400", "ink-600", "verdigris-300", "cold-wash"]) {
  if (!TOKENS[name]) throw new Error(`app/tokens.css no longer defines --${name}`)
}

const PANELS = RESOLUTIONS.map((r) =>
  JSON.parse(readFileSync(join(ROOT, "tmp", "0194", `cells-${r}.json`), "utf8")),
)
const PW = 900, PH = 900, GUTTER = 16, LABEL_H = 54
const sheetW = PANELS.length * PW + (PANELS.length - 1) * GUTTER
const sheetH = PH + LABEL_H + 40

const driver = readFileSync(join(ROOT, "tools/fog-harness/render-cells.js"), "utf8")
const page = join(work, "render.html")
writeFileSync(
  page,
  `<!doctype html><title>0194 res compare</title><body style="margin:0">
<canvas id="bg" width="${PW}" height="${PH}"></canvas>
<canvas id="c" width="${PW}" height="${PH}"></canvas>
<canvas id="sheet" width="${sheetW}" height="${sheetH}"></canvas>
<pre id="out">pending</pre>
<script>\n${compiled}\n</script>
<script>const CENTRE_LAT = ${CENTRE_LAT}, CENTRE_LNG = ${CENTRE_LNG}, HALF_W_M = ${HALF_W_M};
const TOKENS = ${JSON.stringify(TOKENS)};
const PANELS = ${JSON.stringify(PANELS)}</script>
<script>\n${driver}\n</script>
</body>`,
)

const dom = execFileSync(
  process.env.CHROMIUM ?? "/usr/bin/chromium-browser",
  ["--headless", "--no-sandbox", "--enable-unsafe-swiftshader",
   "--virtual-time-budget=30000", "--dump-dom", `file://${page}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 512 * 1024 * 1024, timeout: 180_000 },
)

const found = dom.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)
const text = found ? found[1] : ""
const dataUrl = text.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)
if (!dataUrl) {
  console.error(text.slice(0, 3000) || "(no <pre> — the page never ran)")
  process.exit(1)
}
writeFileSync(OUT, Buffer.from(dataUrl[1], "base64"))
console.log(`wrote ${OUT} — ${RESOLUTIONS.join(" vs ")} at ${CENTRE_LAT},${CENTRE_LNG}, ${HALF_W_M * 2} m across`)
