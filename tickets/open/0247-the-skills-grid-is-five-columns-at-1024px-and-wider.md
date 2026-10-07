---
id: 247
slug: the-skills-grid-is-five-columns-at-1024px-and-wider
title: The skills grid is five columns at 1024px and wider
type: feature
priority: med
status: open
size: s
capability: 11-skills-panel
depends_on: []
blocked_by: []
source: operator
created: 2026-10-07T17:11:22Z
---

## Description

On a full-screen desktop window the skills grid was three tiles wide inside a 36rem column, with
most of the screen empty either side. The operator asked for more columns (**D-289**): **five at
≥1024px, three below**, as two fixed layouts. Never `auto-fill`, because a grid that reflows on
every resize makes a tile's position depend on the window, and that position is the muscle
memory §5.1 exists for.

## Acceptance criteria

- [x] Below 1024px every section's grid is three columns; at and above 1024px, five. There is
      no third layout and no `auto-fill`/`auto-fit`.
- [x] The panel widens at the breakpoint so five tiles are not squeezed into the phone column.
- [x] No horizontal scroll and no clipped tile with the 15-skill fixture at 400px, 1023px,
      1024px and 1280px.
- [x] `06` §5.2 states the two layouts, citing D-289.

## Notes

1024px is `06` §2's existing desktop breakpoint. Inline styles cannot hold a media query, so the
column count lives in a `<style>` block, as `app/log/log-row.tsx` does for reduced motion.

## Resolution

- **`app/skills/skills-panel.tsx`.**
  - The column count and the panel width moved out of inline styles into one `<style>` block
    (`LAYOUT_CSS`):
    - `.skills-main` is `max-width: 36rem`, or 60rem at ≥1024px.
    - `.skills-grid` is `repeat(3, minmax(0, 1fr))`, or `repeat(5, …)` at ≥1024px.
  - All three grids carry the class: ACTIVITY, META and Untrained.
  - Inline styles cannot hold a media query. The `<style>` block follows
    `app/log/log-row.tsx`'s pattern.
- **`app/skills/skills-panel.test.tsx`.** A new test checks that exactly two column counts
  exist, in order 3 then 5, with the 5 inside `@media (min-width: 1024px)`; that there is no
  `auto-fill` or `auto-fit`; and that no inline `grid-template-columns` overrides the class.
  `0075`'s three-grid test now asserts the class instead of the inline value.
- **Docs.** **D-289** is recorded. `06` §5.2's tile line states the two layouts and why
  `auto-fill` is refused. The §9 text-scaling note says "three (or five)".
- **Not done.** §9's text-scaling reflow (two columns at ≥1.3×, one at ≥1.8×) was not built
  before this ticket and is not built here. It is out of scope, and noted for capability 11's
  audit.

## Operator validation

*Planned at ticket-write:* On `/skills` in the desktop browser, full screen: five tiles across, without the wide empty
margins. Narrow the window below 1024px and the grid is three across.

**Headless Chromium probe (agent, 2026-10-07, WSL).** The probe is `tmp/0075/render.tsx`,
which is gitignored: the shipped `SkillsPanel` over `0075`'s 15-skill fixture with the real
`app/tokens.css`. Viewports at exactly 400px and 1023px/1024px were measured inside an iframe,
because headless Chromium will not size a window below 500px.

| Viewport | Columns | Horizontal scroll | Clipped tiles | Crest tile | Header top before → after scroll |
|---|---|---|---|---|---|
| 400 px | 3 | none | 0 / 15 | absent | 63 → 63 |
| 1023 px | 3 | none | 0 / 15 | absent | 63 → 63 |
| 1024 px | 5 | none | 0 / 15 | absent | 63 → 63 |
| 1280 px | 5 | none | 0 / 15 | absent | 63 → 63 |

A screenshot at 1440px shows five even columns in a 60rem panel: ACTIVITY in three rows, META
as Cartography, Constitution and the fixture's third meta skill, and no `TOTAL` tile.

**Operator, desktop browser, regenerated `before.html` (15-skill fixture), verified 2026-10-07:
"Both checks are good."** Five across at full screen without the wide margins, and META ends
with its last skill, with no TOTAL tile.
