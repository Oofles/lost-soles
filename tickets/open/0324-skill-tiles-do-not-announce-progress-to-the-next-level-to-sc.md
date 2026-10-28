---
id: 324
slug: skill-tiles-do-not-announce-progress-to-the-next-level-to-sc
title: Skill tiles do not announce progress to the next level to screen readers (06 §9.4)
type: bug
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-28T02:22:22Z
started: 2026-10-28T03:22:38Z
---

## Description

`06-ui-ux.md` §9.4 (l. 1803): skill tiles announce *"Wayfaring, level 47, 88 percent to 48."* What
ships is `"${name}, level ${level}, ${kind} skill"` in `app/skills/skills-panel.tsx:57`, and the same
string in the home quick-view (`lib/plinth/model.ts:132`). The tile draws a progress bar from
`tile.fraction`, and the label never speaks it, so a screen-reader user gets less than a sighted one.

Ticket `0112` graded §9.4 in this capability and did not catch it. Found by the capability 18 drift
audit (§2, `06` §9.4), 2026-10-27.

## Acceptance criteria

- [x] The `/skills` tile label and the quick-view row label both include progress to the next level
      in §9.4's form (`…, level 47, 88 percent to 48`). The string is built in one place, so the two
      surfaces cannot disagree.
- [x] At the level ceiling, where no next level exists, the label says so rather than
      "100 percent to 100". Mirror whatever the tile shows there.
- [x] Whether to keep `activity skill` / `meta skill` in the label is decided and the §9.4 example
      matches the shipped string exactly.
- [x] Tests cover a mid-level tile, a level-1 tile with 0 XP, and a ceiling tile.
- [ ] (operator) NVDA on the desktop browser reads the `/skills` tiles and the home quick-view rows naturally.

## Steps to reproduce

1. Open `/skills` on the desktop browser with NVDA running.
2. Tab onto the Wayfaring tile.

## Expected vs actual

**Expected:** "Wayfaring, level 29, NN percent to 30" (06 §9.4).

**Actual:** "Wayfaring, level 29, activity skill", read from `skills-panel.tsx:57`.

## Notes

Percent is rounded from the same `fraction` the bar uses, so speech and bar agree. The quick-view's
comment at `model.ts:70` says "Level and progress only — never XP"; a percent is progress, not XP,
so it is within that rule.

## Operator validation

(operator) With NVDA on the desktop browser, Tab across `/skills` and the home quick-view and judge
whether the announcement reads naturally.

D-123 trigger checked? none.

## Resolution

**What ships.** Both surfaces now announce
`Wayfaring, level 47, 88 percent to 48, activity skill`, and at the curve's cap
`Wayfaring, level 99, maximum level, activity skill`.

**One place.** `skillLabel()` in `lib/skills/panel.ts` builds the string, and `skillsPanel()` stores
it on every `SkillTile` as `label`. The `/skills` tile (`app/skills/skills-panel.tsx`) uses
`aria-label={tile.label}`. The quick-view (`lib/plinth/model.ts` `quickView()`) copies `t.label`
into `QuickRow.label`. The two surfaces read one field and cannot disagree. The old test checked a
re-typed template. `model.test.ts` now asserts `row.label === tile.label`.

**Choices made (all inside the criteria; none needed a decision):**
- **The kind stays, last.** Ticket `0077`'s criterion "the activity/meta distinction is announced
  to assistive technology" is met by this label. Its Resolution notes that an Untrained tile sits
  outside the `ACTIVITY`/`META` regions. If the kind were dropped, those tiles would tell a screen
  reader nothing about the kind, which is a regression of a closed criterion. It goes after the
  progress so that "level 47, 88 percent to 48" reads as one phrase. The quick-view rule ("Level and
  progress only — never XP", `model.ts:70`) still holds: the label has a level, a percent and a kind,
  and no XP figure.
- **Percent is floored, not rounded,** from the same `fraction` the bar draws (clamped to 0..1).
  With rounding, a skill one XP short of 48 would say "100 percent to 48" while it is still 47.
  Flooring means the label says 100 only for a stray fraction, never for a real one.
- **At the cap: "maximum level".** There the tile is a full bar and nothing else. The panel header
  says `of <ceiling>` and the sheet drops its `/ next` figure. The label states the fact instead of
  "100 percent to 100". It uses `level >= rules.curve.maxLevel`, the same test as
  `levelProgress()`, and does not hard-code 99.

**Design doc.** `06-ui-ux.md` §9.4 "Skill tiles announce…" sentence only (other §9.4 lines belong to
`0326` in this wave). The example is now the shipped string word for word. The sentence also names
the ceiling form and the floor, and says why the kind is in the label.

**Files touched**
- `lib/skills/panel.ts`: `skillLabel()`; `SkillTile.label`.
- `app/skills/skills-panel.tsx`: tile `aria-label` reads `tile.label`.
- `lib/plinth/model.ts`: `QuickRow.label` reads `t.label`; doc comment.
- `lib/skills/panel.test.ts`: mid-level (47 → "88 percent to 48"), level 1 at 0 XP ("0 percent to
  2"), ceiling ("maximum level", no "percent"), one-XP-short ("99 percent", never 100), and clamping.
  Runs against every bundled ruleset.
- `lib/plinth/model.test.ts`: quick-view label is the tile's label.
- `app/skills/contrast.test.tsx`: the 0077 kind assertion accepts the new progress clause.
- `components/plinth/plinth.test.tsx`: fixture labels updated to the new form.
- `docs/06-ui-ux.md`: §9.4, one sentence.

