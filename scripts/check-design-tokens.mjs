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

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS A COLOUR, AND WHAT IS A DATABASE KEY  (ticket 0146)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The original pattern was `/#[0-9a-f]{3,8}\b/i` — a correct description of a CSS
 * colour and an incorrect description of a DynamoDB composite key, which this
 * project's own architecture writes with `#` separators (`01-architecture.md` §2:
 * `PK = U#<uid>#C#<res6parent>`, and an H3 cell id is a hex string).
 *
 * It fired on `RATE#<uid>#H#2026-09-02T14` in ticket 0019, which worked around it by
 * respelling one key. It fired again in 0041 on `gpslogger#9001` and on a local-day
 * bucket `#2026-09-05` — neither of which is a cell id, neither of which had any
 * respelling available that was not a contortion. Capability `07` would have hit it on
 * every realistic cell fixture. A guard that has to be dodged is a guard that gets
 * disabled, which is what `.githooks/pre-commit` warns about in its own comment.
 *
 * TWO NARROWINGS, both about what a CSS colour actually is:
 *
 *   1. A COLOUR IS 3, 4, 6 OR 8 HEX DIGITS. Never 5, never 7 — those are not CSS
 *      syntax in any spelling. `#86283` was matched by the old `{3,8}` and is not a
 *      colour in any browser.
 *
 *   2. A COLOUR'S `#` DOES NOT FOLLOW A WORD CHARACTER OR `}`. In every real colour
 *      the `#` opens a value: after a quote, a space, a colon, a paren, or the start
 *      of a line. In every composite key it SEPARATES two segments —
 *      `gpslogger#9001`, `${uid}#C#...`, `U#u#C#...`. That difference is structural,
 *      not stylistic, which is what makes it safe to key on.
 *
 * Neither narrowing weakens the real rule: `'#C9A227'`, `#000`, `#ffffff` and
 * `= '#0B1020'` all still fire, and the self-test asserts each of them still does.
 *
 * The residual escape hatch is `design-tokens:allow` ON THE LINE — the same
 * convention `.githooks/pre-commit` uses for `gitleaks:allow`, and chosen for the same
 * reason: a suppression must be visible in the diff that introduces it. There is no
 * directory exemption and no file-extension exemption, because either would silently
 * stop scanning real components.
 */

/**
 * A `#` that opens a value rather than separating two segments of a key.
 * `(?<![\w}])` — not preceded by a word character or a closing template brace.
 */
const COLOUR_START = "(?<![\\w}])#"

/** The only digit counts CSS accepts: #RGB, #RGBA, #RRGGBB, #RRGGBBAA. */
const HEX_RUN = "(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})"

/** Pure black / pure white, in every spelling. Banned everywhere, no exceptions. */
const ABSOLUTE = new RegExp(`${COLOUR_START}(?:000000|ffffff|000|fff)\\b`, "i")
/** Any hex colour at all. Permitted only in the palette file. */
const ANY_HEX = new RegExp(`${COLOUR_START}${HEX_RUN}\\b`, "i")

/**
 * An on-line suppression, visible in the diff. Deliberately spelled out in full so
 * `grep -rn "design-tokens:allow"` finds every one of them in one command.
 */
const ALLOW = /design-tokens:allow/

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
        // An explicit, visible suppression. Applies to both rules: a line that has
        // been looked at and judged is not worth judging twice.
        if (ALLOW.test(line)) return
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

    // ── 0146: a `#` separator is not a colour ──────────────────────────────
    // The case the ticket names verbatim. An H3 cell id is a hex string and
    // 01-architecture.md §2 writes the key as U#<uid>#C#<res6parent>, so every
    // realistic cell fixture in capability 07 contains one of these.
    "src/pipeline/cell-key.ts": ["const k = `U#${uid}#C#8a2a1072b59ffff`", false],
    // The two that actually broke ticket 0041, and neither is a cell id: an
    // ordinary cross-source dedupe key, and a local-day bucket. There was no
    // respelling available for either that was not a contortion.
    "src/pipeline/dedupe.ts": ['const k = "gpslogger#9001"', false],
    "src/pipeline/day.ts": ["const d = `${userId}#2026-09-05`", false],
    // 0019's original: RATE#<userId>#H#<hour>. It respelled the key to get past
    // this check; that workaround is what this fixture makes unnecessary.
    "lib/tickets/rate.ts": ["const k = `RATE#${userId}#H#2026-09-02T14`", false],
    // FIVE hex digits is not a CSS colour in any spelling, so it never was one.
    "src/pipeline/five.ts": ['const k = "U#u#C#86283"', false],

    // ...and the narrowing must not have opened a hole. Each of these is a real
    // colour whose `#` opens a value, and each must still fire.
    "components/still-fires.tsx": ["const c = '#C9A227'", true],
    "components/eight-digit.tsx": ["const c = '#C9A22780'", true],
    "components/after-colon.css": ["  color:#0B1020;", true],
    "components/after-paren.ts": ["const c = rgba('#0B1020', 0.5)", true],

    // The escape hatch, visible on the line (criterion 4). A genuine colour that
    // has been looked at and judged — the gitleaks:allow convention.
    "components/suppressed.tsx": ["const c = '#C9A227' // design-tokens:allow — §8.3 exception", false],
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
