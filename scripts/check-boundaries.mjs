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

// TIER 2 — everywhere else, the vendor name only where it is an IDENTIFIER or an
// IMPORT, never as an English word.
//
// This started as a bare /strava/i and was WRONG. It fired on ticket 0016's
// legitimate settings copy — `note="Strava re-auth, reduced motion, ..."` — the
// first time real UI text was written, one ticket after the check landed.
// 06-ui-ux.md §1.3 says /settings exists *for* Strava re-auth, so the app must be
// able to say the word to the user.
//
// D-100 is about a Strava-shaped TYPE reaching the domain, not about the vendor's
// name appearing in a label. So: fire on an import path, or on `strava` glued to
// another word character (StravaActivity, stravaId, fromStrava) — never on a
// standalone word in prose or a string. A gate with false positives is a gate
// that gets bypassed, which is the failure this whole file exists to avoid.
const BROAD = {
  roots: ["app", "lib", "amplify", "src"],
  pattern: new RegExp(
    [
      '\\bimport\\b.*strava',        // import ... strava ...
      'from\\s+["\'][^"\']*strava',  // from "@/adapters/strava/types"
      '[A-Za-z0-9_]strava',           // fromStrava, xStrava
      'strava[A-Za-z0-9_]',           // StravaActivity, stravaId
      'strava\\.com',                 // the API host — an adapter's job, never app code
      '["\'`]strava["\'`]',           // an exact 'strava' string: a source discriminator
    ].join('|'),
    'i',
  ),
  why: "D-100 — a Strava-shaped identifier or import outside the adapter",

  // SECOND NARROWING (D-166, ticket 0017). `STRAVA_CLIENT_SECRET` is an SSM
  // parameter name, not a Strava-shaped type — but `strava[A-Za-z0-9_]` matches
  // STRAVA followed by an underscore, so the registry in 01-architecture.md §7
  // could not be referenced anywhere without tripping this gate.
  //
  // That is not a hypothetical: `secret('STRAVA_CLIENT_SECRET')` inside a
  // defineFunction environment block is how capability 05 wires the adapter's
  // credentials, and that block is the CORRECT place for it.
  //
  // SCREAMING_SNAKE is the discriminator, and it is a real one: a TYPE is
  // PascalCase and a variable is camelCase, so an all-caps STRAVA_* token is an
  // environment or parameter key and nothing else. Redaction is case-SENSITIVE
  // for exactly that reason — `stravaId` and `StravaActivity` are untouched.
  //
  // The STRICT tier deliberately gets NO redaction: a STRAVA_ANYTHING appearing
  // in src/domain or src/pipeline still fails, because the domain has no business
  // reading a source's credentials either. Self-tested both ways below.
  redact: /\bSTRAVA_[A-Z0-9_]+\b/g,
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

/**
 * THIRD NARROWING (D-167, ticket 0025). The domain names its known sources in one
 * union, and that is by design:
 *
 *     export type SourceId =
 *       | "strava"          // MVP (D-121)
 *       | (string & {})
 *
 * contracts/ingestion-contract.md §2 puts it there deliberately (conflict #1:
 * "enumerate known sources for documentation value, but keep (string & {})
 * widening so adding a source never edits the domain"), and 01-architecture.md §3
 * had the same literal in `AdapterId` — 220 lines ABOVE the grep that forbids it,
 * in the same section, with the author's own note: "an opaque tag; the domain
 * never branches on it."
 *
 * So T1 as written was never satisfiable, in its own document, before any
 * reconciliation. The rule is about DEPENDENCY; the grep searches for VOCABULARY.
 *
 * Blessed here: a line that is nothing but union members — `| "name"`, optionally
 * several, optionally with a trailing comment — and ONLY under src/domain/. That
 * shape cannot express a dependency. Everything that can, still fires:
 * `stravaId`, `source === "strava"`, an import, `summary_polyline`, a field type.
 */
const UNION_MEMBERS_ONLY = /^\s*(\|\s*"[a-z0-9-]+"\s*)+$/;

function stripBlessedLiterals(rel, line) {
  if (!rel.startsWith("src/domain/")) return line;
  // Trailing line comment is not part of the declaration.
  const code = line.replace(/\/\/.*$/, "");
  return UNION_MEMBERS_ONLY.test(code) ? "" : line;
}

function scan({ roots, pattern, why, redact }, hits, base) {
  for (const root of roots) {
    for (const file of walk(join(base, root))) {
      const rel = relative(base, file).split(sep).join("/");
      if (isExempt(rel)) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        // A comment explaining WHY a boundary exists is not a violation of it.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        // Strip the rule's blessed tokens, then test what is LEFT — so a line
        // carrying both a secret key name and a real violation still fires.
        let probe = redact ? line.replace(redact, "") : line;
        probe = stripBlessedLiterals(rel, probe);
        if (pattern.test(probe)) hits.push({ rel, n: i + 1, line: line.trim(), why });
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
  // Ticket 0027, criterion 9: name the decision, not just the rule. A reader who hits
  // this and sees only "boundary violation" concludes it is pedantry; one who sees what
  // it buys can weigh it. D-121.1 is the promise this check exists to keep.
  console.error("");
  console.error("D-121.1 — Strava lives strictly behind this boundary, so that replacing it");
  console.error("touches one directory plus one line in registry.ts. That is the entire bet:");
  console.error("Strava reserves the right to force deletion, and the map can never re-fog.");
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
    "app/dashboard/page.tsx":          ["const label = stravaClient.id", true],
    "app/import/page.tsx":             ["import { x } from '@/adapters/strava/types'", true],
    "app/settings/page.tsx":           ['<Stub note="Strava re-auth, units, sign out" />', false],
    "app/connect/page.tsx":            ["const heading = 'Connect Strava'", false],
    "app/sync/page.tsx":               ["const src = 'strava'", true],
    "amplify/functions/ingest.ts":     ["const url = 'https://www.strava.com/api/v3'", true],
    // D-166 — an SSM parameter name is not a Strava-shaped type. All four cases:
    // blessed in the BROAD tier, still caught in STRICT, still caught when a real
    // violation shares the line, and the redaction is case-sensitive.
    "amplify/functions/secret/resource.ts": ['STRAVA_CLIENT_SECRET: secret("STRAVA_CLIENT_SECRET"),', false],
    "amplify/functions/secret/handler.ts":  ["const v = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN", false],
    "src/domain/creds.ts":                  ["const v = process.env.STRAVA_CLIENT_SECRET", true],
    "amplify/functions/mixed.ts":           ['const a: StravaActivity = j(process.env.STRAVA_CLIENT_ID)', true],
    "amplify/functions/lower.ts":           ["const k = strava_client_secret", true],
    "src/domain/geo.ts":               ["export type GeoPoint = { lat: number; lng: number }", false],
    "src/domain/note.ts":              ["// never a Strava type here — D-100", false],
    // D-167 — the domain names its sources in one union and that is the design.
    // Blessed only in src/domain/, only for a line that is nothing but members.
    "src/domain/source-id.ts":              ['  | "strava"          // MVP (D-121)', false],
    "src/domain/kinds.ts":                  ['  | "suunto" | "polar"// D-117', false],
    // Everything that can actually express a dependency still fires, in the same file.
    "src/domain/leak-field.ts":             ["  stravaId: string", true],
    "src/domain/leak-branch.ts":            ['  if (source === "strava") return 1', true],
    "src/domain/leak-import.ts":            ['import { X } from "@/adapters/strava/types"', true],
    "src/domain/leak-polyline.ts":          ["  const p = raw.summary_polyline", true],
    // The blessing is src/domain-only: the same line elsewhere is still a hit.
    "src/pipeline/sources.ts":              ['  | "strava"', true],
    "app/pick-source.tsx":                  ['  | "strava"', true],
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
