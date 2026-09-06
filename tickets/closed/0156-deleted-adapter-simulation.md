---
id: 156
slug: deleted-adapter-simulation
title: T2 deleted-adapter simulation — stub an adapter's exports to never, and fail only in registry.ts
type: chore
priority: med
status: closed
size: s
capability: 05-strava-adapter
depends_on: [36]
blocked_by: []
source: agent
created: 2026-09-04T00:47:04Z
closed: 2026-09-06T04:48:34Z
---

## Description

**Split out of `0027` on 2026-09-03.** T2 has two halves and only one of them was buildable when
`0027` was worked:

- **The importer scan** — "every import of the adapter directory comes from inside it or from
  `registry.ts`" — shipped in `0026` as `src/adapters/registry.test.ts`. It discovers adapter
  directories rather than naming one, so it already covers whatever adapter appears next.
- **The deleted-adapter simulation** — "type-check with the directory's exports stubbed to `never`
  must fail **only** in `registry.ts`" — needs an adapter directory to delete. There was none, and
  a simulation over zero adapters asserts nothing.

This ticket is the second half, depending on `0036`, at which point `src/adapters/strava/` exists
with its full set of exports and the simulation has something real to remove.

**Why the scan is not enough on its own.** The importer scan reads *import statements*. It cannot
see a dependency that does not go through an import: a structural type duplicated by hand, an
`as` cast to a shape the adapter owns, a string literal branch on a source id. The deletion
simulation catches those by construction — it asks the compiler "if this directory vanished, what
breaks?" and the only acceptable answer is one line in `registry.ts`. That is D-121.1's promise
("swapping adapters must touch exactly one module") checked rather than asserted.

## Acceptance criteria

- [x] A check exists that type-checks the repo with the adapter directory's exports stubbed to
      `never` (or the directory replaced by a stub module), without mutating the working tree.
- [x] It reports the complete list of files that fail to compile under that stub.
- [x] It passes only when that list is exactly `["src/adapters/registry.ts"]`, and fails with the
      offending paths named when it is not.
- [x] It fails, demonstrably, when a second file is made to import the adapter directly — proven
      by a self-test in the same style as `scripts/check-boundaries.mjs --self-test`, not by a
      temporary commit.
- [x] It runs in `.github/workflows/gate.yml` **and** `amplify.yml`, so the deploy path cannot
      bypass it.
- [x] Its failure message names **D-100** and **D-121.1**, so a future reader knows what the check
      is protecting before deciding to delete it.
- [x] It discovers the adapter directory rather than hard-coding a vendor name, and is therefore
      exempt from needing an entry in `check-boundaries.mjs`'s `EXEMPT` list.
      — and the self-test discovers an exported *symbol* too. Its first draft hard-coded
      `stravaOAuth`, which would have satisfied the letter of this and broken its spirit
      one file over.

## Notes

Written in plain node under `scripts/`, like the other gate checks, if it needs to shell out to
`tsc`. `scripts/` runs in the Amplify build container, which has no TypeScript of its own — check
how `npm run typecheck` resolves `tsc` there before assuming a spawn will work. If it cannot run
in that container, say so and wire it into the vitest suite instead, which `amplify.yml` already
runs; do not ship it to only one of the two gates.

The temptation is to implement this by actually deleting the directory and restoring it. Do not —
a check that mutates the tree fails badly when interrupted, and leaves a repo missing its adapter.
Stub via a temporary tsconfig `paths` override or a generated stub module in a scratch directory.

## Resolution

**Files touched:** `scripts/check-adapter-deletion.mjs` (new),
`.github/workflows/gate.yml`, `amplify.yml`.

**`tsconfig` `paths` was the obvious approach and it does not work — this is the finding
worth carrying forward.** TypeScript applies `paths` to **non-relative specifiers only**,
and the single importer this check is about reaches the adapter as `./strava/oauth`. A
`paths` override would therefore have stubbed the directory for every file *except*
`registry.ts`, reported a clean pass, and tested nothing. It would have looked completely
correct. So the tree is copied to a scratch directory instead, `node_modules` is symlinked
rather than copied, and the adapter is stubbed in the copy — nothing under the repo is
written at any point, which is also what the Notes require ("a check that mutates the tree
fails badly when interrupted").

**`export {}` rather than deleting the files.** A deleted module produces "cannot find
module" at the import site and stops; an empty one produces "has no exported member 'X'"
for every symbol actually used. Same set of failing files, far more useful message, and the
adapter's own internal imports stay resolvable so their noise does not drown the signal.
That is also the strongest reading of the ticket's "stubbed to `never`" — every export
absent rather than merely unusable.

**The self-test's first draft violated criterion 7 one file away from satisfying it.** It
planted `import { stravaOAuth } from "@/src/adapters/${adapter}/oauth"` — discovering the
directory, hard-coding the symbol. It now discovers an exported value too, and there are two
traps in doing that which are recorded in the code: a **namespace** import (`import * as x`)
of a stubbed module *succeeds*, because `export {}` is a valid empty namespace, so the
self-test would have planted a violation the check could not detect and then congratulated
itself; and a **type-only** export is erased under `verbatimModuleSyntax` before it can
fail. It has to be a named value import.

**Runs on both gates**, as criterion 5 requires. The Notes flagged a real risk — `scripts/`
runs in the Amplify container, which has no TypeScript of its own — so I checked rather than
assumed: `typescript@^5.9.3` is a devDependency, `node_modules/.bin/tsc` exists, and
`amplify.yml` already runs `npm run typecheck` in that same phase, after `preBuild`'s
`npm install`. The spawn works. ~6s, so it is no longer true that everything before the
build is "cheapest first"; the `amplify.yml` comment now says so instead of quietly
becoming wrong.

**Zero adapters is treated as a failure, not a pass.** This ticket exists because `0027`
found that a simulation over zero adapters asserts nothing — so the check exits non-zero and
says the layout must have moved, rather than reporting success over an empty set. Same
"I ran and found nothing" versus "I never ran" rule as everywhere else in this repo (D-176),
and it applies again to `tsc` producing no output at all, which is treated as a broken check
rather than a clean tree.

## Operator validation

**None, as the ticket predicted** — a CI check with no user-visible surface. Verified by the
agent, with the actual output rather than the instruction:

**Green on a clean tree.** `node scripts/check-adapter-deletion.mjs`:

```
  ok   'strava' deleted -> 1 file fails to compile: src/adapters/registry.ts   [19 module(s) stubbed]

The adapter seam holds: deleting any of 1 adapter(s) breaks only src/adapters/registry.ts.
```

That is D-121.1 measured rather than asserted: **19 modules stubbed to nothing, and exactly
one file in the entire repository notices.**

**Red on a planted violation.** `node scripts/check-adapter-deletion.mjs --self-test`:

```
  planted: lib/intruder-selftest.ts imports { StravaApiError } from strava/adapter
  ok   'strava' deleted -> 1 file fails to compile: src/adapters/registry.ts   [19 module(s) stubbed]
  ok    must pass  the real tree
  ok    must fire  a second module importing the adapter directly
             it named: lib/intruder-selftest.ts, src/adapters/registry.ts

self-test: 2 cases passed — the check fires on a real seam leak.
```

The failure path names the offending file and marks the expected one, and its message cites
**D-100** and **D-121.1** plus the reason an import scan cannot find this class on its own.

**Timing:** ~6s wall clock (`real 0m6.095s`), which is what justified the `amplify.yml`
comment change rather than leaving it claiming "cheapest first".

**Local gate:** `npm test` 877 passed / 1 skipped / 43 files · `npm run typecheck` clean ·
`npm run lint --max-warnings 0` clean · `check-boundaries` clean (the new script lives under
`scripts/`, which is outside its BROAD roots, so criterion 7's exemption holds without an
`EXEMPT` entry).

