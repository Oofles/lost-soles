---
id: 104
slug: ci-rebuild-drill-fixture
title: CI rebuild drill on every build against a ~20-object fixture spanning every SourceId
type: chore
priority: high
status: open
size: m
capability: 16-rebuild-drill
depends_on: [103]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-21T19:31:20Z
---

## Description

Run the **same** drill code path on every CI build against a checked-in fixture of ~20 raw
objects, asserting §8.3 steps 8.1–8.6. Same code, 1/200th the volume. **This is what stops an
adapter change silently breaking recovery** (§8.4).

The fixture must span **every `SourceId` in use** — one raw object per source is the minimum and
the point. An adapter whose `normalize()` is not exercised by the drill fixture is an adapter that
can rot without anyone noticing until the day recovery matters, which is the day there is no
second chance. Since §8.1 keeps raw objects forever and precondition 3 keeps adapters alive as long
as their objects exist, **the fixture only ever grows** — adding a source adds a fixture object in
the same PR, and CI fails if a `SourceId` in the registry has no fixture coverage.

The fixture must cover the shapes that actually break folds, not just a happy path:

- at least one activity with **no trace** (D-132 / Vigil path: full XP, zero discovery credit, no
  reveal) so the trace-absent branch is exercised;
- two activities whose cells **overlap**, so step 5's `visitCount`/`discoveryCount` and the
  half-credit branch run;
- two activities more than six months apart over the same ground, so the **re-arm** branch runs;
- an activity with an identical `dedupeKey` to another, so step-8 assertion 2's collision
  arithmetic is exercised rather than assumed;
- a deliberately corrupt object used only by the negative test below.

Fixtures are committed raw bytes plus a checked-in **expected-output file** (activity count, cell
count, per-skill XP, ledger sum). The drill's assertions compare against that file. Regenerating
expectations is a deliberate, reviewed commit — never an automatic overwrite, or the test becomes
a recorder of whatever the code currently does.

## Acceptance criteria

- [x] `npm run drill:ci` runs steps 1–8 against the fixture and exits non-zero on any of the six
      assertions; it is wired into the default CI workflow on every build, not nightly.
- [x] A test enumerates the adapter registry's `SourceId` values and fails if any has no fixture
      object — so adding an adapter without fixture coverage **fails the build**.
- [x] The fixture contains the five shapes listed above; each has a named test asserting the
      branch it exists to cover.
- [x] Expected outputs live in a checked-in file; there is no `--update-snapshots` path in CI, and
      the local regeneration command prints a warning that the diff must be reviewed.
- [x] A negative test proves the drill catches breakage: mutating one adapter's `normalize()`
      output field makes `drill:ci` fail with a named assertion, and this is asserted in CI itself
      (a mutation test, not a comment).
- [x] The corrupt fixture object causes a **logged, counted** normalize failure that does not
      abort the run, and step-8 assertion 1 then fails the build.
- [x] `drill:ci` runs in under 60 s so nobody is tempted to move it off the default build.

## Notes

The fixture is real archive bytes, so scrub it: fixture traces must not be the operator's actual
home-adjacent routes. Use a synthetic or clearly-elsewhere trace. This is a D-123 adjacency —
committed fixture geometry is geometry in a public-ish place (the repo) forever.

Keep the fixture small deliberately. The value is coverage of every `SourceId` and every fold
branch, not volume; volume is 0105's job and it only happens once.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

On the laptop, open the CI run for the most recent PR and find the `drill:ci` step: it should
report six passing assertions and a per-source normalize count with every `SourceId` listed.
Then, in a scratch branch, break one field in the Strava adapter's `normalize()` and push —
confirm CI goes red on a drill assertion, not on a type error. That red build is the entire point
of this ticket.

## Resolution

**Built on `0103`'s code path, not beside it.** `npm run drill:ci` calls `runDrillFrontHalf` and
`runDrillBackHalf` — the two functions `tools/drill/rebuild-drill.ts` (`npm run drill`) calls — with
the shipped adapter registry. The CI harness supplies only what the AWS CLI supplies there: a bucket
to read (an in-memory `DrillS3` over the committed bytes) and a target to write (`MemoryDrillStore`,
a `DrillStore`, per D-406). `tools/drill/rebuild-drill.ts` is **unchanged** (it is the AWS CLI and
has top-level side effects, so it is not importable; the reusable path is the pipeline modules),
which keeps the merge with `0301`/`0302` mechanical.

Files:

- `tools/drill/ci/drill-ci.ts` — the harness: `loadFixture`, `fixtureBucket`, `runDrillCi`,
  `expectations`, `expectedFromRun`, `trackedRulesFiles`.
- `tools/drill/ci/memory-store.ts` — `MemoryDrillStore`. Every create refuses an existing key, as
  D-408's conditions do; read-backs return what was stored, so step 5 folds the files and checks 4–5
  read T2/T4 back.
- `tools/drill/ci/cli.ts` — `npm run drill:ci` entry. Prints a per-source normalize count, the six
  step-8 rows and the expectations. `--with-corrupt` lists the corrupt object (exits 11).
  `--write-expected` regenerates `expected.json` locally, prints a must-review warning, and is
  refused when `CI`, `GITHUB_ACTIONS`, `AWS_APP_ID` or `CODEBUILD_BUILD_ID` is set.
- `tools/drill/ci/drill-ci.test.ts` — 13 tests, all in `npm test`: the pass and the 60 s budget;
  determinism; registry coverage; the five named shape tests; two mutation tests; CI wiring and the
  regeneration refusal.
- `tools/drill/__fixtures__/ci/` — 17 raw objects for one synthetic user, `objects.json` (key,
  `LastModified`, content type) and `expected.json`. Strava (10 payloads: a run, an overlapping
  run, the same ground seven months on, a run archived twice, its re-upload as a D-263 loser with a
  `.duplicate-of.json` pointer, a treadmill run with no streams, a walk with a D-284 kind override,
  a ride, a hike, weights) and manual (pushups, situps, plank, a hand-logged treadmill distance).
  All geometry is synthetic straight lines within the Point Nemo box. The directory is named
  `__fixtures__`, so `check-fixture-geography.mjs` covers it.
- `tools/drill/__fixtures__/ci-corrupt/` — one truncated Strava envelope. Its key carries its own
  sha256, so it passes the integrity check and fails inside `normalize()`, where an adapter
  regression would.
- `package.json` — `drill:ci` script (vite-node, like `drill`).
- `amplify.yml` (build phase) and `.github/workflows/gate.yml` — `npm run drill:ci` step.

**Which CI.** Both exist. `amplify.yml`'s build phase is the lock (D-163: it is what stops a deploy)
and says to keep its list in step with `gate.yml`, the alarm. So the step goes in both, right after
`check-drill-no-delete.mjs`. It needs no AWS and no `amplify_outputs.json`, so it runs in the gate
unchanged.

**The expected file is step 0, not a side comparison.** The fake bucket serves step 0's
`manifest.json` from `expected.json`'s `step0.generation` and `cellCount` (check 3), the
precondition-4 snapshot from its `xpBySkill` (check 4's waterline), precondition 1's
`--expect-objects` from its `objectCount`, and check 6's pre-drill rows from its `spotCheck`
(the overlapping Strava run, which itemises both new and recent ground). So the six assertions are
made against the reviewed file. On top of them, `expectations()` checks what the six cannot see:
exact per-skill XP, ledger rows and sum, activity and cell counts, per-source normalize counts, and
**no `retained_floor` rows**. Check 4 is `≥`, and D-135 floors absorb a drop, so a regression that
lowers XP passes check 4 by design. Expectation failures exit 20. A registered source with no
fixture payload exits 21.

**Mutation tests.** Truncating every Strava trace in `normalize()` fails `ASSERT_3_CELL_COUNT`
(exit 13) before any manifest is written. Halving Strava's `distanceM` is floored past check 4 and
fails `ASSERT_6_SPOT_CHECK` (exit 16). Both run in `npm test` on both CI surfaces.

**Measured:** the drill itself takes ~120 ms; `npm run drill:ci` takes ~5 s wall clock, most of it
vite-node startup. Whole suite: 4,300 tests pass.

No design doc changed: §8.4 describes this exactly. No new decision is needed beyond the ones
proposed in the wave report.

