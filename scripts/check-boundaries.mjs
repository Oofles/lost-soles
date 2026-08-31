#!/usr/bin/env node
// D-100 boundary check — no Strava-shaped identifier escapes the adapter.
//
// 01-architecture.md §3 (T1) and contracts/ingestion-contract.md §5.1. Added by
// ticket 0013 while the domain is still EMPTY, so it passes trivially today. A
// grep added after a leak is a grep that has already failed at its job, and the
// map it protects can never re-fog (D-020) — a Strava concept that reaches the
// domain corrupts something permanent.
//
// Written in plain node, with no dependencies and no ripgrep, because it runs in
// TWO places: the GitHub Actions gate and the Amplify build (amplify.yml). The
// Amplify container has no rg. A check that only runs in one of them is an alarm,
// not a lock — and this repo has no branch protection (D-163).
//
//   node scripts/check-boundaries.mjs           check
//   node scripts/check-boundaries.mjs --self-test   prove it FAILS on a real hit

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// Two tiers, deliberately. A single broad pattern over the whole tree would fire
// on a map component's legitimate `polyline`, and a gate with false positives is
// a gate that gets bypassed — the exact failure mode 0013 set out to avoid.
//
// TIER 1 — the full T1 pattern, but only over the modules the design names. Here
// `polyline` and `athlete` genuinely ARE leaks: D-121 is explicit that a
// summary_polyline is a degraded trace, and the domain speaks in GeoPoints.
const STRICT = {
  roots: ["src/domain", "src/pipeline"],
  pattern: /strava|polyline|athlete|activity:read|hub\.challenge/i,
  why: "01-architecture.md §3 T1 — the domain and pipeline are source-agnostic",
};

// TIER 2 — the vendor name alone, everywhere else. "Strava" is never a generic
// word, so this cannot false-positive, and it catches the leak the strict tier
// would miss: a Strava type imported into a component or a Lambda handler.
const BROAD = {
  roots: ["app", "lib", "amplify", "src"],
  pattern: /strava/i,
  why: "D-100 — Strava lives strictly behind the adapter boundary",
};

// The adapter itself, and the one registry line the design explicitly blesses:
// "replacing Strava must produce a diff confined to src/adapters/<name>/ and ONE
// line in src/adapters/registry.ts (PRIMARY_ADAPTER)" (01-architecture.md §3 T2).
const EXEMPT = [
  "src/adapters/strava",
  "src/adapters/registry.ts",
];

const SKIP_DIRS = new Set([
  "node_modules", ".next", ".amplify", ".git", "dist", "build",
]);
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const isExempt = (rel) =>
  EXEMPT.some((e) => rel === e || rel.startsWith(e + "/"));

function scan({ roots, pattern, why }, hits, base) {
  for (const root of roots) {
    for (const file of walk(join(base, root))) {
      const rel = relative(base, file).split(sep).join("/");
      if (isExempt(rel)) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        // A comment explaining WHY a boundary exists is not a violation of it.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (pattern.test(line)) hits.push({ rel, n: i + 1, line: line.trim(), why });
      });
    }
  }
  return hits;
}

function check(base = ROOT) {
  const hits = [];
  scan(STRICT, hits, base);
  scan(BROAD, hits, base);
  return hits;
}

function report(hits) {
  if (hits.length === 0) return true;
  console.error("D-100 BOUNDARY VIOLATION — Strava-shaped identifiers outside the adapter:\n");
  for (const h of hits) {
    console.error(`  ${h.rel}:${h.n}`);
    console.error(`    ${h.line}`);
    console.error(`    ${h.why}\n`);
  }
  console.error("Ingestion is source-agnostic (D-100). If this needs a switch on a");
  console.error("source id, the contract is wrong — stop and fix the contract, not the grep.");
  return false;
}

if (process.argv.includes("--self-test")) {
  // 0125's lesson: a check with no test is a layer that can be silently disabled.
  // The empty-codebase pass proves nothing — only a real hit proves it FIRES.
  //
  // This builds an actual file tree in a temp dir and runs the REAL scanner over
  // it, so breaking walk(), SKIP_DIRS or EXTS fails the test too. A self-test that
  // only re-checks the regex would pass while file discovery was quietly broken.
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const FIXTURE = {
    // rel path                        contents                                              must be caught
    "src/domain/activity.ts":          ["import type { StravaActivity } from '@/adapters/strava/types'", true],
    "src/pipeline/score.ts":           ["const pts = decodePolyline(raw.summary_polyline)", true],
    "src/pipeline/athlete.ts":         ["const id = athlete.id", true],
    "app/dashboard/page.tsx":          ["const label = 'Connect Strava'", true],
    "amplify/functions/ingest.ts":     ["const url = 'https://www.strava.com/api/v3'", true],
    "src/domain/geo.ts":               ["export type GeoPoint = { lat: number; lng: number }", false],
    "src/domain/note.ts":              ["// never a Strava type here — D-100", false],
    "src/adapters/strava/normalize.ts":["export function fromStrava(raw: StravaActivity) {}", false],
    "src/adapters/registry.ts":        ["export const PRIMARY_ADAPTER = 'strava'", false],
    "app/page.tsx":                    ["export default function Home() { return null }", false],
    "src/domain/notes.md":             ["Strava is the first adapter.", false],  // not a source ext
    "node_modules/pkg/index.ts":       ["import { StravaActivity } from 'strava'", false],  // skipped dir
  };

  const base = mkdtempSync(join(tmpdir(), "d100-"));
  try {
    for (const [rel, [body]] of Object.entries(FIXTURE)) {
      const full = join(base, rel);
      mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
      writeFileSync(full, body + "\n");
    }

    const caught = new Set(check(base).map((h) => h.rel));
    let failed = 0;
    for (const [rel, [, shouldFire]] of Object.entries(FIXTURE)) {
      const ok = caught.has(rel) === shouldFire;
      if (!ok) failed++;
      console.log(`  ${ok ? "ok" : "FAIL"}  ${shouldFire ? "must fire " : "must pass"}  ${rel}`);
    }
    if (failed) {
      console.error(`\n${failed} self-test case(s) failed — the boundary check is broken.`);
      process.exit(1);
    }
    const n = Object.keys(FIXTURE).length;
    console.log(`\nself-test: ${n} cases passed — the check fires on a real leak.`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  process.exit(0);
}

process.exit(report(check()) ? 0 : 1);
