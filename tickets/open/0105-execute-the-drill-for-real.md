---
id: 105
slug: execute-the-drill-for-real
title: EXECUTE THE DRILL FOR REAL, once, before MVP ship — four numbers pasted or it did not happen
type: chore
priority: high
status: open
size: m
capability: 16-rebuild-drill
depends_on: [103, 104]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Run the full §8.3 drill **once, for real, against the live raw archive**, into a parallel stack,
with the cutover **not** performed.

**This is the ticket that turns D-101 from a claim into a measurement, and it is what proves the
D-121 Strava decision is reversible.** The entire justification for building MVP ingestion on an
API whose terms forbid retention, and whose athlete cap can revoke access without notice, is that
the raw archive can rebuild everything without that API. Until this run happens, that is an
argument. After it, it is a number.

**It is also the ticket most likely to be skipped**, because by the time Phase 3 arrives the app
works, CI is green, and the drill feels like ceremony (roadmap §4.3). It is not ceremony. CI
proves the code path works at 20 objects against fixtures the code's authors chose. This proves it
works at real volume against real objects written by the real adapter over months, including the
ones that were written before some refactor nobody remembers.

**Done-condition: a pasted result.** These four numbers go into
`docs/capabilities/16-rebuild-drill.md`, with the date and the commit sha of the drill run:

1. **Object count** under `raw/<uid>/` at drill start.
2. **`normalize()` failure count** (must be 0).
3. **Final `cellCount`** against `manifest.json`'s step-0 `cellCount`.
4. **Final Total XP** against the `snapshots/skillstate/` snapshot's total.

**If those four numbers are not in the capability doc, the drill did not happen.** A checked box,
a green CI run, a "ran it, looked fine" in a commit message, and a summary that says PASS without
the values are all explicitly insufficient — this ticket cannot be closed by assertion.

Constraints on the run itself:

- Into a **parallel CDK stack** with new empty tables. Cutover is **not** performed. Tear the
  stack down afterwards and record the teardown.
- The step-0 snapshot is written **before** the run and its path is recorded.
- Step 9 (reconnect sources) is **not** performed — there is nothing to reconnect, because the
  live stack was never touched.
- Record wall-clock and the actual AWS cost of the run against the §8.3 estimates (under 30
  minutes, roughly $0.50). If either is off by an order of magnitude, that is a finding worth
  writing down, not rounding away.

## Acceptance criteria

- [ ] The drill has been executed against the live archive, into a parallel stack, and the stack
      has been torn down; the CloudFormation stack name and deletion time are recorded.
- [ ] All six step-8 assertions passed; the assertion table as printed by the run is pasted into
      `docs/capabilities/16-rebuild-drill.md` verbatim.
- [ ] The **four numbers** above are pasted into that doc with the run date and commit sha, and
      each is the value the run printed — not a value typed from memory.
- [ ] `normalize()` failure count is **0**. Any non-zero count means investigating the specific
      key and re-running; it does not mean lowering the bar.
- [ ] Final `cellCount` **equals** the step-0 `cellCount` (`fogAlgoVersion` unchanged). A `≥` is
      only acceptable with a recorded `fogAlgoVersion` change and its reason.
- [ ] Every skill's rebuilt `displayedXp` ≥ the snapshot's, and the per-skill comparison table is
      pasted alongside the four numbers.
- [ ] Measured wall-clock and cost are recorded next to the §8.3 estimates.
- [ ] The live map was untouched: the live `manifest.json` `generation` is identical before and
      after, recorded as two values in the doc.

## Notes

Do this while there is no pressure. The same drill is scheduled again immediately before any D-121
migration, and that run will happen under pressure — the value of this one is that it finds the
surprises first.

If the run reveals raw objects the current adapters cannot normalize (an old adapter version's
output shape, an object written during a partial deploy), that is exactly the finding this ticket
exists to produce. File it as a new ticket against the adapter, fix it, re-run. Do not exclude the
object from the enumeration to make the numbers match — that converts a real gap into a clean
report, which is the specific failure this whole capability is designed to prevent.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

On the laptop, open `docs/capabilities/16-rebuild-drill.md` and read the four numbers. Then, from
the phone, open `/` and check the map is exactly as it was — same territory, same last run — and
open `/skills` and check Total XP matches the number pasted as "final Total XP". Two devices, the
same figure, one of them rebuilt from nothing but a bucket of files: that agreement is the proof.
If the numbers in the doc are round, hand-typed, or absent, the ticket is not done.
