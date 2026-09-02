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

- [ ] `npm run drill:ci` runs steps 1–8 against the fixture and exits non-zero on any of the six
      assertions; it is wired into the default CI workflow on every build, not nightly.
- [ ] A test enumerates the adapter registry's `SourceId` values and fails if any has no fixture
      object — so adding an adapter without fixture coverage **fails the build**.
- [ ] The fixture contains the five shapes listed above; each has a named test asserting the
      branch it exists to cover.
- [ ] Expected outputs live in a checked-in file; there is no `--update-snapshots` path in CI, and
      the local regeneration command prints a warning that the diff must be reviewed.
- [ ] A negative test proves the drill catches breakage: mutating one adapter's `normalize()`
      output field makes `drill:ci` fail with a named assertion, and this is asserted in CI itself
      (a mutation test, not a comment).
- [ ] The corrupt fixture object causes a **logged, counted** normalize failure that does not
      abort the run, and step-8 assertion 1 then fails the build.
- [ ] `drill:ci` runs in under 60 s so nobody is tempted to move it off the default build.

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
