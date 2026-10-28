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

- [ ] The `/skills` tile label and the quick-view row label both include progress to the next level
      in §9.4's form (`…, level 47, 88 percent to 48`). The string is built in one place, so the two
      surfaces cannot disagree.
- [ ] At the level ceiling, where no next level exists, the label says so rather than
      "100 percent to 100". Mirror whatever the tile shows there.
- [ ] Whether to keep `activity skill` / `meta skill` in the label is decided and the §9.4 example
      matches the shipped string exactly.
- [ ] Tests cover a mid-level tile, a level-1 tile with 0 XP, and a ceiling tile.
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
