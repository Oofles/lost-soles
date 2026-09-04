---
id: 156
slug: deleted-adapter-simulation
title: T2 deleted-adapter simulation — stub an adapter's exports to never, and fail only in registry.ts
type: chore
priority: med
status: open
size: s
capability: 05-strava-adapter
depends_on: [36]
blocked_by: []
source: agent
created: 2026-09-04T00:47:04Z
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

- [ ] A check exists that type-checks the repo with the adapter directory's exports stubbed to
      `never` (or the directory replaced by a stub module), without mutating the working tree.
- [ ] It reports the complete list of files that fail to compile under that stub.
- [ ] It passes only when that list is exactly `["src/adapters/registry.ts"]`, and fails with the
      offending paths named when it is not.
- [ ] It fails, demonstrably, when a second file is made to import the adapter directly — proven
      by a self-test in the same style as `scripts/check-boundaries.mjs --self-test`, not by a
      temporary commit.
- [ ] It runs in `.github/workflows/gate.yml` **and** `amplify.yml`, so the deploy path cannot
      bypass it.
- [ ] Its failure message names **D-100** and **D-121.1**, so a future reader knows what the check
      is protecting before deciding to delete it.
- [ ] It discovers the adapter directory rather than hard-coding a vendor name, and is therefore
      exempt from needing an entry in `check-boundaries.mjs`'s `EXEMPT` list.

## Notes

Written in plain node under `scripts/`, like the other gate checks, if it needs to shell out to
`tsc`. `scripts/` runs in the Amplify build container, which has no TypeScript of its own — check
how `npm run typecheck` resolves `tsc` there before assuming a spawn will work. If it cannot run
in that container, say so and wire it into the vitest suite instead, which `amplify.yml` already
runs; do not ship it to only one of the two gates.

The temptation is to implement this by actually deleting the directory and restoring it. Do not —
a check that mutates the tree fails badly when interrupted, and leaves a repo missing its adapter.
Stub via a temporary tsconfig `paths` override or a generated stub module in a scratch directory.

## Operator validation

None. A CI check with no user-visible surface. Verified by the agent: the check green on a clean
tree, red on the self-test's synthetic second importer, and the failure output naming the
offending file. Record the actual output at close, not the instruction.
