---
id: 188
slug: npm-run-lint-fails-after-a-build-public-maplibre-is-linted
title: npm run lint fails after a build: public/maplibre/ is linted
type: bug
priority: med
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-09-09T21:46:54Z
---

## Description

**Two gates fail on any machine that has run `npm run build`, for the same reason.** Neither
failure is in this project's code; both are MapLibre's own minified worker, copied out of
`node_modules` at prebuild by `scripts/copy-maplibre-worker.mjs` (ticket `0053`) into
`public/maplibre/`.

1. **`npm run lint`** — 1,090 warnings, 0 errors, every one in
   `public/maplibre/maplibre-gl-shared.js` or `maplibre-gl-worker.js`. `--max-warnings 0` (D-164)
   turns them into a failed lint.
2. **`node scripts/check-design-tokens.mjs`** — `DESIGN TOKEN VIOLATION — the palette is leaking`,
   pointing at the same two files. It scans them because `0142` deliberately derives its scan roots
   **from disk** rather than from a hand-written list, precisely so a new source directory is
   covered the moment it exists. That reasoning is right and should not be reverted; what it needs
   is the same exclusion the lint config needs.

So the gate is red for a reason that has nothing to do with the change being checked.

**Why it is invisible in CI.** `public/maplibre/` is gitignored (`.gitignore:53`) and the files are
created by `prebuild`. A CI job that lints without building never sees them. So the check passes in
the place it is watched and fails in the place a person actually runs it — which is the wrong way
round for a gate whose whole purpose is to be run before committing.

**Why it matters beyond the annoyance.** A lint that is known to be red is a lint nobody reads. The
next real warning lands in a wall of 1,090 and is not noticed, which is precisely the "gate with
false positives is a gate that gets bypassed" failure `check-boundaries.mjs` and
`check-design-tokens.mjs` both record as the reason for their own narrowing.

Found while closing `0054`; unrelated to that ticket's changes.

## Acceptance criteria

- [ ] `eslint.config.mjs` ignores `public/maplibre/**`, with a comment saying why — vendored,
      generated, gitignored, and not this project's code to lint.
- [ ] `scripts/check-design-tokens.mjs` skips the same directory, WITHOUT reverting `0142`'s
      derive-from-disk scan roots. The exclusion names generated vendor output, not a fixed list of
      directories to scan.
- [ ] Both exit 0 on a tree that has been built (`npm run build` first, then each check).
- [ ] Both still exit 0 on a clean checkout that has not been built.
- [ ] Every other check that walks the tree is inspected for the same blind spot and either fixed
      or shown not to have it — `check-boundaries`, `check-fog-render-boundary`, `check-skills`,
      `check-fixture-geography` all pass today, and the reason each does is worth writing down
      once rather than rediscovering.
- [ ] The exclusions are narrow: `public/` generally stays covered, so a real source file added
      there is still checked.

## Steps to reproduce

```bash
npm run build          # prebuild copies MapLibre's worker into public/maplibre/

npm run lint
#   ...1090 warnings, all in public/maplibre/*.js
#   ✖ 1091 problems (0 errors, 1091 warnings)

node scripts/check-design-tokens.mjs
#   DESIGN TOKEN VIOLATION — the palette is leaking:
#     public/maplibre/maplibre-gl-shared.js:5

# and the proof that the project's own code is clean:
mv public/maplibre /tmp/hold && node scripts/check-design-tokens.mjs && mv /tmp/hold public/maplibre
#   Design tokens: no raw colour outside app/tokens.css, no pure black or white anywhere.
```

## Expected vs actual

**Expected.** Both checks cover this project's source and exit 0 when that source is clean.

**Actual.** Both also scan ~500 KB of vendored, minified, gitignored MapLibre build output and
fail on it — the lint through `--max-warnings 0`, the token check through a hex literal in
minified vendor code.

## Notes

`eslint.config.mjs`'s `ignores` block already carries the same shape of entry for `.next/**`,
`.amplify/**` and `next-env.d.ts` — generated output that is not ours. `public/maplibre/` was
created two tickets ago and was simply not added to it, and `check-design-tokens.mjs` has no
equivalent list at all by design.

The shared lesson is worth stating once: **`0053` introduced a new category — generated vendor
output inside a served directory — and nothing that walks the tree was told about it.** Whatever
shape the fix takes, it should be one named concept both consumers reference, so the next
generated directory is a one-line change rather than a second instance of this ticket.

## Operator validation

None — a build-tooling fix with nothing user-visible. The verification is the two `npm run lint`
runs in the acceptance criteria, both of which are the agent's to run.
