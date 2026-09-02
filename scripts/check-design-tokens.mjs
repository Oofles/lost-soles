#!/usr/bin/env node
// The palette does not leak (06-ui-ux.md §8.2/§8.3, ticket 0016).
//
// Two rules, and the second is the one that matters in year three:
//
//   1. NEVER #000000, NEVER #FFFFFF — anywhere, including the token file. Pure
//      black on parchment reads as a printing error; pure white on navy vibrates.
//      --ink-900 and --parch-50 are the extremes (§8.2).
//   2. Raw hex colours live in app/tokens.css AND NOWHERE ELSE. Components
//      reference SEMANTIC tokens (--text-primary), never primitives and never
//      literal colour. A palette that leaks is a palette that drifts, and §8.1's
//      whole argument is that this one is load-bearing rather than decorative.
//
// Plain node, no dependencies, no ripgrep — it runs in BOTH the GitHub gate and
// the Amplify build container, which has no rg (D-163: a check that runs in only
// one of the two is half a control).
//
// WHAT IS SCANNED, and why it is not a list (0142). Every top-level directory is
// scanned except build output, tooling and node_modules. The scan roots are
// DERIVED FROM DISK on every run, so a new source directory is covered the moment
// it exists and nobody has to remember to add it.
//
// This replaces a hand-written ["app", "components", "lib"], and the history is
// the argument for deriving. 0016's criterion 8 specified `grep -rn ... src/`;
// there was no src/ at the time, so the grep would have scanned nothing and passed
// vacuously — the decorative-gate failure 0013 found in the lint script — and it
// was amended to the three directories that then existed. Ticket 0025 later created
// src/domain/, and the check went blind to it silently, with a comment still
// asserting src/ did not exist. A hand-maintained scan list is a vacuous grep with
// a longer fuse: it is correct on the day it is written and nothing tells you when
// it stops being.
//
//   node scripts/check-design-tokens.mjs             check
//   node scripts/check-design-tokens.mjs --self-test prove the rules FIRE

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { join, relative, sep } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

/**
 * Excluded from the derived roots. Dot-directories (.next, .amplify, .git,
 * .github, .claude, .githooks) are excluded by the leading dot — they are build
 * output and tooling, never rendered UI. Only node_modules needs naming, because
 * it has no dot and walking it is both pointless and slow.
 *
 * NOTHING ELSE IS EXCLUDED, deliberately. docs/ and tickets/ hold prose, and
 * scripts/ holds .mjs — none of which are in EXTS, so scanning them costs a
 * readdir and finds nothing. Excluding a directory because it "obviously has no
 * colours in it" is the judgement call that goes stale; not making it is the point.
 */
const EXCLUDED = new Set(["node_modules"])

/** The scan roots, read from disk rather than remembered. See the header. */
function rootsFor(base) {
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !EXCLUDED.has(e.name))
    .map((e) => e.name)
    .sort()
}

const SKIP_DIRS = new Set(["node_modules", ".next", ".amplify", ".git"])
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".css", ".scss"]

/** The single file permitted to contain raw hex. */
const PALETTE = "app/tokens.css"

/** Pure black / pure white, in every spelling. Banned everywhere, no exceptions. */
const ABSOLUTE = /#(?:000000|ffffff|000|fff)\b/i
/** Any hex colour at all. Permitted only in the palette file. */
const ANY_HEX = /#[0-9a-f]{3,8}\b/i

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full)
  }
  return out
}

export function scan(base) {
  const hits = []
  // Derived per-call from the tree being scanned, which is what lets the self-test
  // exercise the SAME derivation against its fixture rather than a stubbed list.
  for (const root of rootsFor(base)) {
    for (const file of walk(join(base, root))) {
      const rel = relative(base, file).split(sep).join("/")
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const at = { rel, n: i + 1, line: line.trim() }
        if (ABSOLUTE.test(line)) {
          hits.push({ ...at, rule: "never #000000 / #FFFFFF — §8.2. Use --ink-900 / --parch-50" })
          return
        }
        // A comment naming a value (the contrast table, a "--ink-400 @ 0.35"
        // note) is documentation, not a leak.
        const isComment = /^\s*(\/\/|\*|\/\*|<!--)/.test(line)
        if (rel !== PALETTE && !isComment && ANY_HEX.test(line)) {
          hits.push({ ...at, rule: `raw hex outside ${PALETTE} — reference a semantic token (§8.3)` })
        }
      })
    }
  }
  return hits
}

if (process.argv.includes("--self-test")) {
  // The codebase passing today proves nothing about whether the rules FIRE.
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")

  const FIXTURE = {
    "app/tokens.css": ["  --ink-900: #14161c;", false],
    "app/tokens.css.note": ["ignored — not a scanned extension", false],
    "components/plinth.tsx": ["const c = '#C9A227'", true],
    "components/bad-black.tsx": ["color: '#000'", true],
    "app/globals.css": ["body { color: #ffffff; }", true],
    "app/page.tsx": ["style={{ color: 'var(--text-primary)' }}", false],
    "components/note.tsx": ["// --gold-500 is #C9A227, fills only", false],
    "lib/util.ts": ["export const id = 'abc123'", false],

    // ── 0142: the directories a hand-written list missed ────────────────────
    // src/ exists (ticket 0025 created src/domain/) and was unscanned for two
    // days while a comment in this file asserted it did not exist. The check must
    // be SEEN to fire there, not merely configured to look there.
    "src/domain/leak.ts": ["export const FOG = '#0B1020'", true],
    "src/domain/fine.ts": ["export type Cell = { id: string }", false],
    // The load-bearing case for the whole change: a directory that appears in NO
    // list anywhere — not in this file, not in this fixture's expectations by
    // name. It is scanned because it is on disk. If someone reverts to a
    // hand-written ROOTS, this is the case that goes red.
    "packages/ui/button.tsx": ["const bg = '#F5EDD9'", true],
  }
  const base = mkdtempSync(join(tmpdir(), "tokens-"))
  try {
    for (const [rel, [body]] of Object.entries(FIXTURE)) {
      const full = join(base, rel)
      mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true })
      writeFileSync(full, body + "\n")
    }
    // The palette file must be allowed its hex, but NOT pure black or white.
    writeFileSync(join(base, "app/tokens.css"), "  --ink-900: #14161c;\n  --bad: #FFFFFF;\n")
    const caught = new Set(scan(base).map((h) => h.rel))
    let failed = 0
    for (const [rel, [, shouldFire]] of Object.entries(FIXTURE)) {
      const expected = rel === "app/tokens.css" ? true : shouldFire // now contains #FFFFFF
      const ok = caught.has(rel) === expected
      if (!ok) failed++
      console.log(`  ${ok ? "ok" : "FAIL"}  ${expected ? "must fire " : "must pass"}  ${rel}`)
    }
    if (failed) {
      console.error(`\n${failed} self-test case(s) failed — the token check is broken.`)
      process.exit(1)
    }
    // Prove the derivation itself, not just its consequences: the fixture's roots
    // must have been discovered from disk, including ones this file never names.
    const derived = rootsFor(base)
    for (const expected of ["app", "components", "lib", "src", "packages"]) {
      const ok = derived.includes(expected)
      if (!ok) failed++
      console.log(`  ${ok ? "ok" : "FAIL"}  root derived  ${expected}`)
    }
    if (failed) {
      console.error(`\n${failed} self-test case(s) failed — the token check is broken.`)
      process.exit(1)
    }
    console.log(`\nself-test: ${Object.keys(FIXTURE).length} cases passed across roots [${derived.join(", ")}] — including that even the palette file may not hold #FFFFFF, and that a directory named in no list is still scanned.`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
  process.exit(0)
}

const hits = scan(ROOT)
if (hits.length) {
  console.error("DESIGN TOKEN VIOLATION — the palette is leaking:\n")
  for (const h of hits) {
    console.error(`  ${h.rel}:${h.n}`)
    console.error(`    ${h.line}`)
    console.error(`    ${h.rule}\n`)
  }
  console.error(`Every colour lives in ${PALETTE}. Components reference semantic tokens.`)
  process.exit(1)
}
console.log(`Design tokens: no raw colour outside ${PALETTE}, no pure black or white anywhere.`)
