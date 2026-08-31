---
id: 75
slug: panel-rules-for-year-ten
title: The rules that keep the skills panel readable in year ten
type: feature
priority: high
status: open
size: m
capability: 11-skills-panel
depends_on: [73]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The panel has to survive an **unbounded** number of workout types (D-031) without ever becoming
a wall. It must work at 15 skills, not just at 7. `06-ui-ux.md` §5.3 names six rules that do
that work, and this ticket implements and tests all six.

**1. Sections, not one list.** `ACTIVITY` / `META` / `Untrained`. A new workout type appends to
`ACTIVITY` and nothing else moves. Sections cap the *perceived* length: you never scan more than
one group to find a skill.

**2. Registry order, forever. Never sorted by level.** Sorting by level makes the panel a
ranking of your own body against itself and, worse, **makes tiles move — which destroys the
muscle memory that is the entire reason RS's panel works.** The order is
`rules/xp-rules-v1.yaml`'s order. New skills append; existing skills never move. This is not a
preference and there is no setting for it.

**3. Untrained skills collapse.** A skill never once trained sits inside a collapsed
`▸ Untrained (n)` row at the bottom, showing name and level 1 when expanded. This is how the
panel holds twenty workout types without twelve dead tiles diluting the eight live ones — and it
still satisfies RS's "show me the whole game", one tap down.

**4. The grid scrolls; the header does not.** Total Level and Total XP are pinned and must not
require a scroll at any skill count.

**5. Meta skills are tinted, not just labelled.** Activity bars fill `--gold-500`; meta bars
fill `--verdigris-500`. You can tell what kind of skill you are looking at without reading the
section header — which matters once the panel is long enough that the header has scrolled away.

**6. Nothing on this screen is an instruction.** No targets, no "train this", no neglected-skill
warnings, no decay. **A skill at level 3 you have not touched in a year looks exactly like a
skill at level 3 you trained yesterday** (D-013).

## Acceptance criteria

- [ ] Skills render in `displayOrder` order from the registry; a test seeded with skill levels in
      descending, ascending and random order produces the **same** tile order every time.
- [ ] There is no sort control, no "sort by level" setting, and no code path that orders tiles by
      any value other than `displayOrder`.
- [ ] Adding a skill to the fixture registry appends it within its section and **moves no
      existing tile's index** — asserted positionally, not visually.
- [ ] A skill with zero lifetime XP renders inside the collapsed `▸ Untrained (n)` group; the
      count is correct; expanding shows name and level 1.
- [ ] A skill leaves the `Untrained` group permanently on its first award and takes its
      registry-order position in `ACTIVITY` or `META`.
- [ ] The header stays pinned with a **15-skill** fixture; scrolling the grid never moves it.
- [ ] Activity bars fill `--gold-500` and meta bars `--verdigris-500`, taken from the row's
      `kind`, never from a skill-id lookup.
- [ ] A 15-skill fixture renders without horizontal scroll, without tile clipping, and without a
      new section, at 360dp and at 412dp widths.
- [ ] No string on the panel is imperative: a test asserts the rendered text contains no
      target, streak, goal, decay or "neglected" language.
- [ ] A skill untouched for a simulated year renders identically to one trained today at the same
      level — same tile, same tint, no badge.

## Notes

Rule 2 is the one most likely to be argued with later ("wouldn't it be nice if your best skills
were at the top?"). No. The answer is in the rule: tiles that move are tiles you have to read.
Muscle memory is the feature.

Rule 3 is what makes rule 2 survivable at twenty skills — registry order plus collapse means the
live part of the panel stays short without anything being reordered.

The `Untrained` test should key on **lifetime XP == 0**, not on `firstSeenRulesVersion`; a newly
added skill and a never-trained old skill are the same thing from the panel's point of view, and
the distinction that matters (celebration suppression) lives in 0065, not here.

## Operator validation

On **`/skills`** on the **Pixel 8 Pro**, with a 15-skill test ruleset deployed: find Fortitude
**without reading the labels** — by position alone, from memory. Then have the levels change (log
a session), reload, and find it again the same way; it must be in exactly the same place. Confirm
the `▸ Untrained (n)` row is at the bottom, that expanding it does not push the pinned header
off, and that the meta bars are visibly a different colour from the activity bars at arm's
length, without reading the section headings.
