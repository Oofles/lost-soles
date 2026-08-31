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

- [ ] Vigil renders as the fifth `ACTIVITY` tile purely from its registry row — same tile
      component, same sizing, same bar, same tint as Wayfaring.
- [ ] `grep -r 'vigil' src/` returns nothing outside `rules/`, fixtures and tests (I-25).
- [ ] Removing the Vigil row from the fixture registry removes the tile and leaves the panel
      layout otherwise identical — no gap, no reflow of other tiles, no empty slot.
- [ ] Wayfaring and Vigil display **independent** levels and XP; a Vigil award moves the Vigil
      tile and does not move Wayfaring, and vice versa.
- [ ] Total Level includes Vigil and the computed ceiling is **693** (D-145, 0063).
- [ ] Vigil's detail sheet renders from the same component as Wayfaring's, with the rules
      sentence generated from `groundMultipliers: null` — it must **not** claim "half on ground
      you have run before".
- [ ] Vigil's sheet omits the `ON THE MAP` section entirely rather than rendering an empty one,
      and this falls out of having no place-bound milestones, not a skill-id check.
- [ ] Changing `name: Vigil` to any other string in the registry changes every occurrence in the
      UI, and nothing else in the app changes.
- [ ] A Vigil-logged session reveals **no** map territory and produces no Cartography row (I-27),
      and the panel reflects that: Cartography does not move.
- [ ] No component, style, icon lookup or copy string branches on Vigil specifically.

## Notes

D-132's three clauses are each satisfied by the row alone (`02-data-model.md` §3.5): a separate
skill (two `skillId`s ⇒ two `SkillState` rows), full activity XP (`xpPerUnit: 100`,
`groundMultipliers: null` ⇒ multiplier 1.0), and zero discovery credit expressed by **no field at
all**. The UI's job here is to add nothing to that.

Vigil ships in v1, which means it can prove the *rendering* is general but can no longer prove
that *adding* is free — that proof needs a skill the codebase has never seen, and it lives in
0072's Pull-ups zero-diff test.

## Operator validation

On **`/skills`** on the **Pixel 8 Pro**: run 5 km on a treadmill with the phone in a pocket and
GPS off, log it, then open the panel. The **Vigil** tile must move and the **Wayfaring** tile must
not — check both bars, not just the levels. Vigil's tile must be visually indistinguishable in
kind from Wayfaring's: same size, same gold bar, same position rules. Open its detail sheet and
confirm the rules line says nothing about ground you have run before. Then open the **map on `/`**
and confirm no new territory was revealed anywhere.
