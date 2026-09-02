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

**T3 — cross-adapter equivalence.**
The same physical run ingested via two adapters yields the **same H3 cell set** within tolerance.
Only one adapter exists at MVP, so land the harness now with a **second, synthetic fixture
adapter** replaying the same GPX-derived points through a different code path. The test must be
real and green, not `test.skip`.

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

- [ ] T1-T4 run in the GitHub Actions PR gate **and** in `amplify.yml`, so a push to `main`
      cannot bypass them.
- [ ] T1 fails the build when a file containing `Strava` is added under `src/domain/`; a
      deliberate temporary commit proves it goes red, and the proof is recorded in the ticket's
      `## Resolution`.
- [ ] T1's allowlist is exactly `src/adapters/strava/`, `__fixtures__/` and test files — no
      per-file exceptions.
- [ ] T2 identifies every importer of the strava directory and fails if any is not
      `registry.ts`.
- [ ] T3 runs two adapters over one physical run and asserts equal H3 res-10 cell sets within a
      stated tolerance; the tolerance is a named constant with a comment justifying its value.
- [ ] T3 is not skipped, not `.todo`, and fails if either adapter is removed.
- [ ] T4 stubs fetch, the AWS SDK, both clock sources and both RNG sources to throw, and passes.
- [ ] T4 is exported as a reusable helper that any adapter's test can call with one line.
- [ ] Each test's failure message names the decision it is protecting (D-100 / D-121.1 / D-140),
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
