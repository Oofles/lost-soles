---
id: 65
slug: new-skill-mints-total-level-point
title: D-146 — a new skill mints a free Total Level point that must never celebrate
type: feature
priority: high
status: open
size: m
capability: 09-xp-engine-and-ledger
depends_on: [63]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] `SkillState` carries `firstSeenRulesVersion` (and `firstSeenAt` for audit), written on row
      creation only and never updated afterwards.
- [ ] `totalLevelDelta` excludes every skill whose `firstSeenRulesVersion` equals the version
      being applied, and includes every other skill.
- [ ] `celebrableLevelUps` returns no event for a skill seen for the first time in this ruleset
      version, and returns the correct events for every other skill in the same batch.
- [ ] **The headline test:** seed a ruleset, replay, snapshot Total Level. Add **one** skill row
      (and only a row) to the ruleset, re-seed, replay. Assert Total Level rose by **exactly the
      number of skills added** *and* that `celebrableLevelUps` returned an **empty** list and
      `totalLevelDelta` returned **0**.
- [ ] The same test with **three** rows added asserts a rise of exactly 3 and zero events.
- [ ] A minted point that crosses a Total Level milestone suppresses the milestone; the next
      genuinely-earned point fires it.
- [ ] No ledger row is written for a minted point — `SUM(ledger)` for the new skill is 0 and
      `displayedXp == SUM(ledger)` still holds (I-15).
- [ ] The scoring layer contains **no** clamp, suppression flag or special case for new skills;
      `grep` for the guard finds it only in the notification/derivation module.
- [ ] A mixed case is covered: a replay that both adds a skill **and** genuinely levels an
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

On the **`/run/:activityId` post-run moment** on the **Pixel 8 Pro**, with the phone in one hand
straight after a run: this is validated by what you **do not** see. Deploy a ruleset with one new
workout type added, then complete an ordinary run and open the post-run sequence. The tally may
show the usual rows; **no level-up card may appear for the new skill**, and the Total Level line
must not flash a milestone. Then open `/skills` and confirm the new tile is present at level 1
and the TOTAL LEVEL headline is one higher than before — quietly.
