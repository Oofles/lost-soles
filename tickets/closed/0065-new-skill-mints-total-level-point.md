---
id: 65
slug: new-skill-mints-total-level-point
title: D-146 — a new skill mints a free Total Level point that must never celebrate
type: feature
priority: high
status: closed
size: m
capability: 09-xp-engine-and-ledger
depends_on: [63]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-29T03:31:06Z
closed: 2026-09-29T03:48:39Z
---

## Description

**D-146.** `TotalLevel = Σ level(skill)` over every skill in the ruleset, and an untrained skill
is level 1. So **the moment a skill row is added, Total Level increases by one, with no work
done.** Vigil hits this first; **every future workout type hits it**, which is exactly why it
needs a guard rather than a one-off patch.

That increment is bookkeeping, not an achievement, and it must **never fire a level-up
celebration** (`06-ui-ux.md` §5.4, §10.5). A celebration you did not earn devalues every one you
did.

**Guard it at the notification layer, not the scoring layer.** The scoring layer is *correct* —
the level genuinely is 1 — and clamping it there would make `displayedXp == SUM(ledger)` false
and break D-142/I-15. The scorer keeps telling the truth; the thing that decides whether to
*celebrate* learns to ignore skills that were minted by this ruleset version.

This ticket delivers the engine-side half:

1. **`firstSeenAt` / `firstSeenRulesVersion` on every `SkillState` row**, stamped once when the
   row is created, from the registry version that introduced the skill — not from wall clock.
2. **`totalLevelDelta(before, after, registry)`**, which diffs Total Level **excluding skills
   whose `firstSeenRulesVersion` equals the ruleset version being applied**. This is the number
   the notification layer reads.
3. **`celebrableLevelUps(before, after, registry)`**, the per-skill equivalent: a skill appearing
   for the first time never yields a level-up event, at any level.
4. A **Total Level milestone suppression** flag: if a minted point happens to cross a milestone,
   the milestone is suppressed until the next genuinely-earned point crosses it.

The consuming UI — the level-up cards in `12-post-run-moment` — is out of scope here. This
ticket provides the signal, the contract and the tests; that capability wires it up.

## Acceptance criteria

- [x] `SkillState` carries `firstSeenRulesVersion` (and `firstSeenAt` for audit), written on row
      creation only and never updated afterwards.
- [x] `totalLevelDelta` excludes every skill whose `firstSeenRulesVersion` equals the version
      being applied, and includes every other skill.
- [x] `celebrableLevelUps` returns no event for a skill seen for the first time in this ruleset
      version, and returns the correct events for every other skill in the same batch.
- [x] **The headline test:** seed a ruleset, replay, snapshot Total Level. Add **one** skill row
      (and only a row) to the ruleset, re-seed, replay. Assert Total Level rose by **exactly the
      number of skills added** *and* that `celebrableLevelUps` returned an **empty** list and
      `totalLevelDelta` returned **0**.
- [x] The same test with **three** rows added asserts a rise of exactly 3 and zero events.
- [x] A minted point that crosses a Total Level milestone suppresses the milestone; the next
      genuinely-earned point fires it.
- [x] No ledger row is written for a minted point — `SUM(ledger)` for the new skill is 0 and
      `displayedXp == SUM(ledger)` still holds (I-15).
- [x] The scoring layer contains **no** clamp, suppression flag or special case for new skills;
      `grep` for the guard finds it only in the notification/derivation module.
- [x] A mixed case is covered: a replay that both adds a skill **and** genuinely levels an
      existing skill fires events for the latter only.

## Notes

The register entry is roadmap §5.2. The roadmap also places the *consumption* of this signal at
`12-post-run-moment`; this ticket exists so the signal is designed with the engine rather than
improvised inside an animation sequence at ticket ~90.

Why the exclusion keys on **ruleset version** and not "XP == 0": a skill can legitimately sit at
level 1 with zero XP for years and then be trained for the first time — that *is* a real level-up
and must celebrate. Only "this row did not exist under the previous ruleset" is the right test.

Related and deliberately separate: 0063 owns the 693 ceiling (D-145). D-145 is about the ceiling
being wrong; D-146 is about the increment being unearned. Both come from Vigil, neither is the
other.

## Operator validation

**Nothing here needs the operator yet** (D-181/D-229). The screen the original text names,
`/run/:activityId`, is still a stub, so there is no level-up card to watch not appear. Everything
below was run by the agent on 2026-09-28 against account `286588821906`.

**Automated.**
- `npm run typecheck` and `npm run lint` are clean.
- All 126 test files pass (2,338 tests).
- `check-boundaries`, `check-adapter-deletion`, `build-rules-json --check`, the `docs/INDEX.md`
  check and the other gate scripts pass.
- `tickets.mjs validate` reports 0 errors.

**Live smoke test: 5/5, on real DynamoDB.** The script ran the shipped path
(`scoreUnits → scoreGround → scoreWithPropagation → persistWithLedger`) into the deployed
`Activity-…`, `XpLedgerEntry-…`, `SkillState-…` and `LostSolesIngestReceipt` tables, as the
synthetic user `smoke-0065-<ts>`. Afterwards it deleted 8 ledger rows, 3 SkillState rows,
4 Activity rows and 4 receipts, and 0 remained.

| # | What it proved |
|---|---|
| 1 | The creating `ADD` stamped `firstSeenRulesVersion: 1` and `firstSeenAt` = the activity's `startedAt`. |
| 2 | A later commit and a backfilled earlier one left both stamps unmoved, while `firstXpAt` moved to the earlier `min` as it should. |
| 3 | A reps skill set to `introducedIn: 3` in a validated v5 was stamped `3`, while `rulesVersionLastComputed` was `5`. |
| 4 | I-15 held on the real tables: `displayedXp == xpLedgerSum == SUM(ledger)` for all 3 skills over 8 rows. |
| 5 | Using the real `SkillState`: with one row added in v2, Total Level rose by 1, `celebrableLevelUps` was empty and `totalLevelDelta` was 0. |

**Deployed worker.** Amplify job 243 (commit `54b19d3`) SUCCEEDED. The `processactivitylambda`
was redeployed at 03:40 UTC. An invoke with `{"Records":[]}` returned 200 with no `FunctionError`.

**★ Deferred perceptual check ★** belongs to the capability `12` ticket that wires
`celebrate.ts` into the level-up cards. There, on the desktop browser: deploy a ruleset with one
new row and import an ordinary activity. The post-run sequence must show **no** level-up card for
the new skill and **no** Total Level milestone flash. `/skills` must show the new tile at level 1
and a TOTAL LEVEL headline one higher, quietly.

## Resolution

**The design gap, settled with the operator before any code (D-257).** The ticket asked for
`firstSeenRulesVersion` stamped "on row creation, from the registry version that introduced the
skill". Neither half existed. `SkillState` rows are created by the first XP `ADD`, not when a
skill ships, and registry rows carried no version. Stamping the version doing the scoring would
make a skill added in v3 and first trained under v5 look minted in v5, which swallows its first
real level-up: the failure the Notes warn about. So:

- **`introducedIn` on every `RuleSkill` row.** It is required with no default, and the validator
  enforces `1 ≤ introducedIn ≤ version`. All ten v1 rows are `introducedIn: 1`. It was added to
  `rules/xp-rules-v1.yaml`, the regenerated `.json`, `04` §1.3's schema example (the doc-schema
  test validates it) and `02` §3.2.
- **"Minted" means `introducedIn > before.rulesVersion`**, not "equals the version being applied",
  so two versions shipping between runs are both caught. `09-roadmap.md` §5.2 is amended to match.

**Files.**
- `src/rules/schema.ts`, `src/rules/validate.ts`: the field, and `validateIntroducedIn`.
- `src/pipeline/xp-ledger.ts`: the `SkillState` `ADD` now sets
  `firstSeenRulesVersion = if_not_exists(…, :intro)` and `firstSeenAt = if_not_exists(…, :seen)`.
  `:intro` is the row's `introducedIn`; `:seen` is the creating activity's `startedAt`, never the
  clock (I-12). `ledgerTransactItems` and `persistWithLedger` take the registry `skills`. A
  scored skill missing from them throws rather than guess a value that would be stamped for ever.
  `process-activity.ts` passes `deps.registry.skills`.
- `amplify/data/resource.ts`: `firstSeenRulesVersion` and `firstSeenAt` added to the `SkillState`
  model. `02` T2 is documented.
- **`src/scoring/celebrate.ts` (new)** provides `totalLevelDelta`, `celebrableLevelUps` and
  `celebrableMilestones`. It is pure and exported from `src/scoring`. The guard is one function,
  `mintedSince`.
  - A minted skill yields no event at any level, including XP it earned in the diff that first
    scored it. The next diff, taken under the new ruleset, treats it normally.
  - A milestone fires when the displayed total is at or past it, it has not fired before, and the
    diff has at least one earned level.
  - The milestone ladder and `lastCelebrated` are the caller's (`12`) to keep and pass in, so no
    milestone number is written in `09`.
- The scoring layer is untouched: `units`, `ground`, `propagate`, `ledger` and `levels` contain no
  clamp or special case.

**Tests.**
- `src/scoring/celebrate.test.ts`, 13 tests:
  - the headline with 1 and 3 rows added, using a real replay through
    `scoreUnits → scoreGround → scoreWithPropagation` under v1, then under a validated v2;
  - no ledger row for the new skill, and all other XP identical;
  - the mixed case;
  - a minted skill trained in the same diff;
  - the first real level-up after the snapshot settles;
  - an untrained OLD skill's first level-up celebrating (the "not XP == 0" case);
  - two versions shipped between runs;
  - milestone suppression, firing on the next earned point, and no re-fire;
  - a source grep proving only `celebrate.ts` compares `introducedIn` against a version, and
    that the five scorer modules never mention it.
- `xp-ledger.test.ts` covers stamp semantics, v3-seen/v5-scored, refusal of an unknown skill,
  and the stamp surviving later and backfilled commits through the fake DynamoDB.
- `validate.test.ts` covers missing, non-integer or zero values, and values from the future.

**Criterion notes, honestly.**
- "Re-seed, replay" is done in memory. The replay job is `0066`. A re-seed here is
  `validateRuleSet` passing, which is the seeder's gate.
- The I-15 criterion is proven two ways: purely (no ledger row for the new skill), and on real
  DynamoDB in the smoke test below.
- Everything passed first run. That made me check the tests were not vacuous: the headline
  asserts the before-total is above the all-level-1 floor, and the milestone test asserts the
  minted point lands exactly on the rung.

**Found, and filed rather than widened.**
- **`0222`** (capability `12`): flipping a row from `enabled: false` to `true` (Slayer, D-122)
  also mints a point, and `introducedIn` cannot see it. The criterion "includes every other
  skill" forbade handling it here.
- Tooling: `tickets.mjs create --priority medium` succeeds, and then `validate` rejects it
  (`high|med|low`). I fixed 0222's frontmatter by hand. It is minor and not filed.
