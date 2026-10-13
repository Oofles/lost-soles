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
started: 2026-10-13T20:31:58Z
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

- [x] Each card runs 1.4 s ± 0.05 s; three queued cards take 4.2 s and none is dropped or overlapped.
- [x] Cards interrupt the tally and the tally resumes where it left off afterwards.
- [x] The map dims to a `--navy-900` scrim at 0.72 for the card's duration and restores after.
- [x] Milestone levels 10/25/50/75/90/99 render the tier name; non-milestone levels do not.
- [x] At level 50 and 99 the card exits into the map and the earning cell pulses once.
- [x] Total Level milestone cards use the crest and fire at 100/150/…/up to the ~~D-145 ceiling of 693~~
      computed ceiling — **891** today, nine enabled skills × 99 (amended at close: D-145's 693 is struck
      in `DECISIONS.md`; the ladder appends `totalLevelCeiling`, never a typed number).
- [x] **Adding a new skill row to `xp-rules-v1.yaml` and reprocessing produces zero level-up cards**
      — asserted by a test that adds a skill, runs the notification layer, and expects an empty queue.
- [x] In that same test, Total Level **does** increase and the new skill **does** appear in the
      skills panel at level 1: the guard suppresses the card, never the truth.
- [x] A Total Level milestone crossed *only* because of a minted point fires no card; the same
      milestone crossed later by earned XP does fire one.
- [x] The guard is a single named predicate with its own test file; a grep finds no second copy.

## Notes

Depends on 0081 (the tally it interrupts) and 0065 (Total Level).

The D-146 guard is the kind of bug that only appears months after the code is written, on the day a
seventh skill is added — which is a day the design explicitly plans for (`10`/5: a new activity
arrives as a YAML row only). Write the test now, while the reason is fresh.

D-148 applies to the card: gold leaf is a fill and a rule; gold type is permitted here only because
the skill name is ≥24sp-equivalent or sits on navy. Check the contrast, do not assume the card is
exempt because it is celebratory.

**2026-10-07 (capability `10` audit, D-288).** `06` §6.4 says level-ups still interrupt on
`/log`: *"If a log crosses a level, the §3 Beat 3 card plays over the page, identically."*
`0068` handed this to this ticket ("capability 12's Beat 3 (`0082`)"), but the body above never
mentions `/log`. So it is in scope here: the card must also play over `/log` when a hand log
crosses a level. The row already computes the resulting level optimistically
(`lib/log/optimistic.ts` `rowResult`). The D-146 guard applies there too, since a new skill's
first log mints a point.

## Operator validation

**Use the next ordinary run, or an imported/replayed or synthetic activity (manual adapter or through the queue, D-229)**, ideally one long enough to gain a
level. In the desktop browser: does the card feel like an event or like an interruption? Watch the number crossfade — if `46`
and `47` are both legible mid-transition it is wrong; one should be leaving as the other arrives.

Then the guard, by hand: add a new activity skill row to the ruleset in a dev build, reload, and open
the most recent run's `/run/:id`. **No card may appear.** Go to `/skills` and confirm the new skill
is there at level 1 and Total Level has gone up by one. That combination — silent card, honest
number — is the whole test, and only a human opening two screens in order can see it.

## Resolution

**What was built:** `7f61d51`, plus one smoke fix (`cbd7b38`). The operator made four calls up front:
- Total Level milestones are judged on an **earned-only total**.
- The **earning cell is estimated along the route**.
- **`/log` stays in this ticket.**
- The card is set in **Spectral, with §3.2 amended**.

All four are recorded as **D-297**.

- **The guard.** It lives in `src/scoring/celebrate.ts`:
  - `isMinted(skill, baselineVersion)` is the one named predicate. 0065's private `mintedSince`
    now calls it.
  - `earnedTotalLevel` is the real Total Level minus the free level 1 of every minted skill.
  - `earnedMilestonesCrossed` returns the milestones in `(earned before, earned after]`.
  - Nothing is stored. A milestone fires on the activity that carries the *earned* total across it.
    One reached only by a minted point never fires, and the same milestone fires later when earned
    XP gets there.
  - The baseline is the first ruleset that shipped (`BASELINE_VERSION`). For a single user who
    started at launch, that is exactly "added after you started".
- **The queue.** `lib/level-up/cards.ts` is pure:
  - `skillCards` gives one card per level that this activity's XP bought. A skill with no gain gets
    no card, so a minted skill sitting at level 1 crosses nothing.
  - Each card carries its tier (from `SKILL_MILESTONES`), its place kind (50 → landmark, 99 →
    shrine, held as a data table), and its `arc`, the threshold's share of the gain.
  - `totalLadder` appends the computed ceiling.
  - `levelUpQueue` serves `/log`.
- **The clock.** `lib/level-up/beat3.ts`, 1.4 s per card:
  - the scale runs 0.94 → 1.0 on `easeOutBack`, with the constant solved so it peaks at exactly 1.02;
  - the border wipes in over 400 ms;
  - the number crossfades over 300–800 ms, and the old and new are never both visible;
  - the hold is 800 ms;
  - the exit is 200 ms.
- **The card.** `components/level-up-card.tsx`:
  - `--scrim` (`--navy-900` at 0.72) covers the full viewport.
  - Parchment card, a gold border drawn as an SVG `pathLength` wipe, and the sigil (or `CREST`) in ink
    on a gold disc.
  - Spectral 600: 22px uppercase tracked for the name, 34px for the number.
  - Gold tier rules, and an `aria-live` line announcing the level.
  - At 50 and 99 the card shrinks into the map at the estimated cell, and `CellPulse` rings it once.
- **Beat 2 integration** (`run-sequence.tsx`, `tally.ts` `cardTriggers`, `beat2.ts`):
  - A skill's cards play when its count lands. Total Level cards play after the Total Level line.
  - The beat 2 clock pauses, and `rewindTo` puts it back to the trigger's instant, so the tally
    resumes exactly where it was.
  - Expansion and cards both pause the clock. It runs only when neither does.
- **`/log`** (`log-page.tsx`): `onLog` builds the queue from the full standing and the award, with
  the row's own skill first, and plays it over the page.

**Findings:**
1. **Criterion 6 cited a stale ceiling.** D-145's 693 is struck in `DECISIONS.md`. There are nine
   enabled skills, so the computed ceiling is **891**, and the criterion is amended in place. The
   code never typed a number.
2. **§3.2's timings don't add up.** Its parts (entry 400 + hold 600 + exit 200) make 1.2 s against
   its own 1.4 s total. The total wins, so the hold is 800 ms. §3.2 is amended.
3. **§3.2 named Cinzel**, which §8.4 does not include. Amended to Spectral.
4. **Neither Spectral nor Inter is self-hosted anywhere yet**, so every page falls back to system
   fonts, and so does this card (Georgia). It is pre-existing; not filed, because §8.4 already
   specifies self-hosting and no ticket I checked was asked for it.

**What went wrong:**
1. **Queued cards drifted.** Each card's clock started when it mounted, so three queued cards ran
   4,324 ms with 41–46 ms gaps. Each card now starts at the previous card's nominal end, as beat 2
   does; the smoke then measured 4,205 ms.
2. **My first smoke seed assumed 7 enabled skills.** There are 9, so Total Level started at 101 and
   no 100 card could fire. The seed was wrong, not the code; the floor was corrected and the card
   fired.
3. **Harness misreadings, all mine:**
   - the overlap check compared a back-dated start with a frame-late end; it now asserts that no
     two cards are ever mounted at once;
   - a reused browser profile skipped the login form on the last run.
4. **Smoke `/log` entries never reached the server.** `logWorkout` refuses non-owners
   (`REFUSED:NOT_OWNER` in the Lambda log), and the queue dropped them. That is the correct
   behaviour for a throwaway account. The card, which plays optimistically, is what this ticket
   covers.

**Tests:**
- `src/scoring/d146-guard.test.ts` covers criteria 7–10:
  - adding a row and reprocessing gives an empty queue;
  - Total Level goes 99 → 100, and `skillsPanel` shows the new skill at L1;
  - a milestone that was minted-only does not fire; earned later, it fires 100;
  - a minted skill's own earned 1 → 2 is a card;
  - a grep of `src lib app components amplify` finds a single `isMinted` and no other
    `introducedIn` comparison.
- `lib/level-up/beat3.test.tsx`: the clock, the crossfade exclusion, queueing, tiers, places, the
  ladder and the markup (scrim, crest, no gold type).
- `tally.test.tsx`: the hand-off points.
- `beat2.test.ts`: `rewindTo`.

The full suite is green apart from the pre-existing `tmp/` polyline hit, which is gitignored.

## Operator validation

**Agent smoke, deployed site (Amplify job 356, `cbd7b38`), 2026-10-13** (`tmp/0082/{seed.ts,drive.mjs,cleanup.ts}`).

**Setup.**
- A throwaway Cognito user and one synthetic Point Nemo run through the production
  `processActivity`. Its gains were Cartography +376, Wayfaring +300 and Constitution +100.
- Synthetic `retained_floor` rows in that user's own ledger set "before" to: Cartography 188 XP
  short of 50, and Wayfaring at 43. Total Level before was 99 (9 skills).

Headless Chromium at 1280×900.

**Product checks: all passed on the final run** (18/19; the miss was the login form not rendering
under a reused profile).
- **Order.** Cards ran `cartography:50`, `constitution:2/3/4`, then `total:100`.
- **Durations.** Each card measured 1,405 / 1,405 / 1,405 / 1,405 / 1,414 ms.
- **The three queued cards** took 4,205 ms, and there was never more than one card mounted.
- **Scrim.** `rgba(11, 16, 32, 0.72)` the whole time, and gone afterwards.
- **Milestones.** The 50 card named ADEPT and its landmark; the 2–4 cards named nothing. The Total
  Level card showed the crest and 100.
- **The earning cell** pulsed exactly once.
- **The tally resumed exactly.** 10,516 ms wall, 7,415 ms paused (7,036 ms of cards), so 3.1 s of
  beat 2. The final counts are the exact ledger values.
- **`/log`.** Logging Vigil played `vigil:2…7` and then `constitution:5, 6` over the page, and the
  queue cleared.
- No console errors.

**Screenshots** (`tmp/0082/shots/`):
- The card is readable on the scrim.
- 49 → 50 is mid-crossfade, with the old number gone before the new one firms up.
- On the exit, the pulse ring sits on the route at the estimated cell.

**Cleanup**, verified empty afterwards (0 ledger and 0 activity rows for the uid):
- DynamoDB: 5 ledger, 1 activity, 3 skill-state, 1 profile, 1 receipt and 185 explored-cell rows.
- S3: 10 object versions.
- The archive bucket and the Cognito user.

**For the operator (perceptual, desktop browser):**
1. Does the card feel like an event or an interruption?
2. In the crossfade, is only one of 46/47 ever legible?
3. **The guard, by hand:**
   - add an activity skill row to the ruleset in a dev build, and reload;
   - open the latest `/run/:id` — **no card may appear**;
   - on `/skills`, the new skill must be at level 1 and Total Level up by one.

