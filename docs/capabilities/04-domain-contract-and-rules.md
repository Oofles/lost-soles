# 04-domain-contract-and-rules

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`04-domain-contract-and-rules\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (10)

- `0025` — src/domain/activity.ts - Activity, Trace, GeoPoint, ActivityKind, transcribed from the canonical contract
- `0026` — src/adapters/types.ts and registry.ts - SourceAdapter, IngestJob, IngestCommand, mandatory listSince
- `0027` — The four boundary CI tests (T1-T4) that prove the D-100 adapter boundary holds
- `0028` — rules/xp-rules-v1.yaml WITH the match block and matchPriority - before the first line of the scorer
- `0029` — selectActivitySkills matcher plus the seed-time totality and determinism checks
- `0030` — The Vigil test, permanently in CI - adding a skill is a YAML row and zero code
- `0031` — Doc corrections - D-145 Total Level ceiling, D-146 free level point, and the 04 section 1.3 match/measure amendment
- `0157` — Roving and Cadence — two cycling skills, and the revealsGround field that keeps the map running-only
- `0158` — Rescale the cycling rate to 60 XP/km — a typical ride is 15 km, not 25
- `0160` — An omitted `enabled` silently disables a skill, and only distance skills are caught

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

**What this capability actually proved.** D-031's claim — adding a workout type is a data row and
zero code — stopped being an aspiration and became a test. `0030`'s two-commit PR is the evidence:
25 lines of YAML went green, and the string `"wayfaring"` in a file under `src/` went red. Nothing
else in the plan carries that weight, because every capability after this one assumes it.

**Three of the ten tickets were not planned, and all three came from the same place: a human
reading the data.** `0157` (the cycling pair) came from the operator wanting to log rides.
`0158` came from the operator knowing how far they actually ride — 15 km, not the 25 km the agent
invented — which made a shipped rate 40% wrong on a premise no test could see. `0160` came from
noticing, while writing a docs ticket, that a missing field had no check. The pattern is worth
carrying: **this capability's defects were in premises and absences, and neither is visible to a
correctness check.** `0158`'s resolution states it best — every smoke test passed on `0157` and
would have gone on passing.

**The failure mode this capability kept hitting is the silent one.** Not a crash, an *absence*:
a skill that stops matching (`0160`), a rate that is quietly too low (`0158`), a ledger row that
never appears. That shape is uniquely dangerous here because the map never re-fogs (D-020) and XP
never decreases (D-135) — so a correction can only ever add, and a period of silent under-award
becomes a replay job rather than an edit. Three checks in this capability now exist specifically
to make an absence loud at seed time, and every one of them was verified to fail before it was
trusted to pass. That discipline should be treated as mandatory from here, not admirable.

**Where the design was weakest: it restated things the ruleset owns.** The audit's four
divergences were one failure repeated — `04` §1.1's Roving rate, `04` §3.2's parity table,
`02` §3.2's `unit` set, and a struck `ActivitySkill` union in `03` §1.1. Every one was falsified
by a change D-031 promises is free, which makes it a standing contradiction of the project's
central claim rather than a stale fact. **D-192 saw this six hours earlier and fixed only the
Total Level ceiling**; D-193 generalises it, and `0162` files the enforcement that D-193 admits
it does not yet have. The code was correct in all four cases — the budget overrun was a design
problem, exactly as AUDIT.md predicts it usually is.

**Two checks were found lying, and both were `n/a` rows in the audit table.** `vigil-test`
reported *"no vigil test exists yet — ticket `0030` puts it permanently in CI"* **after `0030`
closed and shipped `registry-delta.test.ts`**. `invariant-sweep` armed on the first correct `I-26`
citation and demanded all thirty, which `0116` does not deliver until capability `18` — so as
written it fails every audit from `04` to `17` (`0161`). Both are gates reporting something other
than the truth, and a green-looking `n/a` is worse than a red row because nobody reads it twice.
**Read every `n/a` reason and check it against the repo** — that instruction is already in the
audit procedure and it is the only reason these were caught.

**For the next capability (`05-strava-adapter`).** It meets a third party, so budget it the way
`02` was: assume roughly one filed-not-planned ticket per two planned. And the D-121 boundary that
`0027` built the gate for is the thing `05` will be tempted to bend — the gate is mechanical and
does not exempt test files (D-163), which is the point.

