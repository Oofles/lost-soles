#!/usr/bin/env node
// Ticket 0099 — the two mode-parity criteria that are about PIXELS ON THE REAL BASEMAP, measured from
// screenshots `tune.mjs` takes (real CloudFront tiles, real labels, the shipped FogMaskLayer):
//
//   GHOST GRID (criterion 4). With nothing explored, every pixel is fog at `u_maxOpacity`. If that is
//   below 1.0 the street grid still shows through: road pixels stay brighter than the ground between
//   them. Measured as Δ = mean luminance of road pixels − mean of non-road pixels, inside the fogged
//   frame, with every label hidden so it is geometry alone. Road/non-road is classified on the same
//   frame with no fog. Sabotage: the same frame at `maxOpacity` 1.0 must give Δ ≈ 0, so a positive Δ
//   is the ghost and not the noise field (which is pinned, `u_time = 0`, and uncorrelated with roads).
//
//   STREET-NAME LEGIBILITY (criterion 5). Each mode, at z15 and z16, over the stock map (no fog),
//   ground that is all revealed, and ground that is all unexplored. The street-name layers
//   (`roads_labels*`) are drawn three ways — as shipped, with no halo, and at text/icon opacity 0 (same
//   collision, so every other pixel is identical). The no-halo/muted diff is the glyphs; each label is
//   measured as the WCAG ratio of its letters' solid core against the 2 px ring around them in the
//   shipped frame — its halo and the ground just past it. Judged: revealed ground equals the stock
//   map in both modes, and atlas's names are present over unexplored ground. Recorded: the rest.
//
//   SCREENSHOTS (criterion 6). Each mode over the same viewport and the synthetic loop, each reached
//   through the toggle's own swap from the other mode, at z16 — written to --out for the capability doc.
//
//   node tools/fog-harness/mode-parity-shots.mjs [--out tmp/0099]
//
// Network: as tune.mjs. Synthetic loop through a public downtown only (D-199).
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { PNG } from "pngjs"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args.splice(i, 2)[1] : d }
const OUT = resolve(ROOT, flag("out", "tmp/0099"))
const ZOOMS = [15, 16]
const MODES = ["atlas", "adventure"]
const GROUNDS = ["off", "all", "none", "cold"]
const GROUND_NAME = { off: "no fog", all: "revealed", none: "unexplored", cold: "cold (1 y)" }
const STREET_LABELS = "roads_labels"
// tune.mjs's loop and frame — kept in step by hand; the route buffer below is all it is used for.
const CENTRE = { lat: 28.5433, lng: -81.3765 }
const TRACE = [
  [28.5465, -81.381], [28.5465, -81.3745], [28.5433, -81.3745], [28.5433, -81.369],
  [28.5433, -81.3745], [28.54, -81.3745], [28.54, -81.381], [28.5465, -81.381],
]
const W = 1280
const H = 800

function variants() {
  const v = {}
  for (const m of MODES) {
    const other = m === "atlas" ? "adventure" : "atlas"
    v[`shot-${m}`] = { _basemap: m, _base: m, _swapFrom: other }
    for (const g of GROUNDS) {
      // "off" is the same basemap with no fog layer at all: the stock map's own legibility.
      // `0100`: "cold" is "all" with every cell last run a year ago — atlas draws the wash over it.
      const ground =
        g === "off"
          ? { _basemap: m, _off: true }
          : g === "cold"
            ? { _basemap: m, _base: m, _cells: "all", _coldDays: 365 }
            : { _basemap: m, _base: m, _cells: g }
      v[`lbl-${m}-${g}`] = ground
      v[`mute-${m}-${g}`] = { ...ground, _muteLabels: STREET_LABELS }
      v[`bare-${m}-${g}`] = { ...ground, _bareLabels: STREET_LABELS }
    }
    v[`geo-off-${m}`] = { _basemap: m, _off: true, _noSymbols: true }
    v[`geo-${m}`] = { _basemap: m, _base: m, _cells: "none", _noSymbols: true }
  }
  v["geo-ceiling"] = { _basemap: "adventure", _base: "adventure", _cells: "none", _noSymbols: true, maxOpacity: 0.94 }
  v["geo-sabotage"] = { _basemap: "adventure", _base: "adventure", _cells: "none", _noSymbols: true, maxOpacity: 1.0 }
  return v
}

/* ─── pixels ─────────────────────────────────────────────────────────────────────────────── */

function load(dir, name) {
  const png = PNG.sync.read(readFileSync(join(dir, `${name}.png`)))
  if (png.width !== W || png.height !== H) throw new Error(`${name}: ${png.width}x${png.height}, expected ${W}x${H}`)
  return png.data
}
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const LIN = Float64Array.from({ length: 256 }, (_, i) => lin(i))
/** WCAG relative luminance, 0..1. */
const lum = (d, i) => 0.2126 * LIN[d[i]] + 0.7152 * LIN[d[i + 1]] + 0.0722 * LIN[d[i + 2]]
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** Pixels within `px` of the drawn route — excluded everywhere: the route is topmost in both modes. */
function routeMask(zoom, px = 24) {
  const scale = 512 * 2 ** zoom
  const mx = (lng) => ((lng + 180) / 360) * scale
  const my = (lat) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale }
  const cx = mx(CENTRE.lng)
  const cy = my(CENTRE.lat)
  const pts = TRACE.map(([lat, lng]) => [W / 2 + mx(lng) - cx, H / 2 + my(lat) - cy])
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, ay] = pts[k]
        const [bx, by] = pts[k + 1]
        const dx = bx - ax
        const dy = by - ay
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
        if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= px) { out[y * W + x] = 1; break }
      }
    }
  }
  return out
}

/* ─── ghost grid ─────────────────────────────────────────────────────────────────────────── */

/** 8-bit luma (Rec. 709 weights on the encoded values), the scale a screenshot's grey levels are in. */
function luma(d) {
  const out = new Float64Array(W * H)
  for (let p = 0; p < W * H; p++) out[p] = 0.2126 * d[p * 4] + 0.7152 * d[p * 4 + 1] + 0.0722 * d[p * 4 + 2]
  return out
}

/**
 * `l` minus its (2r+1)² box mean: the fog's fBm field varies over tens of pixels, a street is a few
 * pixels wide. Without it, the noise's large-scale blotches correlate with where downtown happens to
 * have more road, and the 1.0 sabotage reads ±0.7 levels of "ghost" that is only noise.
 */
function highPass(l, r = 6) {
  const sat = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let row = 0
    for (let x = 0; x < W; x++) {
      row += l[y * W + x]
      sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row
    }
  }
  const out = new Float64Array(W * H)
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1)
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1)
      const sum = sat[y1 * (W + 1) + x1] - sat[y0 * (W + 1) + x1] - sat[y1 * (W + 1) + x0] + sat[y0 * (W + 1) + x0]
      out[y * W + x] = l[y * W + x] - sum / ((y1 - y0) * (x1 - x0))
    }
  }
  return out
}

function ghost(dir, offName, fogName, route) {
  const off = load(dir, offName)
  const fog = highPass(luma(load(dir, fogName)))
  let rs = 0, rn = 0, gs = 0, gn = 0
  for (let p = 0; p < W * H; p++) {
    if (route[p]) continue
    const i = p * 4
    // Stock `light` paints road fills near-white; the land between them is ≤ 226. 245 splits them.
    const road = off[i] >= 245 && off[i + 1] >= 245 && off[i + 2] >= 245
    if (road) { rs += fog[p]; rn++ } else { gs += fog[p]; gn++ }
  }
  return { delta: rs / rn - gs / gn, roadPx: rn, groundPx: gn }
}

/* ─── label contrast ─────────────────────────────────────────────────────────────────────── */

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

/**
 * Three frames of the same view: `on` (as shipped), `bare` (street names with no halo) and `muted`
 * (street names at opacity 0, same collision). The GLYPH is where `bare` departs from `muted` — the
 * letters' own pixels, fringe included. Its LOCAL BACKGROUND is the 1–2 px ring around the glyph in
 * `on`: the halo where there is one, the ground where there is not. Each label's figure is the WCAG
 * ratio, read in `on`, of the ring's median against the glyph's extreme decile on the far side of it
 * (its darkest tenth for dark text): the letters' solid core, not the antialiased edge a 12 px font is
 * mostly made of.
 */
function labelContrast(dir, onName, bareName, mutedName, route) {
  const on = load(dir, onName)
  const bare = load(dir, bareName)
  const muted = load(dir, mutedName)
  const glyph = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) {
    const i = p * 4
    const d = Math.max(Math.abs(bare[i] - muted[i]), Math.abs(bare[i + 1] - muted[i + 1]), Math.abs(bare[i + 2] - muted[i + 2]))
    if (d > 8) glyph[p] = 1
  }
  // The ring: within 2 px of a glyph pixel and not one. Then group glyph+ring 8-connected per label.
  const ring = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!glyph[y * W + x]) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = y + dy, xx = x + dx
      if (yy >= 0 && yy < H && xx >= 0 && xx < W && !glyph[yy * W + xx]) ring[yy * W + xx] = 1
    }
  }
  const seen = new Uint8Array(W * H)
  const labels = []
  for (let s = 0; s < W * H; s++) {
    if (!glyph[s] || seen[s]) continue
    const stack = [s]
    seen[s] = 1
    const g = []
    const r = []
    let nearRoute = false
    while (stack.length) {
      const p = stack.pop()
      if (glyph[p]) g.push(p)
      else r.push(p)
      if (route[p]) nearRoute = true
      const x = p % W, y = (p / W) | 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
        const q = yy * W + xx
        if ((glyph[q] || ring[q]) && !seen[q]) { seen[q] = 1; stack.push(q) }
      }
    }
    // Under 30 glyph pixels is a fragment, not a name; the route is drawn over everything.
    if (g.length < 30 || nearRoute) continue
    const gl = g.map((p) => lum(on, p * 4)).sort((a, b) => a - b)
    const bg = median(r.map((p) => lum(on, p * 4)))
    const core = median(gl) <= bg ? gl[Math.floor(gl.length * 0.1)] : gl[Math.floor(gl.length * 0.9)]
    labels.push(ratio(core, bg))
  }
  labels.sort((a, b) => a - b)
  const q = (f) => (labels.length ? labels[Math.min(labels.length - 1, Math.floor(labels.length * f))] : NaN)
  return { n: labels.length, min: labels[0] ?? NaN, p10: q(0.1), median: q(0.5) }
}

/* ─── run ────────────────────────────────────────────────────────────────────────────────── */

mkdirSync(OUT, { recursive: true })
const summary = { ghost: {}, labels: {} }
let failed = 0
for (const zoom of ZOOMS) {
  const dir = join(OUT, `z${zoom}`)
  mkdirSync(dir, { recursive: true })
  const cfg = join(dir, "variants.json")
  writeFileSync(cfg, JSON.stringify(variants(), null, 2))
  // `--reuse` measures the PNGs already in --out, for iterating on the analysis without the network.
  if (!args.includes("--reuse")) {
    execFileSync(process.execPath, [join(ROOT, "tools/fog-harness/tune.mjs"), cfg, "--zoom", String(zoom), "--out", dir], { stdio: "inherit" })
  }

  const route = routeMask(zoom)
  for (const [name, off, fog] of [
    ["atlas (0.55)", "geo-off-atlas", "geo-atlas"],
    ["adventure (0.90)", "geo-off-adventure", "geo-adventure"],
    ["adventure at the 0.94 ceiling", "geo-off-adventure", "geo-ceiling"],
    ["SABOTAGE: adventure at 1.0", "geo-off-adventure", "geo-sabotage"],
  ]) {
    const g = ghost(dir, off, fog, route)
    summary.ghost[`z${zoom} ${name}`] = g
    const sabotage = name.startsWith("SABOTAGE")
    const ok = sabotage ? Math.abs(g.delta) < 0.25 : g.delta >= 1
    if (!ok) failed++
    console.log(`${ok ? "ok  " : "FAIL"} ghost z${zoom} ${name.padEnd(30)} Δ road−ground ${g.delta.toFixed(2)} (8-bit luma; ${g.roadPx} road / ${g.groundPx} ground px)`)
  }
  for (const m of MODES) {
    const stock = labelContrast(dir, `lbl-${m}-off`, `bare-${m}-off`, `mute-${m}-off`, route)
    for (const g of GROUNDS) {
      const r = g === "off" ? stock : labelContrast(dir, `lbl-${m}-${g}`, `bare-${m}-${g}`, `mute-${m}-${g}`, route)
      summary.labels[`z${zoom} ${m} ${GROUND_NAME[g]}`] = r
      /**
       * What is JUDGED is the one thing the design pins: revealed ground reads exactly as the stock
       * map does, in both modes — the fog takes nothing from it (D-051). Unexplored ground is RECORDED.
       * Atlas's names sit above the fog there (D-368) and must be present; how much contrast they keep
       * against the fog is a number no design doc sets a floor for (ticket 0099's record holds it).
       * Adventure's are under the fog by design (05 §5.3: adventure hides names, not geometry — the
       * ghost grid above is its D-051 guarantee).
       */
      /**
       * `0100`. Cold ground (every cell a year old). ADVENTURE must read exactly as revealed ground —
       * no cold territory there, D-133. ATLAS draws the names above the wash (D-368), so every name is
       * present; the wash darkens the ground just past the halo, which the 2 px ring includes, so the
       * ratio is RECORDED against stock, and judged only to be no worse than the fog's own (06 §4.6:
       * cold ground is never darker than the fog).
       */
      const unexplored = summary.labels[`z${zoom} ${m} ${GROUND_NAME.none}`]
      const judged = g === "all" || (g === "none" && m === "atlas") || g === "cold"
      const ok = !judged
        ? true
        : g === "all" || (g === "cold" && m === "adventure")
          ? r.n > 0 && r.median >= stock.median * 0.99
          : g === "cold"
            ? r.n >= stock.n * 0.8 && r.median > unexplored.median
            : r.n >= stock.n * 0.8
      if (!ok) failed++
      console.log(
        `${judged ? (ok ? "ok  " : "FAIL") : "    "} labels z${zoom} ${m.padEnd(9)} ${GROUND_NAME[g].padEnd(10)} ` +
          `n=${String(r.n).padStart(3)}  median ${r.median.toFixed(2)}:1  p10 ${r.p10.toFixed(2)}:1  min ${r.min.toFixed(2)}:1` +
          (g === "off" ? "  (the stock map)" : `  (${(r.median / stock.median).toFixed(2)}x stock)`),
      )
    }
  }
}
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2))
console.log(`\nscreenshots: ${join(OUT, "z16", "shot-atlas.png")}, ${join(OUT, "z16", "shot-adventure.png")}`)
console.log(failed ? `MODE PARITY SHOTS FAIL (${failed})` : "MODE PARITY SHOTS PASS")
process.exit(failed ? 1 : 0)
