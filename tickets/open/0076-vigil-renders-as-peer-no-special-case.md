---
id: 76
slug: vigil-renders-as-peer-no-special-case
title: Vigil renders as a peer of Wayfaring with no special case — the UI half of D-132
type: feature
priority: high
status: open
size: s
capability: 11-skills-panel
depends_on: [73, 75]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-07T18:51:08Z
---

## Description

**Vigil is already the fifth activity skill.** It arrived in Round 4, after `04-game-design.md`
§1.2 was written, which makes it the first live test of D-031's promise that a new skill is a
data row. `02-data-model.md` §3.5 proved the *scoring* half — one YAML row, one seeded item,
zero lines of code. **This ticket is the UI half.**

The panel-side test is exactly this: adding Vigil must require **no layout change, no new
section, no special case, and no design review.** In the §5.2 wireframe it is simply the fifth
tile in `ACTIVITY`. If a future workout type needs anything more than a row in the registry and a
sigil in the icon set, the schema is wrong — D-132 says so in the strongest terms available.

Vigil's shape as it reaches the panel: `kind: activity`, `unit: km`, full rate (100 XP/km),
`groundMultipliers: null`, `feeds: constitution`. It is **not** ground-scored, so its detail
sheet's rules sentence must not mention explored ground, and it has no `ON THE MAP` milestones —
both of which must fall out of the data, not out of an `if`.

The name is **provisional**; the mechanic is not. Renaming Vigil must be an edit to one `name`
attribute and nothing else — the skill id is an opaque identifier and must never be a display
string.

## Acceptance criteria

- [x] Vigil renders as an `ACTIVITY` tile at its registry position (*amended 2026-10-07: was
      "the fifth" — see Resolution*) purely from its registry row — same tile
      component, same sizing, same bar, same tint as Wayfaring.
- [x] `grep -r 'vigil' src/` returns nothing outside `rules/`, fixtures and tests (I-25).
- [x] Removing the Vigil row from the fixture registry removes the tile and leaves the panel
      layout otherwise identical — no gap, no reflow of other tiles, no empty slot.
- [x] Wayfaring and Vigil display **independent** levels and XP; a Vigil award moves the Vigil
      tile and does not move Wayfaring, and vice versa.
- [x] Total Level includes Vigil and the computed ceiling is enabled rows × `maxLevel` with Vigil
      counted (*amended 2026-10-07: was **693** (D-145, 0063), superseded by D-192*).
- **Moved to 0074 (2026-10-07, operator decision):** the two detail-sheet criteria — the rules
      sentence generated from `groundMultipliers: null`, and `ON THE MAP` omitted without a skill-id
      check. The sheet is still a stub, and 0074 builds it.
- [x] Changing `name: Vigil` to any other string in the registry changes every occurrence in the
      UI, and nothing else in the app changes.
- [x] A Vigil-logged session reveals **no** map territory and produces no Cartography row (I-27),
      and the panel reflects that: Cartography does not move.
- [x] No component, style, icon lookup or copy string branches on Vigil specifically.

## Notes

D-132's three clauses are each satisfied by the row alone (`02-data-model.md` §3.5): a separate
skill (two `skillId`s ⇒ two `SkillState` rows), full activity XP (`xpPerUnit: 100`,
`groundMultipliers: null` ⇒ multiplier 1.0), and zero discovery credit expressed by **no field at
all**. The UI's job here is to add nothing to that.

Vigil ships in v1, which means it can prove the *rendering* is general but can no longer prove
that *adding* is free — that proof needs a skill the codebase has never seen, and it lives in
0072's Pull-ups zero-diff test.

## Resolution

**No production code changed.** The panel (0073/0075) already drew Vigil from its row alone, so
this ticket's work is the proof. It sits in a permanent test that the audit's `vigil-test`
check now finds beside `src/rules/registry-delta.test.ts`.

**Added `app/skills/vigil-peer.test.tsx`** (marker `THE VIGIL TEST`, 10 tests). Every assertion
compares Vigil against Wayfaring, or the panel against itself without the row:
- Vigil's row has the shape this ticket describes: activity, km, 100 XP/km,
  `groundMultipliers: null`, feeds Constitution.
- It is drawn at its registry index in `ACTIVITY`. With the ids, names and sigil stripped, its
  tile markup is byte-identical to Wayfaring's at equal XP, gold bar included.
- Its sigil comes from `rules/sigils.json`, not the fallback seal.
- Removing the row turns the `ACTIVITY` section into exactly the old one minus Vigil's `<li>`.
  `META` is unchanged, and no empty slot appears.
- Renaming it in the registry makes the whole page equal to the old page with the name
  string-replaced, `NEXT` line included.
- Total Level falls by exactly Vigil's level without it. The ceiling equals
  `totalLevelCeiling` = enabled × `maxLevel`, and drops by `maxLevel` without the row.
- An award to either Vigil or Wayfaring leaves the other's tile byte-identical.
- A traceless 5 km run goes through the real `scoreActivity` with `NO_CELLS`. It awards Vigil
  exactly 5 × `xpPerUnit` and writes no Wayfaring and no Cartography row. On the panel,
  Wayfaring's and Cartography's tiles stay byte-identical. That a traceless run writes no
  `ExploredCell` is already proven by `process-activity.test.ts` ("a traceless run reveals
  nothing either"), so this test passes that test's award, not a second proof of it.

The "no branch on Vigil" criterion is held by these comparisons together with
`src/rules/no-skill-names.test.ts`, which already scans `src/`, `app/`, `lib/` and
`components/` for every registry id. Running the criterion's grep on `src/` returns nothing. The
only `Vigil` in non-test code under `app/`, `lib/` or `components/` is prose in the
`lib/log/rows.ts` header comment.

**Criteria amended, not ticked away:**
- **"The fifth `ACTIVITY` tile" → "at its registry position".** The ticket was written against
  §5.2's wireframe, from before Roving and Cadence (`0157`). Vigil's `displayOrder` is 15, so it
  is the **second** activity tile, after Wayfaring. Registry order is §5.3 rule 2, and "fifth"
  would have needed exactly the special case this ticket forbids.
- **"Ceiling is 693" → enabled rows × `maxLevel`.** D-192 superseded the figure. Under v3 the
  ceiling is 9 × 99 = 891, and the test asserts the arithmetic, not a number.
- **The two detail-sheet criteria moved to 0074** (operator decision, 2026-10-07). The sheet is
  still a stub (`app/skills/[skillId]/page.tsx`), 0074 builds it and is blocked on 0242, and
  0076 did not depend on it. They are now criteria on 0074, with a note saying they must fall
  out of `groundMultipliers` and the milestone data.

**What went wrong:** the first run failed one assertion. `feeds` is `{skill, …}[]`, not a list
of ids. The test was wrong, not the code.

Full checks: `app/skills`, `lib/skills` and `src/rules` give 13 files and 246 tests, all green,
on Node 22. `tsc --noEmit` and `eslint` are clean.

## Operator validation

*Planned at ticket-write:* import a GPS-less 5 km treadmill activity, then check on `/skills` that
Vigil moves and Wayfaring does not, look at the detail sheet, and confirm nothing new appeared
on the map.

**Not imported live.** An accepted log awards XP that can never be removed (D-135). As in 0240,
the operator makes the first real Vigil log. The detail-sheet check moved to 0074 along with its
criteria.

### Smoke test: agent, 2026-10-07, `devault`, live, read-only

- **Live `SkillState`:** `wayfaring` 4,675, `cartography` 15,985, `constitution` 1,584,
  `might` 80. There is **no `vigil` row**: the 0240 check was undone before it was sent, so live
  Vigil is untrained.
- **Live ledger (T4):** 0 `vigil` rows. Of 19 activities, 1 is traceless. It has no Wayfaring
  and no Cartography row (0 such rows). No Wayfaring row shares an activity with a Vigil row.
- **The real scorer, on live standing:** `tmp/0076/render.tsx` (gitignored) takes the live
  `SkillState` above and adds a 5 km traceless run scored by the shipped `scoreActivity` under
  v3. The award was `{ vigil: 500, constitution: 167 }`: no Wayfaring, no Cartography. It renders
  the shipped `SkillsPanel` with the real `app/tokens.css` to `tmp/0076/before.html` and
  `after.html`.
- **Headless Chromium, 1280 px, read by the agent:**
  - *Before:* Total Level 58. Vigil is in `Untrained (5)` at level 1.
  - *After:* Total Level 64. Vigil is L7 in `ACTIVITY` between Wayfaring and Might, the same
    tile as Wayfaring's with a gold bar. Wayfaring (15) and Cartography (23) look identical to
    before. Constitution's bar moved, at the same level.

### For the operator: perceptual

**Desktop browser, open `tmp/0076/before.html` and then `tmp/0076/after.html`.** They show your
live levels, before and after a 5 km treadmill run.
1. Does Vigil's tile read as the same *kind* of thing as Wayfaring's: same size, same gold bar,
   nothing marking it as special?
2. Between the two pages, do Wayfaring's and Cartography's bars look unmoved while Vigil's
   appears and fills?
