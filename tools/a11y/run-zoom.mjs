#!/usr/bin/env node
// Ticket 0112 — "at 200% browser zoom, every screen reflows ... with no horizontal scroll, and no
// text truncates or clips — screenshotted per screen." 06 §9.3, §9.4; D-313.
//
//   node tools/a11y/run-zoom.mjs            measure, and write screenshots to tmp/a11y-zoom/
//   node tools/a11y/run-zoom.mjs --commit   ... and to docs/capabilities/assets/0112/
//
// WHAT 200% ZOOM IS, to a layout: the CSS viewport halves and each CSS pixel is drawn with two
// device pixels. `Emulation.setDeviceMetricsOverride` at deviceScaleFactor 2 is exactly that, so a
// 1280×800 window at 200% is a 640×400 viewport here, and a 1920×1080 one is 960×540. Both land
// below 1024px, in the bottom-card layout (D-313: "a 200% zoom on a typical window lands here"). A
// 2560×1440 window at 200% is 1280×720 and keeps the rail; it is measured too.
//
// THE SCREENS ARE REAL COMPONENTS over synthetic data (`zoom-screens.jsx`), with the router, the
// session and the map stubbed (`stubs.jsx`). The map is a flat pane. Fonts are the self-hosted files
// in app/fonts, so text widths are the shipped ones.
//
// MEASURED, per screen per viewport:
//   - horizontal page scroll: documentElement or body wider than the viewport;
//   - clipped text: an element with its own text whose box hides overflow (or ellipsizes) and whose
//     content is wider than it — skill names MAY ellipsize (06 §9.4), and are reported as allowed;
//   - text off the viewport's left or right edge;
//   - a fixed panel whose content is taller than it with no way to scroll to the rest.
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { harnessWorkdir } from "../fog-harness/workdir.mjs"
import { launch } from "./cdp.mjs"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const work = harnessWorkdir("a11y-0112-zoom")
const COMMIT = process.argv.includes("--commit")
const SHOTS = COMMIT ? join(ROOT, "docs/capabilities/assets/0112") : join(ROOT, "tmp/a11y-zoom")
mkdirSync(SHOTS, { recursive: true })

/** [label, CSS width, CSS height]: the window each stands for, at 200%. */
const VIEWPORTS = [
  ["1280x800", 640, 400],
  ["1920x1080", 960, 540],
  ["2560x1440", 1280, 720],
]
/** Committed screenshots: the two typical windows. The rail case is measured, not pictured. */
const PICTURED = new Set(["1280x800", "1920x1080"])

// ─── 1. Render every screen to static HTML, in node ──────────────────────────
const { build } = await import(join(ROOT, "node_modules/esbuild/lib/main.js"))
const stub = join(ROOT, "tools/a11y/stubs.jsx")
const STUBBED = [
  /^next\/navigation$/,
  /^@\/app\/sync-action$/,
  /^@\/components\/map\/map-shell$/,
  /^@\/lib\/auth\/owner$/,
  /^@\/lib\/sources\/source-account-store$/,
]
await build({
  entryPoints: [join(ROOT, "tools/a11y/zoom-screens.jsx")],
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  outfile: join(work, "screens.cjs"),
  packages: "external",
  loader: { ".css": "empty" },
  logLevel: "error",
  plugins: [
    {
      name: "stubs",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => (STUBBED.some((re) => re.test(args.path)) ? { path: stub } : undefined))
      },
    },
  ],
  // `packages: external` leaves node_modules to node, which resolves them from the repo root.
  nodePaths: [join(ROOT, "node_modules")],
})
// Inside the repo (tmp/ is under it), so node finds node_modules by walking up.
const screens = JSON.parse(execFileSync(process.execPath, [join(work, "screens.cjs")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: ROOT }))

// ─── 2. Wrap each in the document the app serves ─────────────────────────────
const tokens = readFileSync(join(ROOT, "app/tokens.css"), "utf8")
const font = (family, file, weight, style = "normal") =>
  `@font-face{font-family:"${family}";src:url("file://${join(ROOT, "app/fonts", file)}") format("woff2");font-weight:${weight};font-style:${style};font-display:block}`
const FONTS = [
  font("Spectral", "spectral-latin-600-normal.woff2", 600),
  font("Spectral", "spectral-latin-400-italic.woff2", 400, "italic"),
  font("Inter", "inter-latin-400-normal.woff2", 400),
  font("Inter", "inter-latin-500-normal.woff2", 500),
  font("Inter", "inter-latin-600-normal.woff2", 600),
].join("\n")
const page = (name, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title><style>${FONTS}\n:root{--font-spectral:"Spectral";--font-inter:"Inter"}\n${tokens}</style></head><body>${body}</body></html>`
for (const [name, html] of Object.entries(screens)) writeFileSync(join(work, `${name}.html`), page(name, html))

// ─── 3. Lay each out at 200% and measure ─────────────────────────────────────
const MEASURE = `(async () => {
  await document.fonts.ready
  const vw = innerWidth
  const label = (el) => (el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "") + " \\"" + (el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 48) + "\\"")
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
  const out = { vw, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, clipped: [], allowed: [], offscreen: [], stuck: [] }
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden") continue
    if (cs.clip !== "auto" && cs.position === "absolute") continue // visually hidden, for a screen reader
    if (el.closest("style,script")) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const text = ownText(el) || [...el.children].every((c) => c.tagName === "SPAN" || c.tagName === "STRONG") && el.textContent.trim()
    if (text && (cs.overflowX !== "visible" || cs.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth + 1) {
      // 06 §9.4: "Levels and XP never ellipsize; skill names may."
      const skillName = el.closest(".plinth-skill,[data-skill-tile],[data-tile]") && !/\\d/.test(el.textContent)
      ;(skillName ? out.allowed : out.clipped).push(label(el) + " " + el.clientWidth + "<" + el.scrollWidth)
    }
    if (ownText(el) && (r.right > vw + 1 || r.left < -1)) out.offscreen.push(label(el) + " " + Math.round(r.left) + ".." + Math.round(r.right))
    if ((cs.position === "fixed" || cs.position === "absolute") && el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== "auto" && cs.overflowY !== "scroll" && cs.overflowY !== "visible") {
      out.stuck.push(label(el) + " " + el.clientHeight + "<" + el.scrollHeight)
    }
  }
  // Floating chrome on top of floating chrome: two fixed elements (neither inside the other, and
  // neither a full-screen layer such as a scrim or the map pane) whose boxes intersect. One covers
  // the other's text or controls, whichever paints on top.
  const vh = innerHeight
  const fixed = [...document.querySelectorAll("body *")].filter((el) => {
    const cs = getComputedStyle(el)
    if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") return false
    const r = el.getBoundingClientRect()
    // The map pane is under the chrome by design (at ≥1024px it is the pane beside the rail, D-313).
    if (el.classList.contains("home-pane")) return false
    return r.width > 0 && r.height > 0 && r.width * r.height < 0.9 * vw * vh
  })
  const top = fixed.filter((el) => !fixed.some((o) => o !== el && o.contains(el)))
  out.overlap = []
  for (let i = 0; i < top.length; i++)
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i].getBoundingClientRect()
      const b = top[j].getBoundingClientRect()
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (x > 1 && y > 1) out.overlap.push(label(top[i]).slice(0, 40) + " × " + label(top[j]).slice(0, 40) + " (" + Math.round(x) + "x" + Math.round(y) + " px)")
    }
  return out
})()`

/**
 * THE SABOTAGE. A page built to fail every detector once, measured first: a detector that cannot
 * fire on this would report every real screen clean. One wide block (horizontal scroll), one
 * ellipsized number (clipped), one word pushed off the right edge, one fixed box with hidden
 * overflow, and two fixed boxes on top of each other.
 */
writeFileSync(
  join(work, "__sabotage.html"),
  page(
    "sabotage",
    `<div style="width:2000px;height:4px"></div>
<p style="width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">123,456,789 XP</p>
<p style="position:relative;left:3000px">offscreen</p>
<div style="position:fixed;top:0;left:0;width:100px;height:20px;overflow:hidden"><p>a</p><p>b</p><p>c</p></div>
<div style="position:fixed;top:100px;left:100px;width:100px;height:100px;background:var(--surface)">x</div>
<div style="position:fixed;top:150px;left:150px;width:100px;height:100px;background:var(--surface)">y</div>`,
  ),
)

const rows = []
const b = await launch({ profileDir: work })
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 640, height: 400, deviceScaleFactor: 2, mobile: false })
  const loaded = b.once("Page.loadEventFired")
  await b.send("Page.navigate", { url: `file://${join(work, "__sabotage.html")}` })
  await loaded
  const s = await b.evaluate(MEASURE)
  const blind = [
    s.scrollW > s.vw ? null : "horizontal scroll",
    s.clipped.length ? null : "clipped text",
    s.offscreen.length ? null : "offscreen text",
    s.stuck.length ? null : "a stuck fixed panel",
    s.overlap.length ? null : "overlapping chrome",
  ].filter(Boolean)
  if (blind.length) {
    console.log(`ZOOM HARNESS BLIND: the sabotage page did not trip ${blind.join(", ")}`)
    process.exit(2)
  }

  for (const [label, w, h] of VIEWPORTS) {
    await b.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: false })
    for (const name of Object.keys(screens)) {
      const loaded = b.once("Page.loadEventFired")
      await b.send("Page.navigate", { url: `file://${join(work, `${name}.html`)}` })
      await loaded
      const m = await b.evaluate(MEASURE)
      const hscroll = m.scrollW > m.vw || m.bodyScrollW > m.vw
      const pass = !hscroll && m.clipped.length === 0 && m.offscreen.length === 0 && m.stuck.length === 0 && m.overlap.length === 0
      rows.push({ name, label, w, h, pass, hscroll, ...m })
      if (PICTURED.has(label)) {
        const shot = await b.send("Page.captureScreenshot", { format: "png" })
        writeFileSync(join(SHOTS, `${name}-${label}-200pct.png`), Buffer.from(shot.data, "base64"))
      }
    }
  }
} finally {
  await b.close()
}

const fails = rows.filter((r) => !r.pass)
console.log(fails.length === 0 ? "ZOOM HARNESS PASS" : `ZOOM HARNESS FAIL (${fails.length})`)
for (const r of rows) {
  console.log(`${r.pass ? "ok  " : "FAIL"} ${r.name.padEnd(17)} ${r.label.padEnd(9)} @200% = ${r.w}x${r.h} css px  scrollW ${r.scrollW}`)
  for (const k of ["clipped", "offscreen", "stuck", "overlap"]) for (const x of r[k]) console.log(`       ${k}: ${x}`)
  for (const x of r.allowed) console.log(`       allowed (a skill name may ellipsize, 06 §9.4): ${x}`)
  if (r.hscroll) console.log(`       horizontal scroll: document ${r.scrollW}, body ${r.bodyScrollW} > ${r.vw}`)
}
console.log(`screenshots: ${SHOTS}`)
process.exit(fails.length === 0 ? 0 : 1)
