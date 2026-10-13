---
id: 83
slug: chronicle-and-frontier-lines
title: Beats 4 and 5 — the chronicle line and the frontier line
type: feature
priority: high
status: closed
size: m
capability: 12-post-run-moment
depends_on: [81, 48]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-13T21:43:32Z
closed: 2026-10-13T22:21:32Z
---

## Description

Two lines of text that do more emotional work per byte than anything else in the app.

**Beat 4 — the chronicle line (6.0 → 7.2 s).** One generated sentence in the setting's voice, keyed
off the run's most distinctive computed fact. `04-game-design.md` §4.2 supplies the template table.

- Spectral Italic 17sp, `--ink-700`, on the ledger, centred, 22dp of air above and below. **Nothing
  else on screen moves while it is there.**
- Fades in over 500 ms and **stays in the end state**.
- *"Thirty-eight paces in a hundred fell on roads that had never felt your step."*
- *"You returned to Ashgrove Lane after two hundred and eleven days. It remembered you."*

The line is cheap — a template table over facts the ledger already computed — and it is what makes
the app feel like it is paying attention. It is a **template table**, data, not a `switch`: adding a
line is adding a row.

The table must include the dedicated **no-new-ground set** (§3.5 rule 4), written to be *warm*,
never consoling:

- *"Old roads, run well. The map holds them still."*
- *"The eleventh league along the river. It knows your weight by now."*
- *"You have now walked further than the road from here to Carlisle."* (lifetime threshold)
- *"Ashgrove Lane comes back into season in nineteen days."* (a cell approaching the 6-month re-arm —
  the **only** forward-looking line in the app, and it is an invitation, not a deadline)

**Never**: *"No new territory today"*, *"0 cells discovered"*, *"Try somewhere new!"* The first
states a lack, the second quantifies it, the third gives an instruction — and instructions are N2 in
miniature.

**Beat 5 — the frontier line (7.2 → 8.4 s).** One line at the very bottom:

```
  ◇  Unclaimed ground 1.2 km north — Millbrook
```

- `--ink-500`, 14sp, small hollow diamond glyph. **Quiet by construction.**
- Clicking it recentres the map there in **atlas** mode.
- **Ignoring it costs nothing.** It never repeats, never turns red, never counts down, never appears
  as a notification (D-013, `04-game-design.md` §4.2). It is a signpost, not a task.

## Acceptance criteria

- [x] Beat 4 spans 6.0 → 7.2 s and beat 5 spans 7.2 → 8.4 s, ± 0.1 s each, in the desktop browser.
      — smoke: 6,000 → 7,200 → 8,400 ms nominal (wall minus card pauses); 6,009 → 8,409 on job 360.
- [x] The chronicle line fades in over 500 ms with nothing else on screen animating during it.
      — 531 ms to full opacity at frame granularity; 71 sampled frames in beat 4 with the panel, every
      count, the card layer and the frontier line unchanged. `beat45.test.ts` holds the same rule.
- [x] Both lines persist into the end state and survive a scroll.
- [x] The template table is a data file (YAML/JSON); adding a new line requires **zero** code diff,
      proven by a test that adds one and asserts it can be selected. — `rules/chronicle.json`;
      `chronicle.test.ts` "adding a line is a data row, never code".
- [x] Selection is deterministic given the same facts: the same activity produces the same line
      twice, so a `⟲ Relive` does not rewrite history. — unit, and three deployed loads of one run.
- [x] Line selection has a guaranteed fallback: a run whose facts match no template still gets a
      line — never an empty slot, never a placeholder. — enforced by the table validator.
- [x] A run with `newCells = 0` selects from the no-new-ground set, never from a set that would
      mention new ground.
- [x] A repository-wide test asserts no template string contains the substrings `No new`,
      `0 cells`, or an imperative "Try" — the three forbidden shapes.
- [x] The frontier line names a real nearest unexplored frontier with a distance and a bearing; a
      click recentres the map there ~~in atlas mode~~ **and requests atlas mode through
      `requestRenderMode(FRONTIER_MODE)`** (amended at close: there is no atlas mode until capability
      15 — `lib/run-moment/mode.ts`, D-295 — so the request is a no-op today; `0098` carries a note to
      honour it. Operator decision, 2026-10-13).
- [x] The frontier line is rendered once, never repeats, never changes colour, and has no
      notification, badge or countdown anywhere in its code path. — grep test over its three files.

## Notes

Depends on 0081 (the ledger the lines sit on) and 0048 (the discovery classification that supplies
the facts). The nearest-frontier computation shares its source with 0090's derived stats feed —
build it once, in the domain layer, not twice.

The re-arm line ("comes back into season in nineteen days") is the single forward-looking string
permitted in the entire app. It exists because the 6-month re-arm (D-120) is genuinely good news, not
because the app should ever be pointing at the future. Do not let it become a pattern; if a second
forward-looking template is proposed, it needs a decision record, not a commit.

## Operator validation

**Use the next ordinary run, or an imported/replayed or synthetic activity (manual adapter or through the queue, D-229).** In the desktop browser, read the chronicle line out loud. Does
it sound like the app noticed something, or like a fortune cookie? That is a judgement only the
operator can make and it is the point of this ticket.

Then replay (or wait for the next ordinary run of) a loop you have run many times before, and read the line it picks. It must land
as *"you did the work"* and never as consolation. If it makes you feel slightly worse about a
perfectly good run, the template set is wrong and the ticket is not done.

Finally click the frontier line and confirm the map recentres in atlas mode on somewhere real and
reachable — and then deliberately ignore it for a week and confirm the app never mentions it again.

## Resolution

**What was built:** `6218205`, then two follow-ups. `fd5b59a` fixed `strava#` ids in a domain
test fixture, which the D-100 grep caught in CI and in the Amplify build. `2e8a7c2` stopped the
chronicle line's 22px margin stacking on the end-state column's 1.5rem gap, which I saw in the
smoke screenshots.

The operator made four calls up front (2026-10-13):
1. Build the frontier primitive here, and point `0090` at it.
2. Ship without place names, and file `0256` for them.
3. The click recentres the map and only *requests* atlas mode.
4. Template rows whose facts nobody computes yet stay in the table but are never selected.

**The chronicle line.**
- `rules/chronicle.json` holds 28 rows in two sets, `new-ground` and `no-new-ground`, plus some rows
  that belong to both.
- `src/domain/chronicle.ts` is pure:
  - The set is fixed by `newCells > 0`.
  - A row is eligible when all of its `when` conditions hold (`eq/gt/gte/lt/lte/in`) **and** every
    placeholder has a fact.
  - The highest `rank` wins. Ties break on an FNV-1a hash of the activity id plus the row id.
  - Placeholders accept `:words`, `:Words` and `:ordinal`. They use British "and", so 211 renders as
    "two hundred and eleven".
- `assertChronicleTable` refuses a malformed table outright: unknown op, duplicate id, malformed
  placeholder, a forbidden shape, or **a set with no unconditional, placeholder-free row**. That
  last rule is what guarantees the fallback. No fallback string is hard-coded.
- **The facts are computed as of the run.** `chronicleFacts` filters the history to activities
  strictly before the run (by `startedAt`, then id), so later runs never change an old line.
  - Lifetime cells are the sum of `newCellCount`, since new cells are first-ever by definition.
  - Lifetime leagues, `roadCount` (activities with distance only, so gym logs are not "roads"), and
    longest-in-a-year / longest-ever have floors of 8 and 20 prior roads. Without them, a second run
    would be announced as "the longest road in a year".
  - A failed history read gives `null`, which drops every lifetime-shaped fact. Otherwise the run
    would be treated as the first ever and announce milestones it never reached.
- **Server-side.** `lib/runs/chronicle-server.ts` pages `byUserAndStart` up to the run's
  `startedAt`, projecting four attributes (id, `startedAt`, distance, new-cell count). The page
  receives one sentence and the table never ships to the browser. `RunSummary` gained `cellCount`,
  which was already a T3 column, for the new-ground share.
- **The untraced case** was not in the design. A gym session has `newCells = 0` and would have read
  "Old roads, run well". The old-roads rows are now conditioned on `traced = 1`. An untraced
  activity gets its own row, and the unconditional fallback is neutral ("Set down in the record,
  where nothing is ever lost.").
- **Waiting rows.** `rearmed-returned-named` and `rearm-soon-named` need `{street}`,
  `rearmGapDays` and `rearmInDays`, which nothing computes yet. They are in the table and are never
  selected (`0256`). The "eleventh league along the river" line is not in the table at all, because
  nothing counts visits along a road.

**The frontier.**
- `src/domain/frontier.ts` follows §8.4, with two departures recorded in its header:
  - It walks the disk at `RES` (11), the explored set's own resolution, not res 10.
  - Its weights are an argument: the Cartography row's `unitMultipliers`, handed in by the caller
    (D-272: rates live only in the rules file).
  - The domain cannot import `src/rules`, so `NoveltyWeights` restates the shape. `contract-drift`
    caught the first attempt.
- **Cost.** About 26k cells at a 4 km radius takes 12–28 ms in Node. So `RunMoment` computes it
  only once beat 4 begins (`onLines`), or immediately in the end state, never during beat 1's
  lantern or beat 2's count.
- **Picking and wording.** `lib/run-moment/frontier-line.ts` takes the best-scored cluster that is
  at least 50% novel and at least 250 m away. It measures from the run's first fix, or from the
  home camera for an untraced run, and names an 8-point compass direction.
- **Nothing is stored**, so the line has nothing to repeat or count down with.

**The beats.**
- Beat 2's `PausableClock` now runs past 6.0 s instead of handing off. `lib/run-moment/beat45.ts`
  maps that same clock to the two fades: 500 ms each, at 6.0 s and 7.2 s, with `onDone` at 8.4 s.
  So a pause in beat 2 shifts every later boundary with it.
- The tally's frame is clamped to its settled value through beats 4 and 5.
- `window.__sequence` gained `beat4Start`, `beat5Start` and `end` for the harness.
- Both lines are drawn on the panel during the sequence and in the end-state column afterwards,
  with the same components (`run-lines.tsx`).

**Tokens.**
- The design names `--ink-700`, but components may only use semantic tokens. I added
  `--text-chronicle`: `--ink-700` in light, `--parch-100` in dark, because ink-700 on navy is
  illegible (D-051).
- `check-contrast.mjs` gained the pair: 30 pairs, all at AA.
- Spectral is still not loaded (`0255`), so the line renders in the Georgia/serif fallback.

**Tickets touched.**
- Filed `0256` (place and street names: a decision first).
- Added notes to `0090` (use this primitive) and `0098` (honour `FRONTIER_MODE`).
- `0256` sits in capability 12, so it blocks 12's audit until it is decided or moved.

**Tests.** `chronicle.test.ts` (34), `frontier.test.ts` (7), `beat45.test.ts` (5),
`frontier-line.test.ts` (12), `chronicle-server.test.ts` (3), and `run-moment.test.tsx` (+4).
Full suite green in CI (`gate` on `fd5b59a`).

## Operator validation

**Agent smoke, deployed site (Amplify job 361, `2e8a7c2`), 2026-10-13** (`tmp/0083/{seed.ts,drive.mjs,cleanup.ts}`).

**Setup.** A throwaway Cognito user with three synthetic Point Nemo runs, put through the
production `processActivity`:
- A: 2026-09-20, km 0–3. All new (175 of 175 cells).
- B: 2026-10-10, the same km 0–3. `newCells = 0`.
- C: 2026-10-11, km 3–5. 113 of 118 cells new.

Headless Chromium at 1280×900.

**All 17 product checks passed**, on both job 360 and the final job 361. The figures below are from 361.
- B played with `?play=1`. Measured against the sequence clock minus 3,016 ms of level-up cards,
  beat 4 started at 6,000 ms, beat 5 at 7,200 ms, and the sequence ended at 8,400 ms.
- The chronicle line reached full opacity after 531 ms. Through beat 4's 71 frames, the panel
  transform, the counts (`+150|+50`), the card layer and the frontier line did not change.
- B read "Another line laid down in the web of your roads. It darkens where you return." That is
  from the old-roads set. It was the same on three loads.
- B's frontier read `◇ Unclaimed ground 0.9 km north-east`.
- C read "Ninety-five paces in a hundred fell on roads that had never felt your step."
  A read "Every step of it fell on ground the map had never held."
- Both lines were visible at full opacity after scrolling to the bottom. Clicking the frontier
  scrolled to the top and moved the map; the screenshot is all fog, as expected for unexplored
  Point Nemo.
- No console errors.

**Screenshots** (`tmp/0083/shots/`): beat 5 on the panel, the end state, the scrolled end state,
and after the frontier click. In the first pass the end state showed about 46 px of air around the
chronicle line; the fix is above.

**Cleanup.** Afterwards, 0 activity rows, 0 ledger rows and no `users/<uid>/` objects remained for
the uid. Deleted:
- DynamoDB: 3 activity, 9 ledger, 3 skill-state, 1 profile, 3 receipt and 302 explored-cell rows.
- S3: 27 object versions.
- The archive bucket and the Cognito user.

**For the operator (perceptual, desktop browser, your own runs):**
1. Open a recent run and read the chronicle line out loud. Does it sound like the app noticed
   something, or like a fortune cookie?
2. Open a loop you have run many times. Its line must land as "you did the work" and never as
   consolation.
3. Click the frontier line. Is the place it recentres on real and reachable? It will not change
   rendering mode until `0098`.
4. The type is the Georgia fallback until `0255`. Judge the voice, not the face.
