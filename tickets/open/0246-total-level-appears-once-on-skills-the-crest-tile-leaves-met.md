---
id: 246
slug: total-level-appears-once-on-skills-the-crest-tile-leaves-met
title: Total Level appears once on /skills: the crest tile leaves META
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

`/skills` drew Total Level twice: in the pinned header, and again as the crest tile ending META
(`06` §5.2, RS's corner). With the header pinned (§5.3 rule 4), both copies are always visible. The
operator asked for the header alone (**D-289**). Remove the crest tile. META holds skills and
nothing else.

## Acceptance criteria

- [x] No crest tile renders: META's grid has exactly one item per trained meta skill.
- [x] Total Level's figure appears exactly once on the page, in the pinned header, which keeps
      its `✦` mark.
- [x] `06` §5.1 and §5.2 say so, citing D-289.

## Notes

Requested while the operator validated `0075` on the 15-skill preview. The `Crest` component and
the `crest` prop on `Section` go with it. `CREST` stays in `components/sigil.tsx`, because the
header draws it.

## Resolution

- **`app/skills/skills-panel.tsx`.** Deleted the `Crest` component and `Section`'s `crest` prop.
  The header keeps `<Mark paths={CREST} />`, so `CREST` stays in `components/sigil.tsx`.
- **`app/skills/skills-panel.test.tsx`.** The "ends META with the crest" test became "shows
  Total Level once". It checks that there is no `data-crest`, that META has exactly one `<li>` per
  meta skill, and that the Total Level figure appears once on the page. The SVG count dropped
  from `n + 2` to `n + 1`.
- **Docs.** **D-289** is recorded. `06` §5.1's "Total Level lives in the panel, in the corner"
  now says header only, and §5.2's wireframe drops the crest tile. `docs/INDEX.md` was
  regenerated.
- Full suite: 159 files, 2,859 tests green on Node 22. `tsc`, `eslint` and the design-token
  check are clean.

**What went wrong.** ESLint lints `tmp/`, which is gitignored, and failed on an `any` in the
throwaway probe script. I fixed the script, not the lint config.

## Operator validation

*Planned at ticket-write:* On `/skills` in the desktop browser: META ends with its last skill, and Total Level is read
from the header only.

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
