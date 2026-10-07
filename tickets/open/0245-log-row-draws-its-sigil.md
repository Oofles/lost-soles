---
id: 245
slug: log-row-draws-its-sigil
title: The /log row draws its skill's sigil, as 06 §6.3–6.4 require
type: bug
priority: low
status: open
size: s
capability: 10-add-workout
depends_on: [72]
blocked_by: []
source: agent
created: 2026-10-07T16:21:25Z
---

## Description

Filed by capability `10-add-workout`'s drift audit (D-288) as its one code-was-wrong divergence.

`06` §6.4's row anatomy opens with **"Sigil + skill name + unit label"**, and the §6.3 wireframe
draws a sigil (`✥`, `✜`, `⧗`, `◈`) at the head of every row. The shipped row (`app/log/log-row.tsx`)
draws the skill name and the unit label, but no sigil.

The miss came from a handoff. `0068` and `0071` both deferred the sigil to `0072`'s icon set
(`0071`: *"Not here. Sigils are `0072`'s icon set."*). `0073` built that set as data
(`rules/sigils.json`, `components/sigil.tsx`, D-283), and `0072` proved a new skill's sigil reaches
`/skills`. Nobody went back to `/log`.

The fix is one element. `<Sigil skillId={row.skillId} />` reads the data-keyed map and draws the
fallback seal for a skill with no entry, so the row still names no skill (I-25) and a new workout
type is still a YAML row plus one JSON sigil entry (D-031).

## Acceptance criteria

- [ ] Every `/log` row, idle and confirmed, draws its skill's sigil from `components/sigil.tsx`
      before the skill name, as on `/skills`. The sigil stays decorative (`aria-hidden`), so the
      row's accessible name is unchanged.
- [ ] A skill with no entry in `rules/sigils.json` draws the fallback seal on `/log`, asserted by
      a test.
- [ ] `src/rules/no-skill-names.test.ts` (I-25) and `app/new-workout-type.test.tsx` (I-24) still
      pass, unweakened. The new-type world's `/log` row draws the fixture's sigil.

## Steps to reproduce

1. Open `/log` in the desktop browser.
2. Look at the head of any row.

## Expected vs actual

**Expected:** the skill's sigil, then the skill name, then the plain-English unit label
(`06` §6.3–6.4).

**Actual:** the skill name and the unit label, with no sigil.

## Notes

- Use `Sigil`, not a new component. Pick its size to sit on the name's baseline; `/skills` tiles
  use the default 28, and a row header probably wants about 20.
- §6.3's confirmed-row sketch (`✥  MIGHT   30 pushups`) keeps the sigil, so the confirmed state
  draws it too.

## Operator validation

On `/log` in the desktop browser: each row's sigil reads as the same mark the skill wears on
`/skills`, and it does not crowd the name or the controls. This is perceptual only; the tests
prove which sigil is drawn.
