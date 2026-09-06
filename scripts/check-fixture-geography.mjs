#!/usr/bin/env node
// FIXTURE GEOGRAPHY CHECK — no committed test fixture carries a real location.
//
// docs/08-security-privacy.md §7.2, D-199, ticket 0168.
//
// §7.2 has always said it: "Real GPS traces, GPX/FIT fixtures from actual runs, or a
// dump of ExploredCell" must never be committed, and "Test fixtures are SYNTHETIC
// COORDINATES". It even predicts how it breaks — "this is the repo-hygiene rule most
// likely to be broken by someone being helpful". Ticket 0038 then instructed exactly
// that: capture real responses "redacted of tokens, NOT OF SHAPE", ~2,700 latlng points
// per fixture, into a repository that is public. The rule was not missing. It was
// unenforced, and a rule nobody can run is a sentence in a document.
//
// This is the enforcement. github.com/Oofles/lost-soles is public and a git blob that
// has been cloned cannot be recalled, so this check runs on the PRE-COMMIT path as well
// as in CI — the only two places that are still upstream of "permanently".
//
// ─── WHY THIS IS AN ALLOWLIST ───────────────────────────────────────────────
//
// The obvious guard is "no coordinate near where the operator runs". It cannot be
// written. Expressing it requires committing where the operator runs, which is the leak,
// written into the repo in order to prevent the leak. So the assertion is inverted:
// every committed coordinate must be inside one small box in the South Pacific.
//
// That inversion is also why the check is strong rather than merely indicative. A
// denylist has to anticipate the leak; an allowlist fails closed on anything it has
// never seen, including a fixture from an adapter that does not exist yet.
//
// Written in plain node, no dependencies, no ripgrep — same reason as
// check-boundaries.mjs: it runs in the GitHub Actions gate, in the Amplify build
// container (which has no rg), and in a git hook.
//
//   node scripts/check-fixture-geography.mjs              check every fixture
//   node scripts/check-fixture-geography.mjs <file>...    check named files (pre-commit)
//   node scripts/check-fixture-geography.mjs --self-test  prove it FAILS on a real track

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

/**
 * POINT NEMO — 48°52.6′S 123°23.6′W, the oceanic pole of inaccessibility. The point on
 * Earth farthest from any land: ~2,688 km from the nearest coast in every direction.
 * Nobody has run there and nobody is going to.
 *
 * The radius is generous on purpose. A synthetic track needs room to be a few kilometres
 * long without tripping its own guard, and there is no cost to slack in the middle of an
 * ocean — the box contains no streets to be recognised.
 */
export const NEMO = { lat: -48.876, lng: -123.393 }
export const RADIUS_DEG = 0.05 // ~5.5 km of latitude. Generous for a track; nowhere.

/** Fixture directories are found by NAME, so a future adapter's is covered on arrival. */
const FIXTURE_DIR = "__fixtures__"

/** Directories never worth walking. */
const SKIP = new Set(["node_modules", ".next", ".amplify", ".git", ".claude"])

/**
 * Keys that carry a coordinate in a Strava-shaped payload, and in most others.
 *
 * `latlng` is the stream. `start_latlng`/`end_latlng` sit on the activity DETAIL, and
 * they are the carrier the first version of this guard missed: it checked
 * `streams.latlng.data` only, so a fixture could have passed while publishing the
 * operator's front door twice over in two scalar fields.
 *
 * `polyline`/`summary_polyline` are the encoded form. D-121 forbids the app from ever
 * USING a summary_polyline, but a captured detail response contains one regardless, and
 * an encoded string is not less of a location for being unreadable to a human.
 */
const POINT_KEYS = new Set(["latlng", "start_latlng", "end_latlng"])
const POLYLINE_KEYS = new Set(["polyline", "summary_polyline"])

const inBox = (lat, lng) =>
  Math.abs(lat - NEMO.lat) < RADIUS_DEG && Math.abs(lng - NEMO.lng) < RADIUS_DEG

/**
 * Google's encoded-polyline format, decoder only.
 *
 * Inlined rather than taken from a dependency because this file must run in the Amplify
 * container before `npm install` has necessarily done anything useful, and because a
 * security guard that can be disabled by a resolution failure is not a guard. ~20 lines.
 */
export function decodePolyline(encoded) {
  const points = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    for (const which of [0, 1]) {
      let result = 0
      let shift = 0
      let byte
      do {
        if (index >= encoded.length) return points // truncated: stop, keep what decoded
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lng += delta
    }
    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

/**
 * The same format, encoding. Lives next to the decoder because a fixture that carries a
 * `summary_polyline` must carry a REAL one — a placeholder string is not a location, but
 * it is not a Strava response either, and this check cannot tell the two apart without
 * failing open on every string it happens not to understand. So it fails closed, and the
 * fixtures are given genuine encoded synthetic geometry instead. Used by
 * scripts/make-strava-fixture.mjs; exported here so the self-test can round-trip it.
 */
export function encodePolyline(points) {
  let lastLat = 0
  let lastLng = 0
  let out = ""

  const chunk = (delta) => {
    let v = delta < 0 ? ~(delta << 1) : delta << 1
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    out += String.fromCharCode(v + 63)
  }

  for (const [lat, lng] of points) {
    const iLat = Math.round(lat * 1e5)
    const iLng = Math.round(lng * 1e5)
    chunk(iLat - lastLat)
    chunk(iLng - lastLng)
    lastLat = iLat
    lastLng = iLng
  }
  return out
}

const isPair = (v) =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number"

/**
 * Walks any JSON value and yields every coordinate it can find, wherever it sits.
 *
 * Structural rather than path-based on purpose. `sealRawEnvelope` nests the detail under
 * `.detail` today; ticket 0039's archive layout nests it differently; a future adapter
 * will nest it somewhere else again. A guard keyed to one path would go quietly green the
 * first time the shape moved, which is the failure mode that makes a security check worse
 * than no check — it reports "clean" for a directory it is no longer reading.
 */
export function coordinatesIn(value, path = "") {
  const found = []

  const walk = (node, at) => {
    if (node === null || typeof node !== "object") return

    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${at}[${i}]`))
      return
    }

    for (const [key, v] of Object.entries(node)) {
      const here = at ? `${at}.${key}` : key

      if (POINT_KEYS.has(key)) {
        // Either a bare [lat, lng] (detail) or a stream object { data: [[lat,lng], ...] }.
        if (isPair(v)) found.push({ at: here, lat: v[0], lng: v[1] })
        const data = v && typeof v === "object" && !Array.isArray(v) ? v.data : v
        if (Array.isArray(data)) {
          data.forEach((p, i) => {
            if (isPair(p)) found.push({ at: `${here}[${i}]`, lat: p[0], lng: p[1] })
          })
        }
      }

      if (POLYLINE_KEYS.has(key) && typeof v === "string" && v.length > 0) {
        // An empty polyline is the correct value for a GPS-less activity, not a finding.
        // Anything non-empty is decoded and judged as coordinates like any other.
        const pts = decodePolyline(v)
        if (pts.length === 0) {
          // A non-empty string that decodes to nothing is not a location, but it is not
          // recognisably anything else either. Report it rather than pass it.
          found.push({ at: here, lat: NaN, lng: NaN, note: "undecodable polyline" })
        }
        pts.forEach(([lat, lng], i) => found.push({ at: `${here}#${i}`, lat, lng }))
      }

      walk(v, here)
    }
  }

  walk(value, path)
  return found
}

function jsonFilesUnder(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...jsonFilesUnder(full))
    else if (entry.endsWith(".json")) out.push(full)
  }
  return out
}

/** Every `__fixtures__` directory in the tree, found by name. */
export function fixtureDirs(base = ROOT) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.name === FIXTURE_DIR) out.push(full)
      else walk(full)
    }
  }
  walk(base)
  return out
}

/**
 * Checks a set of files. Returns `{ findings, checked, files }`.
 *
 * `checked` is the count of coordinates actually examined, and the caller MUST assert it
 * is non-zero. D-176's rule, which this repo has been bitten by more than once: a guard
 * has to be able to tell "I ran and found nothing" from "I never ran", and for a scanner
 * over a directory those two states are both the empty findings list. A fixture directory
 * that got renamed, or a parser that stopped recognising the shape, would otherwise report
 * a clean scan forever.
 */
export function check(files, read = (f) => readFileSync(f, "utf8")) {
  const findings = []
  let checked = 0

  for (const file of files) {
    let parsed
    const text = read(file)
    try {
      parsed = JSON.parse(text)
    } catch {
      continue // not JSON we can read; nothing to assert about its geography
    }

    for (const c of coordinatesIn(parsed)) {
      checked++
      if (Number.isNaN(c.lat) || Number.isNaN(c.lng) || !inBox(c.lat, c.lng)) {
        findings.push({ file: relative(ROOT, file), ...c })
      }
    }
  }

  return { findings, checked, files }
}

/** The whole-tree scan: every JSON in every `__fixtures__` directory. */
export function checkAll(base = ROOT) {
  const files = fixtureDirs(base).flatMap(jsonFilesUnder)
  return check(files)
}

function report({ findings, checked, files }, { requirePoints }) {
  if (findings.length) {
    console.error("\n" + "=".repeat(72))
    console.error("REAL LOCATION IN A COMMITTED FIXTURE — blocked")
    console.error("=".repeat(72) + "\n")
    // Cap the listing. A captured 2,700-point track produces 2,700 findings, and
    // printing them all would scroll the explanation off the screen — while also
    // dumping the very coordinates this check exists to keep out of places they
    // are copied from. Ten is enough to identify the file.
    for (const f of findings.slice(0, 10)) {
      console.error(`  ${f.file}  ${f.at}${f.note ? `  (${f.note})` : ""}`)
    }
    if (findings.length > 10) {
      console.error(`  ... and ${findings.length - 10} more (not printed — they are the payload)`)
    }
    console.error(`
  ${findings.length} coordinate(s) outside the fixture box.

  08 §7.2: test fixtures are SYNTHETIC COORDINATES. This repository is public, and
  a blob that has been cloned cannot be recalled. Capture the real response for its
  SHAPE, then replace the geometry: keep every non-geometric field exactly as the
  provider sent it — field set, stream keys, point count, cadence, index alignment,
  original_size, the gap structure — and generate the coordinates along a synthetic
  path near ${NEMO.lat}, ${NEMO.lng}. See D-199 and src/adapters/strava/__fixtures__/README.md.

  Nothing has been committed.
`)
    return false
  }

  if (requirePoints && checked === 0) {
    console.error(`
  FIXTURE GEOGRAPHY CHECK FOUND NOTHING TO CHECK.

  ${files.length} fixture file(s) were read and not one coordinate was recognised in
  any of them. That is not a pass. Either the fixtures moved out of a '${FIXTURE_DIR}'
  directory, or the payload shape changed and this scanner no longer sees the
  coordinates it is supposed to be guarding.

  A scanner that cannot tell "I ran and found nothing" from "I never ran" fails open,
  which for this check means publishing a real track. Fix the scanner.
`)
    return false
  }

  console.log(
    `No fixture carries a real location. ${checked} coordinate(s) across ${files.length} file(s), all within ${RADIUS_DEG}° of Point Nemo.`,
  )
  return true
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain && process.argv.includes("--self-test")) {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")

  // A real-looking track. NOT a real one — these are Times Square, which is a public
  // landmark and nobody's home. The point is only that it is not Point Nemo.
  const REAL = [
    [40.758, -73.9855],
    [40.7585, -73.9861],
  ]
  const SYNTH = [
    [NEMO.lat, NEMO.lng],
    [NEMO.lat + 0.001, NEMO.lng + 0.001],
  ]

  const CASES = {
    // name: [content, mustFire]
    "streams-real.json": [{ streams: { latlng: { data: REAL } } }, true],
    "streams-synthetic.json": [{ streams: { latlng: { data: SYNTH } } }, false],
    // The carrier the first version of this guard did not look at.
    "detail-start-latlng.json": [{ detail: { start_latlng: REAL[0] } }, true],
    "detail-end-latlng.json": [{ detail: { end_latlng: REAL[1] } }, true],
    // An encoded polyline is a location too.
    "polyline-real.json": [{ detail: { map: { summary_polyline: "_p~iF~ps|U" } } }, true],
    "polyline-empty.json": [{ detail: { map: { summary_polyline: "" } } }, false],
    // Round-trip: what encodePolyline writes, decodePolyline must read back in the box.
    "polyline-synthetic.json": [
      { detail: { map: { summary_polyline: encodePolyline(SYNTH) } } },
      false,
    ],
    // A string that is neither empty nor decodable fails CLOSED. It is not a location,
    // but nothing here can prove that, and "I could not read it" must never mean "clean".
    "polyline-placeholder.json": [{ detail: { map: { summary_polyline: "omitted" } } }, true],
    // Nesting must not matter — the walk is structural, not path-based.
    "deeply-nested.json": [{ a: { b: [{ c: { latlng: { data: REAL } } }] } }, true],
    // One bad point among good ones must still fire.
    "one-bad-point.json": [{ streams: { latlng: { data: [...SYNTH, REAL[0]] } } }, true],
  }

  const base = mkdtempSync(join(tmpdir(), "fixgeo-"))
  try {
    const dir = join(base, "src", "adapters", "example", FIXTURE_DIR)
    mkdirSync(dir, { recursive: true })
    for (const [name, [body]] of Object.entries(CASES)) {
      writeFileSync(join(dir, name), JSON.stringify(body, null, 2))
    }

    // Discovery must work by name, from an arbitrary root.
    const found = fixtureDirs(base)
    if (found.length !== 1) {
      console.error(`  FAIL  fixtureDirs found ${found.length} directories, expected 1`)
      process.exit(1)
    }

    let failed = 0
    for (const [name, [, mustFire]] of Object.entries(CASES)) {
      const { findings } = check([join(dir, name)])
      const fired = findings.length > 0
      const ok = fired === mustFire
      if (!ok) failed++
      console.log(`  ${ok ? "ok  " : "FAIL"}  ${mustFire ? "must fire" : "must pass"}  ${name}`)
    }

    // And the empty-scan guard itself must fire, or every other case is decoration.
    const emptyDir = join(base, "src", "adapters", "empty", FIXTURE_DIR)
    mkdirSync(emptyDir, { recursive: true })
    writeFileSync(join(emptyDir, "no-coords.json"), JSON.stringify({ detail: { id: 1 } }))
    const empty = check([join(emptyDir, "no-coords.json")])
    const emptyBlocked = report(empty, { requirePoints: true }) === false
    console.log(`  ${emptyBlocked ? "ok  " : "FAIL"}  must fire  a scan that recognises zero coordinates`)
    if (!emptyBlocked) failed++

    if (failed) {
      console.error(`\n${failed} self-test case(s) failed — the fixture geography check is broken.`)
      process.exit(1)
    }
    console.log(`\nself-test: ${Object.keys(CASES).length + 2} cases passed — the check fires on a real location.`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
  process.exit(0)
}

if (isMain) {
  // Named files (the pre-commit path) or the whole tree (CI).
  const named = process.argv.slice(2).filter((a) => !a.startsWith("--"))

  // Named-file mode does NOT require points: a commit may legitimately stage a
  // fixture with no coordinates in it at all. The whole-tree scan is where the
  // "did this scanner actually see anything" assertion belongs.

  /**
   * --staged reads each path out of the INDEX rather than the working tree.
   *
   * Without it this check would scan the wrong bytes in the one place it matters most.
   * `git add` a fixture holding a real track, repair the file on disk, commit: the
   * working tree is clean, the index is not, and what gets written to history is the
   * index. Layer 2 of the pre-commit hook already reads staged content via `git show`
   * for exactly this reason; this is the same discipline.
   */
  if (process.argv.includes("--staged")) {
    const { execFileSync } = await import("node:child_process")
    const readStaged = (f) => {
      try {
        return execFileSync("git", ["show", `:${f}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      } catch (err) {
        // git failing to read a path it just reported as staged is a broken guard, not
        // an absent file (D-176). Refuse rather than skip.
        console.error(`\n  Could not read the STAGED content of '${f}': ${err.message}`)
        console.error("  That file was never scanned, so this is not a clean result.\n")
        process.exit(1)
      }
    }
    // Paths must stay repo-relative here — `git show :<path>` is index-addressed.
    process.exit(report(check(named, readStaged), { requirePoints: false }) ? 0 : 1)
  }

  if (named.length) {
    const present = named.map((f) => (f.startsWith("/") ? f : join(ROOT, f))).filter((f) => existsSync(f))
    process.exit(report(check(present), { requirePoints: false }) ? 0 : 1)
  }

  process.exit(report(checkAll(), { requirePoints: true }) ? 0 : 1)
}
