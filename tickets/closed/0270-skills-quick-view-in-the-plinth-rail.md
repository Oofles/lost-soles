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

- [x] Below the rail's existing content (after the interim Sync line), the rail shows one row per
      trained skill: sigil (`rules/sigils.json`, D-283), name, level, and a thin bar of progress to
      the next level. No XP figure.
- [x] Rows are grouped under `ACTIVITY` and `META` headings, in registry order. An untrained skill has
      no row, and a group with no trained skills has no heading.
- [x] Bars reuse `/skills`'s fills: `--progress-activity` (`--gold-700` in light, D-291) for activity
      and the meta fill for meta, at 3:1 or better against the rail (`check-contrast.mjs` covers the
      pair). The rail stays opaque (D-148).
- [x] A row is a link to `/skills/<id>`, opening the existing skill sheet. Esc, the scrim, Close and
      Back return to `/`. Rows are at least 32px tall (D-313 targets), and each row's accessible name
      states the skill, its level, and its kind.
- [x] Data comes from the same `SkillState` read the plinth already makes for Total Level
      (`lib/plinth/load.ts`). No second query, and no timer (D-013).
- [x] Adding a skill row to the ruleset adds a quick-view row with no code change: no list of skill ids
      in the component (D-031). A test asserts this with a synthetic extra row.
- [x] Nothing on the list asks for anything (D-013): no "untrained" nudge, no "next up", no streak, no
      relative age.
- [x] When the list is taller than the rail's free space, the list scrolls inside the rail. The glance
      numbers and the three destinations never scroll away.
- [x] Below 1024px, where the plinth is a bottom card capped at 55% height (D-313), the quick-view is
      omitted. It must not break that layout (D-251).
- [x] When `/chronicle` (`0088`) is open in the rail's column, it replaces the quick-view along with
      the rest of the rail's contents.

## Notes

- Operator request at `0086`'s validation, 2026-10-15. Filed rather than widened into `0086` (D-152).
- **Omitting it below 1024px is the orchestrator's call, not the operator's.** The bottom card is
  already capped at 55% of the window and is only required not to break. Overturn it if wanted.
- `06` §2.2 gains the quick-view in the rail's content order, with a pointer to this ticket.
- Touches the plinth component that `0087` (home screen states) also edits. If both run in one wave,
  expect a mechanical merge.

## Resolution

**What was built.** A fifth block in the plinth rail, below the Sync and reconnect lines and a
`--line` rule: `ACTIVITY` and `META` headings, each over one 32px row per trained skill — sigil
(18px, `rules/sigils.json` via `components/sigil.tsx`), name, a 3px bar to the next level, the level
in the serif numeral style. No XP figure. Each row is a `Link` to `/skills/<id>` whose accessible
name is the `/skills` tile's own wording (`Might, level 42, activity skill`).

**Files touched.**
- `lib/plinth/model.ts` — `PlinthModel.quickView`, `QuickRow`, `QuickView`, and `quickView(panel)`,
  which maps `skillsPanel`'s trained `activity`/`meta` groups. Built from the `panel` `plinthModel`
  already computes for Total Level, so it is the same `SkillState` read (`lib/plinth/load.ts`): no
  second query, no timer. `null` until the cache answers, so there is never a list of level 1s.
- `components/plinth/plinth.tsx` — `QuickView`/`QuickGroup`; `Bar` gained `height` and `tint` so
  the rail's bars use `/skills`' fills (`--progress-activity`, `--progress-meta`) as fills only.
  CSS: `.plinth-skills` is `display: none` below 1024px; at ≥1024px the rail becomes a flex column,
  every row above is `flex: none`, and only `.plinth-skills` shrinks (`min-height: 0`) and scrolls.
  The rail's own `overflow-y: auto` stays as the fallback §2.2 already specified. Rows take an inset
  focus ring so the scroll box does not clip it.
- `lib/skills/sheet-origin.ts` (+ test) — a module-level mark set by a row's click. Without it the
  sheet, opened from `/`, would dismiss with `router.replace("/skills")` (its deep-link branch),
  because `SkillsShell` only knew the panel as an in-app origin.
- `app/skills/skills-page.tsx` — `openedFromPanel` is also true when the mark matches the current
  path, so Esc, the scrim and Close run `router.back()` → `/`. Back is the browser's own. A stale
  mark is dropped on any other path; a reload clears it (a reloaded sheet is a deep link).
- `scripts/check-contrast.mjs` — comment only: `--surface-raised` is now also the rail's ground for
  the bars. The pairs already existed: light 3.95:1 (activity) / 4.49:1 (meta), dark 9.77:1 / 5.79:1.
- `docs/06-ui-ux.md` §2.2 — wireframe shows the quick-view; row 3's "space below stays empty"
  amended; new table row 11; the focus order gains the quick-view's rows after Sync.
- Tests: `lib/plinth/model.test.ts` (membership, grouping, registry order, no XP, null before the
  cache, and the D-031 synthetic extra registry row), `components/plinth/plinth.test.tsx` (FULL now
  carries both groups so every D-013 refusal also runs over the list; placement inside the aside,
  headings, hrefs, accessible names, fills, empty groups, CSS for 32px rows / mobile omission /
  scroll; no skill id in `plinth.tsx`).

**Decisions made (proposed to the orchestrator, not recorded).**
- The quick-view row is one line: sigil · name (fixed 7.5rem column, so the bars align) · bar ·
  level, rather than a bar under the name. The ticket's "one line" read literally.
- How the sheet learns it came from `/`: a module-level mark, not a query string (the sheet route is
  prerendered, D-282) and not `history.state` (Next's router owns it).
- Accepted cost: the sheet is the `/skills/<id>` route, so the `/skills` panel renders behind its
  scrim and leaving `/` unmounts the map, exactly as the existing `SKILLS` button already does. The
  map remounting on return is the cost D-322 avoided for the Chronicle; intercepting `/skills/<id>`
  inside `app/(home)` would avoid it here too but is beyond this ticket.
- `/chronicle` replacing the quick-view is structural: the list is inside `<Plinth>`, which
  `HomeScreen` does not render on `/chronicle` (D-322; `chronicle-panel.test.tsx` already asserts
  the plinth's absence there).

**Checks run.** All amplify.yml build-phase guards, `npm run typecheck`, `npm run lint`,
`npx vitest run`, `npm run build` — all green in the worktree.

## Operator validation

Desktop browser, on `/`. Does the quick-view read as a calm glance under the plinth rather than a
second skills page? Are the bars thin enough, and does the level read beside each name?

**Decisions recorded at merge (orchestrator):** D-330 (sheet dismisses to `/`). D-NEW-b (row layout) is recorded in this Resolution only: a styling choice, not an architectural one.
