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
started: 2026-10-07T16:54:53Z
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
still satisfies RS's "show me the whole game", one click down.

**4. The grid scrolls; the header does not.** Total Level and Total XP are pinned and must not
require a scroll at any skill count.

**5. Meta skills are tinted, not just labelled.** Activity bars fill `--gold-500`; meta bars
fill `--verdigris-500`. You can tell what kind of skill you are looking at without reading the
section header — which matters once the panel is long enough that the header has scrolled away.

**6. Nothing on this screen is an instruction.** No targets, no "train this", no neglected-skill
warnings, no decay. **A skill at level 3 you have not touched in a year looks exactly like a
skill at level 3 you trained yesterday** (D-013).

## Acceptance criteria

- [x] Skills render in `displayOrder` order from the registry; a test seeded with skill levels in
      descending, ascending and random order produces the **same** tile order every time.
- [x] There is no sort control, no "sort by level" setting, and no code path that orders tiles by
      any value other than `displayOrder`.
- [x] Adding a skill to the fixture registry appends it within its section and **moves no
      existing tile's index** — asserted positionally, not visually.
- [x] A skill with zero lifetime XP renders inside the collapsed `▸ Untrained (n)` group; the
      count is correct; expanding shows name and level 1.
- [x] A skill leaves the `Untrained` group permanently on its first award and takes its
      registry-order position in `ACTIVITY` or `META`.
- [x] The header stays pinned with a **15-skill** fixture; scrolling the grid never moves it.
- [x] Activity bars fill `--gold-500` and meta bars `--verdigris-500`, taken from the row's
      `kind`, never from a skill-id lookup.
- [x] A 15-skill fixture renders without horizontal scroll, without tile clipping, and without a
      new section, at a typical desktop width and at a narrow (~400 CSS px) window.
- [x] No string on the panel is imperative: a test asserts the rendered text contains no
      target, streak, goal, decay or "neglected" language.
- [x] A skill untouched for a simulated year renders identically to one trained today at the same
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

## Resolution

**Mostly proof, plus one rule change.** `0073` had already built the six rules into
`lib/skills/panel.ts` and `app/skills/skills-panel.tsx`: sections, `displayOrder`, a closed
`<details>`, a sticky header, and bar tint from `kind`. Its tests ran against the nine skills
that ship today. This ticket proves the rules hold at fifteen and fixes one predicate.

- **`lib/skills/panel.ts`.** Untrained now means **lifetime XP == 0** and nothing else, as the
  ticket's Notes ask. It was `xp > 0 || level > 1`, so a skill with zero XP and a
  `levelHighWater` above 1 counted as trained. XP never decreases (D-135), so leaving the group is
  permanent by construction.
- **`lib/skills/__fixtures__/fifteen-skills.ts`** (test-only, never in `rules/`). The newest
  bundled ruleset plus six appended rows, five activity and one meta, added as the next version.
  `appendSkills()` grows any ruleset the way §5.3 rule 2 says a registry grows. The names are
  long on purpose (Mountaineering, Steadfastness), to stress the narrow window.
- **`lib/skills/panel.test.ts`, +6 tests on the fixture:**
  - Levels seeded descending, ascending and at random give the same tile order. So does a
    registry file that lists its rows out of order.
  - Appending an activity skill or a meta skill leaves every existing index in that section
    unchanged, and leaves the other section untouched. Checked by index.
  - Zero-XP skills sit in Untrained, with the right count, their names and level 1.
  - Untrained keys on XP alone. This test fails against the old predicate.
  - Training all fifteen in random order: each first award moves the skill out of Untrained into
    its registry position, every section stays a subsequence of registry order, and nothing ever
    returns.
- **`app/skills/skills-panel.test.tsx`, +6 tests on the 15-skill render:**
  - There are still exactly two sections plus one `<details>`.
  - Total Level and Total XP are inside the sticky band, with no tile in it, and nothing on the
    page is a scroll container.
  - All three grids are `repeat(3, minmax(0, 1fr))`.
  - Each tile's bar is checked one tile at a time. Then every tile's `kind` is swapped and the
    tint follows, which proves nothing keys it on the skill id.
  - A wider list of banned instruction words: target, streak, goal, decay, neglect, should,
    must, try, aim, behind, "days ago", "last trained" and more.
  - A skill last awarded a year ago and one awarded today, at the same XP, render byte-identical
    tiles once the id, name and sigil are removed. The sigil differs by design, because it is
    the skill.

The existing `.sort(` ban in `app/skills/` and the model's single
`sort((a, b) => a.displayOrder - b.displayOrder)` together cover "no sort control and no
other ordering path". No change was needed there.

**Two things I left as they were, deliberately:**
- **The `▸` is the browser's own `<summary>` disclosure marker**, not a typed character. Typing
  "▸" would show two markers, and the browser's marker turns to ▾ when the group opens.
- **Dark mode fills bars with `--gold-300` and `--verdigris-300`**, through the
  `--progress-activity` and `--progress-meta` tokens (`app/tokens.css`). The criterion names the
  `-500` primitives, which are the light-theme values. The kind still picks the token, which is
  the rule. That §5.3 names primitives where it means the semantic tokens is a doc imprecision to
  raise at capability 11's audit. It is not a code change.

**What went wrong.** The throwaway render script, run with `tsx` from the scratchpad, could not
resolve `react-dom` (it needed `NODE_PATH`) and then had no React global under the classic JSX
transform. Headless Chromium will not size a window below 500 px, so the ~400 px measurement ran
inside a 400 px iframe. None of this touched the shipped code.

Full suite on Node 22: 159 files, 2,858 tests green. `tsc` and `eslint` are clean.

## Operator validation

*Planned at ticket-write:* On **`/skills`** in the desktop browser, with a 15-skill test ruleset
deployed: find Fortitude **without reading the labels**, by position alone, from memory. Then
have the levels change (log a session), reload, and find it again the same way. It must be in
exactly the same place. Confirm the `▸ Untrained (n)` row is at the bottom, that expanding it does
not push the pinned header off, and that the meta bars are visibly a different colour from the
activity bars at a glance, without reading the section headings.

**Not deploying a test ruleset** (D-229: never construct a scenario on the operator's live
stack). `tmp/0075/render.tsx` (gitignored) renders the shipped `SkillsPanel` over the 15-skill
fixture with the real `app/tokens.css`. It writes `before.html`, then `after.html` with every
level changed in an order unrelated to the first: the "log a session" step, faked.

**Headless Chromium layout probe (agent, 2026-10-07, WSL).** This opens Untrained, scrolls to the
bottom, and measures:

| Viewport | Horizontal scroll | Tiles clipped or overflowing | Header top, before → after scroll | Totals visible |
|---|---|---|---|---|
| 1280 px | none (scrollWidth = clientWidth) | 0 of 15 | 63 → 63 (scrolled 440 px) | yes |
| 400 px (iframe) | none (385 = 385) | 0 of 15 | 63 → 63 (scrolled 353 px) | yes |

A screenshot at 400 px shows three even columns, with "Mountaineering" and "Oarsmanship" inside
their tiles.

**Operator, desktop browser, `before.html` / `after.html` (15-skill fixture), verified 2026-10-07:
"Looks great! All 4 validation steps are good."** The four checks:
1. Find Fortitude by position alone.
2. Find it in the same place after every level changed.
3. `Untrained (1)` sits at the bottom, and opening it does not push the header off.
4. Meta bars read as a different colour from activity bars at a glance.

The operator also asked for two changes: drop the crest tile at the end of META, and use more
than three columns on a wide window. Both contradict 06 §5.1–5.2 as written, so they were filed
as their own tickets with a recorded decision, not folded into this one.
