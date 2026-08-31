---
id: 116
slug: invariant-test-sweep-i1-i26
title: Invariant test sweep — 02-data-model.md §9 I-1 through I-26
type: chore
priority: high
status: open
size: m
capability: 18-mvp-hardening
depends_on: [51, 59, 67, 103]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Walk `02-data-model.md` §9 invariants **I-1 … I-26** and give each one of exactly two things: a
test, or a written reason it cannot have one. No third option. An invariant with neither is an
invariant that is not enforced, and the §9.2 definition-of-done box requires this list to be
complete.

Alongside them, the mechanically-checked invariants §9.2 of the roadmap names explicitly, several
of which will already have tests from earlier capabilities — this sweep confirms they exist, are
in CI, and actually fail when violated:

- [ ] `grep` for Strava identifiers outside `src/adapters/strava/` returns nothing, and that grep
      **fails the build** (D-100, D-121.1). This is the boundary that makes D-121 reversible;
      0105 proved the recovery, this keeps the boundary that recovery depends on.
- [ ] The four boundary tests T1–T4 pass in CI.
- [ ] Adding a skill to `xp-rules-v1.yaml` produces a working skill with **zero** diff outside
      `rules/` — the permanent Vigil test (D-031, D-132, D-141).
- [ ] The matcher returns **exactly one** skill per `measure` across the full `ActivityKind` ×
      `hasTrace` grid; ambiguity is a **seed-time hard error** (I-26).
- [ ] `displayedXp == SUM(ledger)` after a full replay (D-142).
- [ ] A replay against a **lower** ruleset produces `retained_floor` rows and **no** visible
      decrease (D-135).
- [ ] Total Level ceiling is computed as `skillCount × 99` = **693**, never a literal (D-145).
- [ ] Adding a skill fires **zero** level-up cards (D-146).
- [ ] Re-processing an already-ingested activity changes zero cells, zero timestamps, zero ledger
      rows (idempotency, T8).
- [ ] Every explored cell carries `lastRunAt`, and **no code path writes a presence bit** (D-120).
- [ ] The map has never re-fogged. Revealed ground is still revealed (D-020).

For each invariant, record: the invariant id, the test file and test name, or — where a test is
genuinely impossible — the reason, in a sentence, in
`docs/capabilities/18-mvp-hardening.md`. "Hard to test" is not a reason; "this asserts a property
of history that only the operator's own six months can establish" is.

Each test must be proven to **fail** when its invariant is violated. A test that passes whether or
not the property holds is a decoration, and a sweep of decorations is the most dangerous artifact
this ticket could produce — it would make the §9.2 checklist read green on evidence that is worth
nothing.

## Acceptance criteria

- [ ] A table in `docs/capabilities/18-mvp-hardening.md` lists I-1…I-26, each with a test
      reference or a written reason; there are no blanks and no "TODO".
- [ ] Every listed test is in the default CI run, not a manual or nightly suite.
- [ ] Every listed test has been shown to fail under a deliberate violation — recorded as the
      mutation used, per invariant, for at least the eleven roadmap §9.2 items above.
- [ ] The Strava-identifier grep is a build failure and is proven by a scratch commit that adds
      `strava` outside the adapter directory and goes red.
- [ ] The D-145 ceiling test asserts the value is **derived** from `skillCount`, by adding an
      eighth skill in a fixture and expecting 792 — not by asserting 693.
- [ ] The D-146 test asserts **zero** level-up cards fire when a skill is added, including no
      queued card that fires on next open.
- [ ] The idempotency test re-processes a real ingested activity and asserts zero writes across
      cells, timestamps and ledger rows — a write count of zero, not an unchanged final state.
- [ ] The D-120 test asserts no code path writes a presence bit — by grep and by schema, so the
      absence is structural.

## Notes

I-26's seed-time hard error is worth checking behaves as *seed-time*: an ambiguity that surfaces
as a runtime error during a run is the failure this invariant exists to prevent, because the
runtime moment is the post-run moment and the user is standing outside.

Where an earlier capability already wrote the test, this sweep's job is verification, not
duplication — link to the existing test rather than writing a second one that can drift.

## Operator validation

On the laptop, open the completed table and pick three invariants at random. For each, open the
named test, break the code it guards in a scratch branch, and watch CI go red. If any of the three
stays green, the sweep is not trustworthy and every row needs re-checking. Then on the Android
phone, check the two invariants only the device can show: open `/skills` and confirm Total Level's
ceiling reads 693 with seven skills, and open `/` and confirm territory you revealed months ago is
still revealed — the D-020 check that no test can perform for you.
