---
id: 270
slug: skills-quick-view-in-the-plinth-rail
title: Skills quick-view in the plinth rail — trained skills as thin level bars
type: feature
priority: med
status: open
size: s
capability: 13-home-plinth-and-chronicle
depends_on: [86]
blocked_by: []
source: operator
created: 2026-10-15T17:42:12Z
started: 2026-10-15T20:13:38Z
---

## Description

The plinth rail (`0086`, D-313) uses about the top fifth of its height, and the rest is empty. At
`0086`'s validation the operator asked for the space underneath to show *"the rest of the skills in a
quick-view type of list and my current level/progress. Not like the boxes I have within the skills
page, but as a thinner set of experience bars with level."*

This is a glance, not a second skills panel. Each row is one line: sigil, skill name, level, and a
thin progress bar to the next level. The `/skills` tiles, the `NEXT` line, XP figures and recent
sessions stay on `/skills` and in the skill sheet.

The operator settled the open choices on 2026-10-15:

- **Which skills: trained only.** A skill with any XP gets a row. Untrained skills are left off, so the
  rail never shows rows of empty bars. Rows follow registry order, the same order as `/skills` (§5.1's
  fixed positions).
- **Grouping: ACTIVITY, then META**, under two small headings, the same split as `/skills`.
- **A click on a row opens that skill's detail sheet**, the same dialog `/skills/<id>` opens (`0074`).
- **Row text: the level only**, no XP figure. Exact XP lives in the sheet.

## Acceptance criteria

- [ ] Below the rail's existing content (after the interim Sync line), the rail shows one row per
      trained skill: sigil (`rules/sigils.json`, D-283), name, level, and a thin bar of progress to
      the next level. No XP figure.
- [ ] Rows are grouped under `ACTIVITY` and `META` headings, in registry order. An untrained skill has
      no row, and a group with no trained skills has no heading.
- [ ] Bars reuse `/skills`'s fills: `--progress-activity` (`--gold-700` in light, D-291) for activity
      and the meta fill for meta, at 3:1 or better against the rail (`check-contrast.mjs` covers the
      pair). The rail stays opaque (D-148).
- [ ] A row is a link to `/skills/<id>`, opening the existing skill sheet. Esc, the scrim, Close and
      Back return to `/`. Rows are at least 32px tall (D-313 targets), and each row's accessible name
      states the skill, its level, and its kind.
- [ ] Data comes from the same `SkillState` read the plinth already makes for Total Level
      (`lib/plinth/load.ts`). No second query, and no timer (D-013).
- [ ] Adding a skill row to the ruleset adds a quick-view row with no code change: no list of skill ids
      in the component (D-031). A test asserts this with a synthetic extra row.
- [ ] Nothing on the list asks for anything (D-013): no "untrained" nudge, no "next up", no streak, no
      relative age.
- [ ] When the list is taller than the rail's free space, the list scrolls inside the rail. The glance
      numbers and the three destinations never scroll away.
- [ ] Below 1024px, where the plinth is a bottom card capped at 55% height (D-313), the quick-view is
      omitted. It must not break that layout (D-251).
- [ ] When `/chronicle` (`0088`) is open in the rail's column, it replaces the quick-view along with
      the rest of the rail's contents.

## Notes

- Operator request at `0086`'s validation, 2026-10-15. Filed rather than widened into `0086` (D-152).
- **Omitting it below 1024px is the orchestrator's call, not the operator's.** The bottom card is
  already capped at 55% of the window and is only required not to break. Overturn it if wanted.
- `06` §2.2 gains the quick-view in the rail's content order, with a pointer to this ticket.
- Touches the plinth component that `0087` (home screen states) also edits. If both run in one wave,
  expect a mechanical merge.

## Operator validation

Desktop browser, on `/`. Does the quick-view read as a calm glance under the plinth rather than a
second skills page? Are the bars thin enough, and does the level read beside each name?
