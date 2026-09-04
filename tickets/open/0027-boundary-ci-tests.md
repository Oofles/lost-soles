---
id: 27
slug: boundary-ci-tests
title: The four boundary CI tests (T1-T4) that prove the D-100 adapter boundary holds
type: chore
priority: high
status: open
size: m
capability: 04-domain-contract-and-rules
depends_on: [13, 26]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-04T00:48:52Z
---

## Description

`docs/contracts/ingestion-contract.md` §5 lists the checks that make D-100 a property rather than
a promise. Wire them into the PR gate from 0013 so they run on every push and every PR, and so a
violation is a **red build**, not a code-review comment.

**T1 — no vendor identifiers outside the adapter directory.**
`grep -ri strava src/domain src/pipeline` returns **nothing**. Extend to the whole tree except
`src/adapters/strava/`, `__fixtures__/` and tests: any case-insensitive `strava` identifier
outside that directory fails the build (D-100, D-121.1). This is the check that stops the
boundary rotting one convenient import at a time.

**T2 — swapping the primary source touches one directory plus one registry line.**
Assert structurally: every import of `src/adapters/strava/**` in the repo comes from inside that
directory or from `src/adapters/registry.ts`. A deleted-adapter simulation (type-check with the
directory's exports stubbed to `never`) must fail **only** in `registry.ts`.

> **SPLIT 2026-09-03 → `0156`.** Only the importer scan was buildable here; it shipped in `0026`
> as `src/adapters/registry.test.ts` and this ticket wires it into the gate. The **deleted-adapter
> simulation** needs an adapter directory to delete, and none exists — `src/adapters/strava/`
> arrives in capability `05`. Moved to `0156`, `depends_on: [36]`.

**T3 — cross-adapter equivalence.** → **MOVED TO `0155`.**

> **SPLIT 2026-09-03 → `0155`, because T3 could not be built in ANY ordering of this backlog.**
> It needs an H3 res-10 projection. That is `0045` (`traceToCells`), which `depends_on: [25, 36]`;
> and `0036` `depends_on: [27]` — this ticket. So `0027 → 0036 → 0045 → what 0027 needed`. A
> cycle, not a priority call. `h3-js` is not a dependency of the project either.
>
> `0155` carries T3 in full with `depends_on: [45]`, which is the first point it becomes possible.
> It is a **split, not a drop** — this ticket's own Notes predicted the drop and argued against it,
> and that argument is reproduced there.

**T4 — `normalize()` is pure.**
A harness that invokes any adapter's `normalize()` with `globalThis.fetch`, the AWS SDK,
`Date.now`, `new Date()`, `Math.random` and `crypto.randomUUID` all stubbed to **throw**, and
asserts it still returns a correct `NormalizedIngest`. This harness is consumed by 0036 and by
the rebuild drill in capability `16`; it is the reason the drill can run after Strava access is
gone.

Contract §5 also names a **fidelity floor** (points-per-km above a threshold, to catch silent
source-side decimation before it permanently corrupts the map). That check needs real fixtures and
therefore ships with 0038 — reference it here so it is not lost.

## Acceptance criteria

- [x] ~~T1-T4~~ **T1, T2 and T4** run in the GitHub Actions PR gate **and** in `amplify.yml`, so
      a push to `main` cannot bypass them. *(Amended: T3 moved to `0155` — see the Description.
      T1 is `check-boundaries.mjs`, already in both; T2 and T4 are vitest tests, carried by
      `npm test`, which both gates run.)*
- [ ] T1 fails the build when a file containing `Strava` is added under `src/domain/`; a
      deliberate temporary commit proves it goes red, and the proof is recorded in the ticket's
      `## Resolution`.
- [x] T1's allowlist is exactly `src/adapters/<source>/` and `src/adapters/registry.ts` — no
      per-file exceptions. *(Amended, D-188: ~~`__fixtures__/` and test files~~. Exempting test
      files would undo a guarantee `0025` explicitly relies on — "the domain's own tests should
      not name a vendor, and `check-boundaries.mjs` enforces that" — and an adapter's own tests
      are already exempt by directory. `__fixtures__/` does not exist yet and is added by `0038`,
      which creates it; an allowlist entry for a non-existent path is dead config. `registry.ts`
      is required by `01-architecture.md` §3 T2 and was omitted from the original list.)*
- [x] T2 identifies every importer of the strava directory and fails if any is not
      `registry.ts`. *(Shipped in `0026` as `src/adapters/registry.test.ts`; it discovers adapter
      directories rather than naming one, so it already covers whatever adapter lands next. This
      ticket confirms it runs in both gates and gave it a failure message naming D-100/D-121.1.)*
- [x] ~~T3 runs two adapters over one physical run and asserts equal H3 res-10 cell sets within a
      stated tolerance; the tolerance is a named constant with a comment justifying its value.~~
      **MOVED TO `0155`** — unbuildable here, see the Description. Carried over verbatim, plus two
      further criteria on what the tolerance must and must not absorb.
- [x] ~~T3 is not skipped, not `.todo`, and fails if either adapter is removed.~~
      **MOVED TO `0155`.**
- [x] T4 stubs fetch, the AWS SDK, both clock sources and both RNG sources to throw, and passes.
- [x] T4 is exported as a reusable helper that any adapter's test can call with one line.
- [x] Each test's failure message names the decision it is protecting (D-100 / D-121.1 / D-140),
      so a future reader knows why it exists before deciding to delete it.

## Notes

The point of T1 is that it is stupid and mechanical. Resist making it clever: a grep that
understands context is a grep that can be argued with, and this one must not be arguable.

T3 is the test most likely to be dropped as "we only have one adapter". Do not drop it. The whole
D-121 bet is that the Strava adapter is replaceable, and a cell-set equivalence harness that
already exists is the difference between a one-week migration and a rewrite.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

None — CI infrastructure with no user-visible surface. Its correctness is demonstrated by the
deliberate red build required above: the operator should see the PR gate go red on the seeded
violation and green again when it is reverted. That screenshot in the capability doc is the
validation.
