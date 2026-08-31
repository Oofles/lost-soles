---
id: 72
slug: new-workout-type-is-a-yaml-row-only
title: A new workout type arrives as a YAML row only — proven by a zero-diff test
type: feature
priority: high
status: open
size: m
capability: 10-add-workout
depends_on: [68, 71]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The promise of D-031, D-061 and D-132, made mechanical. **Adding a workout type must be:**

1. a row in `rules/xp-rules-v1.yaml` (`id`, `name`, `kind: activity`, `logMode`, `unit`,
   `match`, `xpPerUnit`, step, `feeds: constitution`),
2. one sigil added to the icon set,
3. ship.

`/log` gains a row at the bottom. `/skills` gains a tile in `ACTIVITY`. **The home screen
changes by zero pixels.** No component is written, no layout is revisited, no screen is
redesigned, no ticket is filed.

This ticket is the **permanent CI proof** of that, not a manual promise. Following
`02-data-model.md` §3.8 check 5 and invariant **I-24**, it adds a regression test that seeds the
registry, adds **only** a new row — a **Pull-ups** row, chosen because nothing in the codebase
has ever heard of it — and asserts the TypeScript diff is empty while the row appears everywhere
it should.

**I-24 is the property most likely to rot quietly, one convenient `if` at a time.** That is why
the test is wired into CI permanently rather than run once at acceptance.

## Acceptance criteria

- [ ] A CI test seeds `xp-rules-v1.yaml`, appends **only** a `pullup` skill row plus its sigil,
      re-seeds T5, and asserts:
  - [ ] the `src/` TypeScript diff required is **empty** — no file under `src/` was modified;
  - [ ] `/log` renders a new Pull-ups row, in `displayOrder` position, with the registry's step
        and plain-English unit label;
  - [ ] `/skills` renders a new tile in the `ACTIVITY` section with no layout change and no new
        section;
  - [ ] the home screen renders **byte-identically** (snapshot comparison) before and after;
  - [ ] logging that row scores into the new skill at the registry's rate and feeds
        Constitution;
  - [ ] `selectActivitySkills` returns the new skill for its measure and does not disturb any
        existing skill's selection.
- [ ] The same test also runs the **D-132 Vigil clauses** (I-24's (b)/(c)/(d)): a
      `hasTrace: false` run scores into the traceless distance skill at full rate; the same run
      with a trace scores into the traced one; the traceless case writes no `ExploredCell`.
- [ ] The test fails loudly if any `src/` file must change, and the failure message names D-031
      and I-24 so the next person understands what was broken.
- [ ] `grep -rE '"(wayfaring|vigil|might|fortitude|endurance|cartography|constitution|pullup)"'
      src/` returns nothing outside `rules/`, fixtures and tests, and fails the build otherwise
      (I-25).
- [ ] The Pull-ups fixture is scoped to the test and is **not** shipped in the production
      ruleset.
- [ ] The test's registry order assertion proves rows never reorder by frequency, recency or
      level (`06-ui-ux.md` §6.5) — a row that moves is a row you mis-tap.

## Notes

Pull-ups rather than Vigil for the added row: Vigil ships in v1, so it can no longer prove
anything about *adding*. The test needs a skill the codebase has never seen.

If this test ever needs "just one" exception, the exception is the finding — file a ticket, do
not weaken the assertion. The whole reason `match` exists (D-141) is that a schema can look
complete, be internally consistent, and still be missing an entire job; a green zero-diff test is
the only durable evidence that it is not missing another one.

The icon set is the one place a new skill legitimately touches a source file. Keep sigils in a
data-keyed map (`skillId → sigil`) with a documented fallback glyph, so a missing sigil degrades
to a placeholder rather than failing the row — otherwise step 2 becomes a code change in
disguise.

## Operator validation

On the **Pixel 8 Pro**, one thumb: with a hand-edited ruleset containing a Pull-ups row deployed
to a test stack, open `/` and confirm the home screen looks **exactly** as it did — no new
button, no shifted plinth, no reflow. Then open `/log`: Pull-ups must be the last row, with the
same 56dp controls and the same `LOG` at the right edge as every other row, usable one-handed
without a second glance. Then open `/skills` and confirm Pull-ups is simply the next tile in
`ACTIVITY` and no existing tile has moved position.
