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

- [ ] `/skills` exists as a route; back returns to `/`; a deep link opens it directly.
- [ ] Every enabled skill in `xp-rules-v1.yaml` appears exactly once, with **no per-skill
      component** and no hardcoded skill list.
- [ ] Tiles render sigil, name, level and a progress bar showing progress toward the next level,
      computed from `4L²` (0063).
- [ ] The header shows `TOTAL LEVEL` and `Total XP` and is **pinned** — it does not scroll away
      at any skill count.
- [ ] Total Level equals `Σ level(skill)` over the enabled registry including meta skills, and
      matches the value the home plinth shows.
- [ ] Total XP is displayed under Total Level and is the value that increases every session.
- [ ] Sections render as `ACTIVITY`, then `META`, then the collapsed `Untrained` group.
- [ ] The crest tile appears at the end of `META`, shows Total Level, and is inert on click.
- [ ] The `NEXT` card shows exactly one line and never becomes a list.
- [ ] Levels use tabular figures so a level change does not reflow the tile.
- [ ] Nothing on the screen is a target, a goal, a "train this" prompt, a neglected-skill warning
      or a decay indicator (D-013, H2).
- [ ] The panel renders from cache offline with no spinner and no empty state.
- [ ] With the fixture ruleset at ceiling, the header reads **693**.

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

## Operator validation

On **`/skills`** in the desktop browser: read the TOTAL LEVEL
figure **in under two seconds without scrolling**. Scroll the grid to the bottom and confirm the
header stays put. Compare the Total Level shown here against the number on the home plinth —
they must be identical, not merely close. Check that a skill you have never trained is still
findable on this screen, and that no tile anywhere says what you should do next.
