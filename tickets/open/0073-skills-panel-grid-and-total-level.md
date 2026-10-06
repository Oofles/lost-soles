---
id: 73
slug: skills-panel-grid-and-total-level
title: /skills panel — every skill, level, bar, Total Level headline
type: feature
priority: high
status: open
size: m
capability: 11-skills-panel
depends_on: [16, 63]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-06T19:30:50Z
---

## Description

The Runescape-inspired skills panel (`06-ui-ux.md` §5.2). Runescape's skills tab is the
explicitly-loved model, and it is worth being precise about *why* it works, because copying its
surface without its logic gives you a spreadsheet:

- **Every skill is on one surface, always, at a fixed position.** You learn the layout with your
  eyes, not by reading. Tile 3 is Fortitude forever.
- **One glance = one number per skill.** The level. Everything else is a click away.
- **Total Level lives in the panel**, as the summary of the grid it sits in.
- **A skill you have never trained still exists.** The panel shows the shape of the whole game.

What we do **not** take: no hover-only information *(phone rationale struck, D-251)* — everything RS puts in
a tooltip goes into the detail sheet; no XP-per-hour, no goals, no ranks, no hiscores; and **no
fixed 3×8 board**, because we do not know how many skills we will have and the layout must grow.

Layout: a 56dp app bar; a **pinned header** carrying `✦ TOTAL LEVEL <n>`, a progress bar to the
next milestone, and `Total XP <n>` beneath it; then sections `ACTIVITY`, `META`, and a collapsed
`▸ Untrained (n)` row. Tiles are 104 × 104dp on an 8dp gutter, three across at 360dp width —
sigil 28dp, skill name 12sp, level 24sp tabular figures, a 3dp full-width progress bar. The
`META` section ends with the **crest tile**: Total Level again, RS's corner, and clicking it does
nothing. It is a seal.

*(D-251, 0215: the dp dimensions above are phone-derived. Layout follows `06` §5.2 as revised by
`0187`.)*

A `NEXT` card below the grid carries **one line** — `~9 runs to Wayfaring 48`. Not a list.

Every tile is generated from the registry. There is no per-skill component anywhere.

## Acceptance criteria

- [x] `/skills` exists as a route; back returns to `/`; a deep link opens it directly.
- [x] Every enabled skill in `xp-rules-v1.yaml` appears exactly once, with **no per-skill
      component** and no hardcoded skill list.
- [x] Tiles render sigil, name, level and a progress bar showing progress toward the next level,
      computed from `4L²` (0063).
- [x] The header shows `TOTAL LEVEL` and `Total XP` and is **pinned** — it does not scroll away
      at any skill count.
- [x] Total Level equals `Σ level(skill)` over the enabled registry including meta skills, and
      matches the value the home plinth shows. *(The plinth is not built yet (capability 13).
      Checked instead against `Profile.totalLevel`, the server's figure the plinth reads, on live
      data: 58 = 58.)*
- [x] Total XP is displayed under Total Level and is the value that increases every session.
- [x] Sections render as `ACTIVITY`, then `META`, then the collapsed `Untrained` group.
- [x] The crest tile appears at the end of `META`, shows Total Level, and is inert on click.
- [x] The `NEXT` card shows exactly one line and never becomes a list.
- [x] Levels use tabular figures so a level change does not reflow the tile.
- [x] Nothing on the screen is a target, a goal, a "train this" prompt, a neglected-skill warning
      or a decay indicator (D-013, H2).
- [x] The panel renders from cache offline with no spinner and no empty state.
- [x] With the fixture ruleset at ceiling, the header reads ~~**693**~~ `totalLevelCeiling`
      (enabled rows × `maxLevel`, 891 at v1/v2). *(Amended 2026-10-06, D-283. 693 was a
      remembered number, which D-192 and `06` §5.4 forbid. It was already stale by two rows.)*

## Notes

**Cross-capability dependency added during backlog validation (2026-08-30):** 0016 provides the app shell and route stubs /skills mounts into.


Rendering `Untrained` as a collapsed group and the per-skill detail as a sheet are specified in
0075 and 0074 respectively; this ticket owns the grid, the header and the registry-driven
generation.

RS's panel is one click from a hiscores page. Ours is not, and never will be — there is no
comparison surface in this app, against other people or against your own past self.

**2026-09-29 — from `0066` (moved here by the operator's decision).** Two things `0066` could not
do, because this panel did not exist yet:

1. **The read-side gate.** `0066` writes `Profile.replayInProgress` (T1, owner-read). While it is
   `true`, this panel must keep rendering the `SkillState` it already has and must not refetch or
   re-render from a subscription, so no tile moves until the replay's step 6 has written every
   row (`02` §4.4 step 1). When the flag clears, refetch once.
2. **The perceptual check `0066` deferred.** On the desktop browser, with `/skills` open, run
   `tools/xp-replay/replay-xp.ts --confirm` against a deliberately stingier ruleset from a
   terminal. No tile's level or bar may visibly decrease at any point, including during the run.
   After a reload every level must be the same or higher. The detail sheet for the skill that
   was rated down must show a legible "retained" line (its `retained_floor` row), because the
   retention must be visible, not silent.

## Resolution

**Built.** `/skills` is a static route, like `/log` (D-282). It renders from the bundled registry
plus the IndexedDB cache with no spinner and no empty state, then revalidates behind the cache.

- `src/scoring/levels.ts`:
  - `levelProgress(xp, curve, levelHighWater)`: the displayed level (`max(computed,
    levelHighWater)`, I-17), plus XP still needed and the fraction into the level.
  - `TOTAL_LEVEL_MILESTONES` and `totalLevelRung(total, ceiling)` for the header bar. The ceiling
    is always appended from `totalLevelCeiling`.
- `lib/skills/panel.ts`, `skillsPanel(rules, standing)`:
  - Puts every enabled skill into exactly one of `ACTIVITY`, `META` or `Untrained`
    (xp 0 and level 1, of either kind), in `displayOrder`.
  - Total Level sums the displayed levels. That is the same sum `xp-replay.ts` step 6 writes to
    `Profile.totalLevel`, so the plinth and the panel cannot disagree.
- `lib/skills/next.ts`:
  - `recentSessions` sums one activity's ledger rows per skill. It skips floor rows,
    `__replay__` rows and other rule versions, and keeps the last 10 by `seq`.
  - `nextLine` returns one string or `null` (D-283). It cannot become a list.
- `lib/skills/load.ts`, `loadSkillsPanel(deps, emit)`:
  - Emits the cache first.
  - Then the replay gate from `0066`'s note: while `Profile.replayInProgress` it refetches
    nothing and polls only the flag every 5 s, then refetches once when it clears.
  - Then the network, written back to the cache. Any failure is silent and the cache stands.
  - DOM-free, so it is unit-tested. The repo has no jsdom.
- `lib/skills/transport.ts`: `fetchRecentLedger` (GSI2, newest 500 rows, paged) and
  `fetchReplayInProgress`. `lib/log/transport.ts`'s `fetchSkills` now also carries
  `levelHighWater`, and `CachedSkill` gained the optional field.
- `rules/sigils.json`: nine monoline sigils as SVG path data, plus Slayer's for when it is
  enabled. `components/sigil.tsx` names no skill, draws a fallback seal for a missing entry, and
  holds the crest mark (`✦`).
- `app/skills/page.tsx` (static), `skills-page.tsx` (client container) and `skills-panel.tsx`
  (pure presentation).
  - Three columns at every width, so a tile's position never depends on the window (§5.1's
    muscle memory).
  - The app bar and header are `position: sticky` and opaque (D-148).
  - The crest is a `div`: no link, no button, no tabindex.
  - Untrained skills are a closed `<details>`. `0075` owns its finer rules.
  - Tiles link to `/skills/:id`, which is still `0074`'s stub.

**Tests** (+57):
- `levels.test.ts`: `levelProgress`, `totalLevelRung`.
- `lib/skills/{panel,next,load}.test.ts`: every bundled ruleset, no skill named, the replay gate
  and offline.
- `components/sigil.test.tsx`: every enabled skill in every bundled ruleset has a drawable sigil,
  and the fallback works.
- `app/skills/skills-panel.test.tsx`:
  - section order, the crest inert and last in META, the pinned header, tabular figures;
  - NEXT is one `<p>`, and is absent when there is no estimate;
  - no instruction words, and no `.sort(` in `app/skills/`.
- Full suite: 153 files, 2,742 tests, green on Node 22. `tsc`, `eslint` and `next build` are
  clean, and the build shows `○ /skills`.

**What went wrong.**
- **`bySkill` (GSI3) cannot be queried through AppSync.** Its INCLUDE projection lacks `owner`,
  and the owner rule filters on it. The first smoke run failed with *"Secondary index bySkill
  does not project one or more filter attributes: [owner]"*. Switched to `byUserAndSeq`, which
  is ordered by activity time and so the better read for "recent" anyway. Filed **`0242`** to
  fix the index, and **blocked `0074` on it**, because `0074`'s `RECENT` list is GSI3's stated
  purpose.
- The first full test run failed 212 tests on the system Node 20 (`webidl.util.markAsUncloneable`).
  That is the host, not the code: the memory note says use fnm's Node 22. Green there.
- The "693" criterion was stale (D-192). It is amended above, not ticked against a wrong number.

**Decisions:** D-283. Sigils go in `rules/sigils.json`, the ladder is a constant in
`levels.ts`, NEXT names the skill fewest sessions away, and sessions are read from GSI2.

**Not done here, deliberately.** 04 §4.3's milestone sigil states (a blank seal before level 10,
colour at 25) are not in this ticket's criteria. The `0066` flicker check (a stingier replay run
while `/skills` is open) is perceptual and moves to capability 11's audit, as D-277 already
says. The code half, the replay gate, is built and tested.

## Operator validation

*Planned at ticket-write:* On **`/skills`** in the desktop browser: read the TOTAL LEVEL
figure **in under two seconds without scrolling**. Scroll the grid to the bottom and confirm the
header stays put. Compare the Total Level shown here against the number on the home plinth —
they must be identical, not merely close. Check that a skill you have never trained is still
findable on this screen, and that no tile anywhere says what you should do next.

**Smoke against the deployed stack (agent, 2026-10-06, `devault`).**
`tmp/0073/smoke.ts` created a throwaway Cognito user, signed in by SRP through Amplify, and
seeded three ledger rows and a Profile row for that user only. It then drove the shipped modules:
- `fetchReplayInProgress`: `false` with no Profile row, `true` once seeded.
- `fetchRecentLedger` through AppSync: exactly the user's 3 rows, newest activity first.
- `recentSessions` over them: `[400, 150]`.
- The rows and the user were deleted and confirmed gone.

**The panel over the operator's live data (agent, read-only).** `tmp/0073/live-model.ts`
computed the panel from live SkillState and the ledger:
- Total Level **58 = `Profile.totalLevel` 58**, and Total XP **22,324 = `Profile.totalXp`**.
- ACTIVITY: Wayfaring L15, Might L4.
- META: Cartography L23, Constitution L11.
- Untrained (5): Vigil, Roving, Cadence, Fortitude, Endurance.
- NEXT: `~1 session to Might 5`.

**Operator, desktop browser, `/skills` — verified 2026-10-06: "All 5 steps validate perfectly!"** The five checks were:
1. Read the TOTAL LEVEL figure in under two seconds without scrolling. It should say 58.
2. Make the window short, scroll to the bottom, and confirm the header stays put.
3. Check that an untrained skill is findable: `Untrained (5)` opens to show it.
4. Check that no tile says what you should do next.
5. Judge the sigils: can you tell each one from the others without its label? (`06` §8.6)

