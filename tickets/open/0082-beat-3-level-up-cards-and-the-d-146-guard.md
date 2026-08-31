---
id: 82
slug: beat-3-level-up-cards-and-the-d-146-guard
title: Beat 3 — queued level-up cards, and the D-146 guard that must never let one fire
type: feature
priority: high
status: open
size: m
capability: 12-post-run-moment
depends_on: [81, 65]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

`04-game-design.md` §4.2: *"This is the only moment in the app permitted to be loud."* Take it
literally.

A level-up card interrupts the tally, takes the screen (map dims to 25% under a `--navy-900` scrim
at 0.72), and holds for **1.4 s**. `06-ui-ux.md` §3.2, beat 3:

- Entry: scale 0.94 → 1.0, 220 ms `easeOutBack` (overshoot 1.02); gold border wipes in clockwise
  over 400 ms. Hold 600 ms. Exit: fade + 4dp rise, 200 ms.
- Contents: skill sigil (ink on gold), skill name in Cinzel 22sp letterspaced, and `46 → 47` where
  46 crossfades out as 47 rises in over 500 ms.
- **One card per level.** Three levels in one run means three cards queued at 1.4 s each. This is
  the only place the sequence may exceed its budget, and it **should** — a triple level-up is the
  best thing that can happen and rushing it is a design failure.
- **Milestone levels** (10/25/50/75/90/99) add the tier name and, where the milestone places
  something on the map, one line naming it. At 50 and 99 the card exits by **flying into the map**
  to the cell where it was earned, which then pulses once. Place-bound milestones are the strongest
  reward this app has; make the placement visible at the moment it happens.
- **Total Level milestones** (100/150/…) use the same card with the app crest instead of a sigil.
  Note the ceiling is **693**, not 594 (D-145) — the §3.2 wireframe's "594" is superseded.

### The D-146 guard

**Adding a new skill to the ruleset mints a free Total Level point** — a skill at level 1 that
nobody earned. It must **NEVER** fire a level-up card. Waking up to `TOTAL LEVEL 272` because a YAML
row was added is the app congratulating you for the operator's config change, and it devalues every
real card that follows it.

**The guard belongs at the notification layer, not the scoring layer.** Roadmap §5.2 is explicit.
Scoring must keep telling the truth: Total Level really did go up, `09` must not fudge it, and the
skills panel must show the new skill at level 1. What changes is only whether a *card* is emitted.

Implement it as a rule on the card queue, not as a filter buried in a component:

- A card is emitted only for a level transition **attributable to an `XpLedgerEntry` written for
  this activity**. Ledger-derived transitions produce cards; everything else does not.
- A skill whose first-ever appearance in `SkillState` has no ledger rows for this activity produces
  **no card**, and contributes no Total Level milestone card either — a Total Level crossing that is
  only reachable because of a minted point is suppressed, not celebrated.
- The guard is one predicate with a name, in one place, with its own test file.

## Acceptance criteria

- [ ] Each card runs 1.4 s ± 0.05 s; three queued cards take 4.2 s and none is dropped or overlapped.
- [ ] Cards interrupt the tally and the tally resumes where it left off afterwards.
- [ ] The map dims to a `--navy-900` scrim at 0.72 for the card's duration and restores after.
- [ ] Milestone levels 10/25/50/75/90/99 render the tier name; non-milestone levels do not.
- [ ] At level 50 and 99 the card exits into the map and the earning cell pulses once.
- [ ] Total Level milestone cards use the crest and fire at 100/150/…/up to the D-145 ceiling of 693.
- [ ] **Adding a new skill row to `xp-rules-v1.yaml` and reprocessing produces zero level-up cards**
      — asserted by a test that adds a skill, runs the notification layer, and expects an empty queue.
- [ ] In that same test, Total Level **does** increase and the new skill **does** appear in the
      skills panel at level 1: the guard suppresses the card, never the truth.
- [ ] A Total Level milestone crossed *only* because of a minted point fires no card; the same
      milestone crossed later by earned XP does fire one.
- [ ] The guard is a single named predicate with its own test file; a grep finds no second copy.

## Notes

Depends on 0081 (the tally it interrupts) and 0065 (Total Level).

The D-146 guard is the kind of bug that only appears months after the code is written, on the day a
seventh skill is added — which is a day the design explicitly plans for (`10`/5: a new activity
arrives as a YAML row only). Write the test now, while the reason is fresh.

D-148 applies to the card: gold leaf is a fill and a rule; gold type is permitted here only because
the skill name is ≥24sp-equivalent or sits on navy. Check the contrast, do not assume the card is
exempt because it is celebratory.

## Operator validation

**Go for an actual run and import it**, ideally one long enough to gain a level. On the Android
phone: does the card feel like an event or like an interruption? Watch the number crossfade — if `46`
and `47` are both legible mid-transition it is wrong; one should be leaving as the other arrives.

Then the guard, by hand: add a new activity skill row to the ruleset in a dev build, reload, and open
the most recent run's `/run/:id`. **No card may appear.** Go to `/skills` and confirm the new skill
is there at level 1 and Total Level has gone up by one. That combination — silent card, honest
number — is the whole test, and only a human opening two screens in order can see it.
