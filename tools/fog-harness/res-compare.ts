/**
 * TICKET 0194 — THE RESOLUTION DECISION, AS A PICTURE RATHER THAN A PARAGRAPH.
 *
 *   npx vite-node tools/fog-harness/res-compare.ts -- [--run <stravaId>] [--res 10,11]
 *
 * NOT A TEST AND NOT A GATE. It re-derives the operator's own archived runs at res 10 and at
 * res 11 and writes `tmp/0194/cells-<res>.json` for `render-cells.mjs` to draw. `0194` turns
 * on one question nobody can answer from prose — does the res-11 corridor follow an angled
 * run visibly better — and this is the cheapest honest way to put both in front of an eye.
 *
 * ─── IT DOES NOT REIMPLEMENT `traceToCells`, AND THAT IS THE WHOLE DESIGN ────
 *
 * Steps 0-3 are `traceToSegments`, exported and shipped. Step 5 is `distancePointToSegments`
 * and `REVEAL_R_M`, exported and shipped. Only step 4 — `latLngToCell` at a resolution the
 * caller names — is written here, because that single line IS the question under test.
 * D-115 stays intact: `src/domain` still emits res 10 only, and nothing here writes anything.
 *
 * Output goes to the gitignored `tmp/` — a picture of this fog names the operator's streets
 * (D-199, `08` §7.2).
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"

import { cellToLatLng, cellToBoundary, gridDisk, latLngToCell, getHexagonEdgeLengthAvg, UNITS } from "h3-js"

import { REVEAL_R_M, distancePointToSegments, traceToSegments } from "../../src/domain/fog"
import { normalizeStrava } from "../../src/adapters/strava/normalize"
import type { IngestJob } from "../../src/adapters/types"

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const RAW = `${ROOT}/tmp/0194/raw`
const OUT = `${ROOT}/tmp/0194`

const args = process.argv.slice(2)
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const RESOLUTIONS = (flag("res") ?? "10,11").split(",").map(Number)
const ONLY = flag("run")

/**
 * Step 4's candidate disc, at a caller-named resolution — the same bound `src/domain/fog.ts`
 * derives for `CANDIDATE_K`, restated here ONLY because this tool indexes at a resolution the
 * shipped constant is not set to. It must not drift: k=1 (what this tool first used) under-reveals
 * at res 11 by exactly the cell that made `CANDIDATE_K` necessary, and a comparison rendered from
 * an under-revealed set would have understated the option it exists to argue for.
 */
const kFor = (res: number) =>
  Math.ceil(
    (REVEAL_R_M + densifyFor(res) / 2 + getHexagonEdgeLengthAvg(res, UNITS.m)) /
      (2 * getHexagonEdgeLengthAvg(res, UNITS.m) * Math.cos(Math.PI / 6)),
  )

/** The same ~0.46-of-inradius ratio `DENSIFY_STEP_M` preserves across a resolution change. */
const densifyFor = (res: number) =>
  getHexagonEdgeLengthAvg(res, UNITS.m) * Math.cos(Math.PI / 6) * 0.46

/** Step 4 + step 5, at a caller-named resolution. The only thing this file writes itself. */
function cellsAt(segments: { lat: number; lng: number }[][], res: number): string[] {
  const candidates = new Set<string>()
  for (const segment of segments) {
    // Densify at a spacing safely under the res's inradius, same reason DENSIFY_STEP_M is
    // under res 10's: a stream that drops points must not skip a cell.
    const step = densifyFor(res)
    for (let i = 0; i < segment.length - 1; i++) {
      const a = segment[i], b = segment[i + 1]
      const d = Math.hypot((b.lat - a.lat) * 111_195, (b.lng - a.lng) * 111_195 * Math.cos(a.lat * Math.PI / 180))
      const n = Math.max(1, Math.ceil(d / step))
      for (let k = 0; k <= n; k++) {
        const lat = a.lat + (b.lat - a.lat) * (k / n), lng = a.lng + (b.lng - a.lng) * (k / n)
        for (const c of gridDisk(latLngToCell(lat, lng, res), kFor(res))) candidates.add(c)
      }
    }
    if (segment.length === 1)
      for (const c of gridDisk(latLngToCell(segment[0].lat, segment[0].lng, res), kFor(res))) candidates.add(c)
  }
  const revealed: string[] = []
  for (const c of candidates) {
    const [lat, lng] = cellToLatLng(c)
    if (distancePointToSegments({ lat, lng }, segments as never) <= REVEAL_R_M) revealed.push(c)
  }
  return revealed
}

const job = { userId: "poc", source: "strava", sourceActivityId: "0" } as unknown as IngestJob
const ref = { bucket: "poc", key: "poc", schemaVersion: 1 } as never

const runs: { id: string; segments: { lat: number; lng: number }[][]; points: number }[] = []
for (const dir of readdirSync(RAW)) {
  if (ONLY && dir !== ONLY) continue
  const file = readdirSync(`${RAW}/${dir}`)[0]
  const raw = readFileSync(`${RAW}/${dir}/${file}`)
  try {
    const { trace } = normalizeStrava(raw, ref, { ...job, sourceActivityId: dir } as IngestJob)
    if (!trace) continue
    const { segments } = traceToSegments(trace)
    runs.push({ id: dir, segments, points: segments.reduce((n, s) => n + s.length, 0) })
  } catch (e) {
    console.error(`  ${dir}: ${(e as Error).message}`)
  }
}

console.log(`${runs.length} runs normalized, ${runs.reduce((n, r) => n + r.points, 0)} points\n`)

for (const res of RESOLUTIONS) {
  const all = new Set<string>()
  const wander: number[] = []
  for (const r of runs) for (const c of cellsAt(r.segments, res)) {
    all.add(c)
    const [lat, lng] = cellToLatLng(c)
    wander.push(distancePointToSegments({ lat, lng }, r.segments as never))
  }
  wander.sort((a, b) => a - b)
  const edge = getHexagonEdgeLengthAvg(res, UNITS.m)
  // §4 / ticket 0055: the render disc is revealScale x circumradius, and the circumradius of
  // an H3 cell is its average edge length.
  const disc = 1.35 * edge
  console.log(
    `res ${res}: ${all.size} cells · wander median ${wander[wander.length >> 1].toFixed(0)} m, ` +
    `p95 ${wander[Math.floor(wander.length * 0.95)].toFixed(0)} m · disc radius ${disc.toFixed(0)} m · ` +
    `corridor ~${(2 * (REVEAL_R_M + disc)).toFixed(0)} m wide`,
  )

  mkdirSync(OUT, { recursive: true })
  writeFileSync(`${OUT}/cells-${res}.json`, JSON.stringify({
    res, discRadiusM: disc,
    cells: [...all].map((c) => { const [lat, lng] = cellToLatLng(c); return [lng, lat] }),
    boundaries: [...all].map((c) => cellToBoundary(c, true)),
    paths: runs.map((r) => r.segments.map((s) => s.map((p) => [p.lng, p.lat]))),
    runIds: runs.map((r) => r.id),
  }))
}
console.log(`\nwrote ${OUT}/cells-{${RESOLUTIONS.join(",")}}.json`)
