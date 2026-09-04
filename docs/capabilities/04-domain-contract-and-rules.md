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

## Audit — 2026-09-04 (`tickets.mjs audit --record`)

**Verdict: FORCED.** Mechanical half: 8 passed, 1 failed, 3 n/a. See AUDIT.md §1, §4, §5.

> **Overridden with `--force`.** Reason: Two overrides, recorded separately. (1) invariant-sweep FAILS on a defect in the CHECK, not in this capability: 0133 specified it to arm on the first I-n citation anywhere, and src/rules/validate.test.ts correctly cites I-26 — but the ticket that supplies the other 29 (0116) is in capability 18, so as written the row fails every audit from 04 to 17. Filed as 0161 with a reproduction; cannot be fixed inside this capability without doing 0161's work. (2) Four divergences over the budget of three, recorded as four rather than folded into three to buy a pass — the 02 audit rejected that folding and it is rejected again here. All four were the SAME SHAPE: a design doc restating a value rules/xp-rules-v1.yaml owns, falsified by a change D-031 promises is free. The prescribed DESIGN session was performed, scoped to the five sections the audit found, and its output is D-193 (generalising D-192 from the Total Level ceiling to every ruleset-owned value) plus 0162 for the enforcement D-193 admits it lacks. The code was correct in all four cases. Separately noted and not counted as a divergence: the vigil-test n/a reason is also stale — it says no vigil test exists yet, after 0030 closed and shipped src/rules/registry-delta.test.ts; 0161's Notes carry it.

> - 1 mechanical check(s) failed: invariant-sweep
> - 4 divergences, over the budget of three — the design is stale, not the code.

**Divergences (4 of a budget of 3):**

1. **design-was-wrong** — `D-193` — 04 §1.1 advertised Roving at 35 XP/km after 0158 rescaled it to 60
2. **design-was-wrong** — `D-193` — 04 §3.2's session-parity table — the one 0158 reasoned FROM — had no Vigil, Roving or Cadence row
3. **design-was-wrong** — `D-193` — 02 §3.2 listed unit as a closed set of four omitting share, contradicting §3.7 of its own document and the shipped file
4. **design-was-wrong** — `D-193` — 03 §1.1 carried a closed ActivitySkill union with 'adding a workout type adds a member' — the inverse of D-031/D-141, unreached by the file's supersession banner

- `typecheck` — **pass** — npm run typecheck
- `lint` — **pass** — npm run lint
- `unit-tests` — **pass** — npm run test
- `script-tests` — **pass** — node --test tickets.test.mjs
- `invariant-sweep` — **fail** — 29/30 invariants have no citing test: I-1, I-2, I-3 [S], I-4, I-5 [S], I-6, I-7 [S], I-8 [S], I-9, I-10, I-11 [S], I-12, I-13, I-14, I-15, I-16, I-17, I-18 [S], I-19 [S], I-20 [S], I-21, I-22, I-23 [S], I-24, I-25, I-27, I-28 [S], I-29 [S], I-30
- `boundary-greps` — **pass** — check-boundaries.mjs clean
- `vigil-test` — **na** — no vigil test exists yet — ticket 0030 puts it permanently in CI (D-031/D-141)
- `validate` — **pass** — 0 errors across open/ and closed/
- `fog-no-refog` — **na** — no explored blob or fog pipeline exists yet — activates with capability 07 (D-020, I-7)
- `xp-not-lower` — **na** — no XP ledger exists yet — activates with capability 09 (D-135, I-16)
- `blocked-by-closed` — **pass** — no blocked_by points at a closed ticket
- `capability-tickets-closed` — **pass** — 10 closed

<!-- audit-record {"capability":"04-domain-contract-and-rules","audited":"2026-09-04T17:08:55Z","verdict":"forced","mechanical":{"pass":8,"fail":1,"na":3},"divergences":4,"forced":"Two overrides, recorded separately. (1) invariant-sweep FAILS on a defect in the CHECK, not in this capability: 0133 specified it to arm on the first I-n citation anywhere, and src/rules/validate.test.ts correctly cites I-26 — but the ticket that supplies the other 29 (0116) is in capability 18, so as written the row fails every audit from 04 to 17. Filed as 0161 with a reproduction; cannot be fixed inside this capability without doing 0161's work. (2) Four divergences over the budget of three, recorded as four rather than folded into three to buy a pass — the 02 audit rejected that folding and it is rejected again here. All four were the SAME SHAPE: a design doc restating a value rules/xp-rules-v1.yaml owns, falsified by a change D-031 promises is free. The prescribed DESIGN session was performed, scoped to the five sections the audit found, and its output is D-193 (generalising D-192 from the Total Level ceiling to every ruleset-owned value) plus 0162 for the enforcement D-193 admits it lacks. The code was correct in all four cases. Separately noted and not counted as a divergence: the vigil-test n/a reason is also stale — it says no vigil test exists yet, after 0030 closed and shipped src/rules/registry-delta.test.ts; 0161's Notes carry it."} -->
