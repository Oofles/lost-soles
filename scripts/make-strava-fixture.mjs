#!/usr/bin/env node
// CAPTURE A REAL STRAVA RESPONSE AS A FIXTURE. Ticket 0038, D-199.
//
//   node scripts/make-strava-fixture.mjs <activityId> --name <fixture-name>
//        [--no-streams]          do not ask for streams (a GPS-less activity)
//        [--keep-raw <dir>]      also write the untransformed capture, for eyeballing
//        [--dry-run]             fetch and report, write nothing
//
// ─── THE ONE RULE THIS FILE ENFORCES ────────────────────────────────────────
//
// D-199: real fixtures, SYNTHETIC GEOMETRY. The transform is not a flag and cannot be
// turned off. Every field the code can observe is kept exactly as Strava sent it — the
// field set, the stream keys, the point count, the cadence, index alignment,
// `original_size`, the gap structure, the ids. Only the coordinates are replaced.
//
// A capture tool with an `--allow-real-coordinates` escape hatch is a capture tool that
// will be run with it at 11pm, and github.com/Oofles/lost-soles is public. If you want
// the untransformed response, `--keep-raw` writes it OUTSIDE the repo and this script
// refuses a path inside one.
//
// The written file is re-checked with scripts/check-fixture-geography.mjs before the
// script exits non-zero or zero, so the guard and the generator can never disagree.
//
// ─── WHY THE STEP LENGTHS SURVIVE AND THE BEARINGS DO NOT ───────────────────
//
// The shape of a route IS its sequence of bearings. Its metric properties — total
// distance, speed profile, the magnitude of a signal-loss jump, the point count — are
// its sequence of step LENGTHS. Everything the sanitizer (§2.2, D-197) and the fidelity
// floor actually measure lives in the lengths, and everything identifying lives in the
// bearings. So the transform keeps every step length to the metre and throws the
// bearings away, replacing them with a deterministic sequence that stays inside the
// fixture box. The result is metrically the operator's run and geometrically a scribble
// in the South Pacific.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, resolve, dirname } from "node:path"

import { NEMO, encodePolyline, decodePolyline, check } from "./check-fixture-geography.mjs"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const FIXTURES = join(ROOT, "src/adapters/strava/__fixtures__")
const API = "https://www.strava.com/api/v3"
const SCHEMA_VERSION = 1 // must match raw-envelope.ts

// ── the connection ──────────────────────────────────────────────────────────

/**
 * The access token comes from the SAME DynamoDB row the Lambda reads (T7), not from an
 * env var. Two reasons: there is then no second place a live token can be pasted, and a
 * capture that works proves the real connection works.
 */
function accessToken() {
  const userId = process.env.LOST_SOLES_USER_ID ?? "5488e4b8-d081-7014-748e-edd1937f8083"
  const out = execFileSync(
    "aws",
    [
      "dynamodb", "get-item",
      "--table-name", "LostSolesSourceAccount",
      "--profile", process.env.AWS_PROFILE ?? "devault",
      "--region", "us-east-1",
      "--key", JSON.stringify({ pk: { S: `U#${userId}` }, sk: { S: "SRC#strava" } }),
      "--query", "Item.accessToken.S",
      "--output", "text",
    ],
    { encoding: "utf8" },
  ).trim()
  if (!out || out === "None") throw new Error("no access token on the strava source row")
  return out
}

/** Rate-limit headers, printed on every call. §2.5: read them, do not model the budget. */
function reportBudget(res) {
  const usage = res.headers.get("x-readratelimit-usage")
  const limit = res.headers.get("x-readratelimit-limit")
  if (usage && limit) console.log(`    read budget: ${usage} of ${limit}  (15min,daily)`)
}

async function get(token, path, query = {}) {
  const url = new URL(API + path)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } })
  reportBudget(res)
  return res
}

// ── the transform ───────────────────────────────────────────────────────────

const R_EARTH = 6_371_000
const toRad = (d) => (d * Math.PI) / 180
const toDeg = (r) => (r * 180) / Math.PI

/** Great-circle distance in metres. Haversine — the step lengths must survive exactly. */
function haversine(a, b) {
  const [lat1, lon1] = a
  const [lat2, lon2] = b
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Move `metres` along `bearing` (radians) from a point. Equirectangular is ample here. */
function step([lat, lng], metres, bearing) {
  const dLat = (metres * Math.cos(bearing)) / R_EARTH
  const dLng = (metres * Math.sin(bearing)) / (R_EARTH * Math.cos(toRad(lat)))
  return [lat + toDeg(dLat), lng + toDeg(dLng)]
}

/**
 * A deterministic PRNG. Seeded from the activity id, so re-capturing the same activity
 * produces a byte-identical fixture and a re-run shows an empty diff rather than a
 * thousand changed coordinates nobody can review.
 */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** How far the walk may stray from Point Nemo. Well inside the guard's 0.05°. */
const CONTAIN_M = 2_000

/**
 * Rebuilds a track: same length, same point count, same step lengths, new bearings.
 *
 * The containment rule is a reflection, not a clamp. Clamping a coordinate would SHORTEN
 * that step and silently corrupt the one property the whole transform exists to preserve
 * — and a fixture with a quietly wrong distance is worse than no fixture, because the
 * fidelity floor it is supposed to be testing would then be measured against a lie.
 * Steering the BEARING keeps every step length exact.
 */
function synthesise(points, seed) {
  if (points.length === 0) return []
  const rand = mulberry32(seed)
  const origin = [NEMO.lat, NEMO.lng]
  const out = [origin]

  for (let i = 1; i < points.length; i++) {
    const metres = haversine(points[i - 1], points[i])
    const from = out[i - 1]

    // Random bearing, but if we are near the edge of the box, aim back towards the
    // middle instead. A 2,700-point random walk of 5 m steps drifts ~260 m, so this
    // fires rarely — it exists for the signal-loss fixture, whose single 400 m jump can
    // cross the boundary on its own.
    let bearing = rand() * 2 * Math.PI
    if (haversine(from, origin) > CONTAIN_M * 0.8) {
      const back = Math.atan2(origin[1] - from[1], origin[0] - from[0])
      bearing = back + (rand() - 0.5) * (Math.PI / 2)
    }
    out.push(step(from, metres, bearing))
  }

  // SIX decimal places, because that is what Strava sends — measured, not assumed: of the
  // first 500 points of a real capture, 458 carry 6 dp and 38 carry 5. Matching the source
  // is the point of a captured fixture.
  //
  // It also matters metrically. Rounding to 5 dp (~1 m) against a mean step of ~2.4 m put
  // 1.5-2.7% of error into the total path length, which is error injected into the exact
  // quantity the fidelity floor measures. At 6 dp it is ~0.2%.
  return out.map(([lat, lng]) => [Number(lat.toFixed(6)), Number(lng.toFixed(6))])
}

/**
 * A REAL DETAIL RESPONSE LEAKS IN MORE PLACES THAN THE TRACK, and every one of them was
 * found by running this tool rather than by reading the API docs:
 *
 *   detail.segment_efforts[].segment.start_latlng / end_latlng / map.polyline
 *                              exact coordinates of a segment near the operator's route.
 *                              Caught by the post-write re-check on the first capture.
 *   detail.segment_efforts[].segment.city / state / country
 *                              "Ponte Vedra Beach, Florida". A place name is a location
 *                              even though no guard that scans for coordinates sees it.
 *   detail.segment_efforts[].name, .segment.name
 *                              named local landmarks.
 *   detail.location_city / _state / _country
 *                              null on this account, populated on many others.
 *   detail.embed_token         A LIVE TOKEN. Criterion 2 of this ticket forbids it outright.
 *   detail.name, .description  user-authored free text; "Night Run" is harmless and
 *                              "Run to the office" is not, and a capture tool cannot tell.
 *
 * So the scrub is an ALLOWLIST of what survives, applied to a named set of fields, for the
 * same reason the geography guard is an allowlist: a denylist of place names would have to
 * enumerate the operator's places, which is the leak written down to prevent the leak.
 */

/** Coordinate carriers, matching scripts/check-fixture-geography.mjs. */
const POINT_KEYS = new Set(["latlng", "start_latlng", "end_latlng"])
const POLYLINE_KEYS = new Set(["polyline", "summary_polyline"])

/** Free text and place names, replaced with an obviously-synthetic constant. */
const PLACE_KEYS = new Set(["city", "state", "country", "location_city", "location_state", "location_country"])
const TEXT_KEYS = new Set(["name", "description", "external_id", "device_name"])
/** Credentials. Removed, never rewritten — an empty string is still a shape. */
const TOKEN_KEYS = new Set(["embed_token"])

export const SYNTHETIC_PLACE = "Point Nemo"
export const SYNTHETIC_TEXT = "synthetic"

const isPair = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number"

/**
 * Rewrites EVERY coordinate in the payload, wherever it sits, from one synthetic track.
 *
 * Scalar coordinates elsewhere in the payload (a segment's start, the activity's end) are
 * mapped through the track rather than dropped at the origin: find the nearest point on
 * the REAL track and emit the synthetic point at that same index. A segment that began a
 * third of the way into the run still begins a third of the way into the synthetic one, so
 * the fixture keeps its internal consistency — the relationship survives and the location
 * does not.
 */
function rewriteGeometry(node, real, synthetic) {
  const nearestIndex = (p) => {
    if (!real.length) return -1
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < real.length; i++) {
      const d = haversine(real[i], p)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }
  // Anything with no track to map through lands on a deterministic ring around Nemo, so
  // two different segments do not collapse onto the same point.
  let spare = 0
  const fallback = () => {
    const a = (spare++ * 2.399963) % (2 * Math.PI)
    return step([NEMO.lat, NEMO.lng], 300 + spare * 25, a).map((n) => Number(n.toFixed(6)))
  }
  const map1 = (p) => {
    const i = nearestIndex(p)
    return i >= 0 ? synthetic[i] : fallback()
  }

  const walk = (n) => {
    if (n === null || typeof n !== "object") return
    if (Array.isArray(n)) return n.forEach(walk)

    for (const [key, v] of Object.entries(n)) {
      if (TOKEN_KEYS.has(key)) {
        delete n[key]
        continue
      }
      if (POINT_KEYS.has(key)) {
        if (isPair(v)) {
          n[key] = map1(v)
          continue
        }
        if (v && typeof v === "object" && Array.isArray(v.data)) {
          v.data = v.data.map((p) => (isPair(p) ? map1(p) : p))
          continue
        }
      }
      if (POLYLINE_KEYS.has(key) && typeof v === "string" && v.length) {
        const decoded = decodePolyline(v)
        // Re-encoded at the SAME point count, so the field stays the size and shape
        // Strava sends. summary_polyline is Strava's decimated form and stays decimated.
        n[key] = encodePolyline(decoded.map(map1))
        continue
      }
      if (PLACE_KEYS.has(key) && typeof v === "string" && v.length) {
        n[key] = SYNTHETIC_PLACE
        continue
      }
      if (TEXT_KEYS.has(key) && typeof v === "string" && v.length) {
        n[key] = SYNTHETIC_TEXT
        continue
      }
      walk(v)
    }
  }
  walk(node)
}

/** Applies the whole D-199 transform to one captured envelope, in place. */
function transform(detail, streams, seed) {
  const real = streams?.latlng?.data
  const synthetic = Array.isArray(real) ? synthesise(real, seed) : []

  // The stream itself first, so the mapping table exists before anything is mapped
  // through it. `original_size` is NOT touched: it is the source's claim about how many
  // points it recorded, and the fidelity floor exists to compare it with what arrived.
  if (synthetic.length) streams.latlng.data = synthetic

  rewriteGeometry(detail, Array.isArray(real) ? real : [], synthetic)
  return synthetic.length
}

/**
 * Pretty-print the STRUCTURE, keep the DATA on one line each.
 *
 * `JSON.stringify(envelope, null, 2)` puts every element of every array on its own line,
 * which turns a 2,537-point `latlng` stream into ~10,000 lines and a fixture nobody will
 * ever open. Compact `stringify` is the other extreme: one 110 KB line, faithful to what
 * Strava actually sends and equally unreadable, with a diff that says "1 line changed".
 *
 * So: indent the object structure so the field set and the stream keys can be READ and
 * reviewed, and collapse each `data` array onto a single line. A re-capture then produces
 * a diff of a handful of lines rather than ten thousand.
 */
function formatFixture(value) {
  const compactArrays = new WeakSet()
  const mark = (node) => {
    if (Array.isArray(node)) {
      // An array of numbers, or of [lat, lng] pairs: nothing structural to indent.
      const flat = node.every(
        (v) => typeof v === "number" || v === null ||
          (Array.isArray(v) && v.every((n) => typeof n === "number")),
      )
      if (flat && node.length > 4) compactArrays.add(node)
      else node.forEach(mark)
    } else if (node && typeof node === "object") {
      Object.values(node).forEach(mark)
    }
  }
  mark(value)

  const write = (node, indent) => {
    const pad = "  ".repeat(indent)
    const padIn = "  ".repeat(indent + 1)

    if (Array.isArray(node)) {
      if (compactArrays.has(node)) return JSON.stringify(node)
      if (node.length === 0) return "[]"
      return "[\n" + node.map((v) => padIn + write(v, indent + 1)).join(",\n") + "\n" + pad + "]"
    }
    if (node && typeof node === "object") {
      const keys = Object.keys(node)
      if (keys.length === 0) return "{}"
      return (
        "{\n" +
        keys.map((k) => `${padIn}${JSON.stringify(k)}: ${write(node[k], indent + 1)}`).join(",\n") +
        "\n" + pad + "}"
      )
    }
    return JSON.stringify(node)
  }

  return write(value, 0) + "\n"
}

// ── main ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(`--${n}`)
const opt = (n) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const activityId = argv.find((a) => /^\d+$/.test(a))
const name = opt("name")

if (!activityId || !name) {
  console.error("usage: make-strava-fixture.mjs <activityId> --name <fixture-name> [--no-streams] [--keep-raw <dir>] [--dry-run]")
  process.exit(2)
}

const token = accessToken()

console.log(`\n  activity ${activityId} -> ${name}.json`)

const detailRes = await get(token, `/activities/${activityId}`, { include_all_efforts: "false" })
if (!detailRes.ok) {
  console.error(`  detail failed: ${detailRes.status} ${await detailRes.text()}`)
  process.exit(1)
}
const detailText = await detailRes.text()

let streamsText = null
let streamsStatus = null
if (!flag("no-streams")) {
  // D-121: the FULL latlng stream, and never resolution/series_type — ticket 0035.
  const r = await get(token, `/activities/${activityId}/streams`, {
    keys: "latlng,time,altitude,distance,heartrate,cadence,velocity_smooth",
    key_by_type: "true",
  })
  streamsStatus = r.status
  // A 404 on /streams is NOT an error (§2.5) — it means the activity has no streams,
  // and `null` is the fact worth archiving. Ticket 0035 established this.
  streamsText = r.status === 404 ? null : await r.text()
  if (r.status !== 200 && r.status !== 404) {
    console.error(`  streams failed: ${r.status} ${streamsText}`)
    process.exit(1)
  }
}

const detail = JSON.parse(detailText)
const streams = streamsText ? JSON.parse(streamsText) : null

// The ids must not have been corrupted on the way in. json-ids.ts exists because
// JSON.parse silently truncates an int64 — here we can at least prove it did not happen,
// by comparing against the digits on the wire.
for (const [label, value] of [["activity.id", detail.id], ["upload_id", detail.upload_id]]) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    console.error(`  ${label} exceeds 2^53 and JSON.parse has already corrupted it. Refusing.`)
    process.exit(1)
  }
}

if (opt("keep-raw")) {
  const dir = resolve(opt("keep-raw"))
  if (dir.startsWith(ROOT)) {
    console.error(`  --keep-raw must write OUTSIDE the repository. '${dir}' is inside it.`)
    process.exit(1)
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.detail.json`), detailText)
  if (streamsText) writeFileSync(join(dir, `${name}.streams.json`), streamsText)
  console.log(`    raw capture kept in ${dir} (outside the repo, never committed)`)
}

const before = streams?.latlng?.data?.length ?? 0
const moved = transform(detail, streams, Number(activityId) % 2147483647)

console.log(`    streams: ${streamsStatus ?? "not requested"}${streams ? `  keys: ${Object.keys(streams).join(",")}` : "  (null)"}`)
console.log(`    latlng points: ${before}${before ? `  -> ${moved} synthetic` : ""}`)
if (streams?.latlng) console.log(`    original_size: ${streams.latlng.original_size} (untouched)`)

const envelope = { schemaVersion: SCHEMA_VERSION, source: "strava", detail, streams }

if (flag("dry-run")) {
  console.log("    --dry-run: nothing written\n")
  process.exit(0)
}

const out = join(FIXTURES, `${name}.json`)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, formatFixture(envelope))

// THE GENERATOR DOES NOT GET TO VOUCH FOR ITSELF. Re-read what was written and put it
// through the same check the pre-commit hook runs. If the two ever disagree, the file is
// removed rather than left on disk for someone to `git add` later.
const { findings, checked } = check([out])
if (findings.length) {
  const { unlinkSync } = await import("node:fs")
  unlinkSync(out)
  console.error(`\n  WROTE A REAL LOCATION AND DELETED IT AGAIN — the transform is broken.`)
  for (const f of findings.slice(0, 5)) console.error(`    ${f.at}`)
  process.exit(1)
}

console.log(`    wrote ${out.replace(ROOT + "/", "")}  (${checked} coordinate(s) verified in the box)\n`)
