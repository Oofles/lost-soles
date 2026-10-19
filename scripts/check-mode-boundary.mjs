#!/usr/bin/env node
// THE MAP MODE IS A LOOK. IT HAS NO PATH BACK TO WHAT IS REVEALED OR SCORED.
// `05-fog-of-war.md` §5.4, ticket 0099 criterion 3.
//
// Atlas and adventure are a shader-uniform and style-layer switch, entirely client-side (05 §5.2).
// Neither may change the revealed set (the map never re-fogs, D-020) or a single XP (D-135). The
// cheapest way to make that impossible rather than merely untrue is to make the mode's NAME
// unreachable from everywhere that is not drawing the map: a value that cannot be named cannot be
// read, and a projection, an XP rule or a Lambda that cannot read the mode cannot depend on it.
//
// ONE RULE, AS AN ALLOWLIST. The mode's identifiers may appear only in:
//
//   - the renderer      lib/fog/, lib/basemap*, lib/map-layers*, lib/landmarks/markers*,
//                       lib/trace-web/, components/map/
//   - the UI toggle     lib/map-mode*, components/map/mode-toggle.tsx, components/map/use-map-mode.ts
//   - the run-moment    lib/run-moment/mode.ts (+ its tests), app/run/[activityId]/ — the page that
//     seam             plays beat 1 in adventure and hands the saved mode back to MapShell (0098, 0254)
//
// Everything else under the shipped roots — src/ (domain, pipeline, adapters), amplify/ (every
// Lambda, the backend), rules/, the rest of app/ and lib/ — fails the build on a single hit. An
// allowlist rather than a denylist because the question is not "did it reach projection, XP or
// ingest" (three names someone can forget to add a fourth to) but "did it leave the renderer".
//
// ONE PRE-EXISTING EXCEPTION, BY LINE, NOT BY FILE. `Profile.mapMode` is a preference column `02` T1
// declared before 05 §5.3 made the mode a per-device localStorage setting. No code reads it. The
// schema line and the test that pins its owner-write grant are allowed EXACTLY; any other line of
// those two files naming the mode fails like anywhere else. (Whether the column should exist at all
// is ticket 0099's open question, not this gate's.)
//
// WHAT IS MATCHED: code lines only — a `//`, `*` or `/*` line is prose, and a scoring module must
// stay free to explain that the mode cannot reach it. Matched case-insensitively where the name has
// a spelling family (`mapMode`, `map-mode`, `MAP_MODE`), exactly where it does not.
//
// Plain node, no dependencies, no ripgrep: it runs in both the GitHub gate and the Amplify build
// container, which has no rg (D-163).
//
//   node scripts/check-mode-boundary.mjs              check
//   node scripts/check-mode-boundary.mjs --self-test  prove it FAILS on a real hit

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

/** What ships: every root whose code reaches the browser bundle, a Lambda, or the backend. */
const ROOTS = ["app", "components", "lib", "src", "amplify", "rules", "middleware.ts"]

const PATTERNS = [
  // The type and its aliases, and the constant maps keyed by it.
  /\b(MapMode|RenderMode|FogMode|BasemapVariant|ModeFrame|MODE_FRAMES|FOG_MODES|BASEMAP_VARIANTS|DEFAULT_MAP_MODE|DEFAULT_BASEMAP_VARIANT)\b/,
  // The spelling family: mapModeStore, useMapMode, savedRenderMode, "lost-soles:map-mode", "@/lib/map-mode".
  /map[_-]?mode|render[_-]?mode/i,
  // The per-mode palettes and the swap, by name.
  /\b(ATLAS|ADVENTURE|basemapFlag|swapBasemap|lerpPalette|lerpFrame)\b/,
  // The modules that own it, by import path.
  /basemap-style|run-moment\/mode\b/,
  // The enum's values as literals — a `switch` on "atlas" outside the renderer is the leak itself.
  /["'`](atlas|adventure)["'`]/,
]

/** Files (relative, `/`-separated) where naming the mode is the file's job. */
const ALLOW = [
  // the renderer
  /^lib\/fog\//,
  /^lib\/basemap(-style|-swap)?(\.test)?\.ts$/,
  /^lib\/map-layers(\.test)?\.ts$/,
  /^lib\/landmarks\/markers(\.test)?\.ts$/,
  /^lib\/trace-web\//,
  /^components\/map\//,
  // the toggle
  /^lib\/map-mode(\.test)?\.ts$/,
  // the run-moment seam
  /^lib\/run-moment\/mode\.ts$/,
  /^lib\/run-moment\/[^/]+\.test\.tsx?$/,
  /^app\/run\/\[activityId\]\//,
]

/** Exact lines allowed in an otherwise policed file. See the header: one column, one test. */
const ALLOW_LINES = {
  "amplify/data/resource.ts": [/^\s*mapMode: a\.string\(\),\s*$/],
  "amplify/profile-model.test.ts": [/^\s*it\.each\(\["displayName", "mapMode", "showColdTerritory", "rulesVersionPinned"\]\)\($/],
}

const SKIP_DIRS = new Set(["node_modules", ".next", ".amplify", ".git", "dist", "build", "cdk.out"])
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]
const COMMENT = /^\s*(\/\/|\*|\/\*)/

function walk(path, out = []) {
  if (!existsSync(path)) return out
  if (!statSync(path).isDirectory()) {
    if (EXTS.some((e) => path.endsWith(e))) out.push(path)
    return out
  }
  for (const name of readdirSync(path)) {
    if (SKIP_DIRS.has(name)) continue
    walk(join(path, name), out)
  }
  return out
}

function files(base) {
  return ROOTS.flatMap((r) => walk(join(base, r)))
}

function scan(base = ROOT) {
  const hits = []
  for (const file of files(base)) {
    const rel = relative(base, file).split(sep).join("/")
    if (ALLOW.some((a) => a.test(rel))) continue
    const okLines = ALLOW_LINES[rel] ?? []
    const lines = readFileSync(file, "utf8").split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (COMMENT.test(line)) continue
      if (!PATTERNS.some((p) => p.test(line))) continue
      if (okLines.some((p) => p.test(line))) continue
      hits.push({ rel, n: i + 1, line: line.trim() })
    }
  }
  return hits
}

if (process.argv.includes("--self-test")) {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")

  const FIXTURE = {
    // [line, mustFire]
    // The scoring side — each of 05 §5.4's named places, and a Lambda.
    "src/domain/leak-type.ts": ['import type { MapMode } from "@/lib/map-mode"', true],
    "src/pipeline/leak-literal.ts": ['if (profile.mode === "atlas") xp *= 2', true],
    "src/domain/leak-store.ts": ["const m = mapModeStore()?.get()", true],
    "amplify/functions/process-activity/leak.ts": ["const { mapMode } = profile", true],
    "amplify/functions/ingest-webhook/leak.ts": ['import { FOG_MODES } from "../../../lib/fog/fog-uniforms"', true],
    "src/adapters/x/leak-variant.ts": ['const v: BasemapVariant = "adventure"', true],
    "lib/runs/leak-seam.ts": ['import { savedRenderMode } from "@/lib/run-moment/mode"', true],
    "lib/skills/leak-palette.ts": ["const p = ADVENTURE.maxOpacity", true],
    "app/settings/leak.tsx": ["const k = 'lost-soles:map-mode'", true],
    // The allowed homes.
    "lib/fog/fog-uniforms.ts": ['export const FOG_MODES = { atlas: ATLAS, adventure: ADVENTURE }', false],
    "lib/map-mode.ts": ['export type MapMode = BasemapVariant', false],
    "components/map/mode-toggle.tsx": ['onClick={() => mapModeStore()?.set("atlas")}', false],
    "lib/run-moment/mode.ts": ['export const SEQUENCE_MODE: RenderMode = "adventure"', false],
    "app/run/[activityId]/run-moment.tsx": ["const savedMode = useMapMode()", false],
    // Prose is free: a domain module must be able to say the mode cannot reach it.
    "src/domain/prose.ts": ["// the atlas/adventure MapMode never reaches scoring (05 §5.4)", false],
    // Words that merely contain a mode's letters.
    "src/domain/near-miss.ts": ["const atlasCount = adventureLog.length // not quoted, not an identifier", false],
    // The one column, exactly — and only that line.
    "amplify/data/resource.ts": ["      mapMode: a.string(),", false],
    "amplify/data/resource-2.ts": ["      mapMode: a.string(),", true],
  }
  // The same file must still fire on any OTHER line naming the mode.
  const EXTRA = { "amplify/data/resource.ts": ['const m: MapMode = "atlas"'] }

  const base = mkdtempSync(join(tmpdir(), "modeboundary-"))
  try {
    for (const [rel, [body]] of Object.entries(FIXTURE)) {
      const full = join(base, rel)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, `${body}\n`)
    }
    const caught = new Set(scan(base).map((h) => h.rel))
    let failed = 0
    for (const [rel, [, shouldFire]] of Object.entries(FIXTURE)) {
      const ok = caught.has(rel) === shouldFire
      if (!ok) failed++
      console.log(`  ${ok ? "ok" : "FAIL"}  ${shouldFire ? "must fire " : "must pass"}  ${rel}`)
    }
    for (const [rel, extra] of Object.entries(EXTRA)) {
      writeFileSync(join(base, rel), `${FIXTURE[rel][0]}\n${extra.join("\n")}\n`)
    }
    const allowedLineFile = scan(base).filter((h) => h.rel === "amplify/data/resource.ts")
    const extraOk = allowedLineFile.length === 1 && allowedLineFile[0].n === 2
    if (!extraOk) failed++
    console.log(`  ${extraOk ? "ok" : "FAIL"}  must fire   amplify/data/resource.ts on a line other than the allowed column`)
    if (files(base).length === 0) {
      failed++
      console.log("  FAIL  the self-test fixture was not scanned at all")
    }
    if (failed) {
      console.error(`\n${failed} self-test case(s) failed — the mode boundary gate is broken.`)
      process.exit(1)
    }
    console.log(
      `\nself-test: ${Object.keys(FIXTURE).length + 1} cases passed — the gate fires on the mode reaching scoring, ingest or a Lambda, and stays quiet in the renderer, the toggle and prose.`,
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
  process.exit(0)
}

const scanned = files(ROOT).length
if (scanned === 0) {
  console.error("MODE BOUNDARY: scanned 0 files — the scan roots are wrong.")
  process.exit(1)
}

const hits = scan()
if (hits.length) {
  console.error("MODE BOUNDARY VIOLATION — the map mode is named outside the renderer and the toggle:\n")
  for (const h of hits) {
    console.error(`  ${h.rel}:${h.n}`)
    console.error(`    ${h.line}\n`)
  }
  console.error(
    "Atlas and adventure are a look (05 §5.2). Neither may change what is revealed or scored\n" +
      "(05 §5.4, D-020, D-135). Move the mode concern into the renderer or the toggle.",
  )
  process.exit(1)
}
console.log(`Mode boundary: ${scanned} files scanned — the map mode is named only in the renderer, the toggle and the run-moment seam.`)
