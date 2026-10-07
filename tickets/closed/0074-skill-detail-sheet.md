---
id: 74
slug: skill-detail-sheet
title: /skills/:skillId detail sheet
type: feature
priority: high
status: closed
size: m
capability: 11-skills-panel
depends_on: [62, 63, 73]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-07T20:44:12Z
closed: 2026-10-07T21:10:14Z
---

## Description

Clicking any tile opens a sheet over the panel. It is a **route**, not just a component, so
browser back and deep links behave (`06-ui-ux.md` §1.5, §5.5).

Contents, in order:

- **Header** — sigil, skill name, `Level <n>`, a progress bar with `<xp> / <next>`, and the
  line `1,088 XP to 48 · ~9 runs`.
- **One sentence of plain rules** — *"Ground covered. 100 XP per kilometre; half on ground you
  have run before."* Rendered from the registry's rate and multipliers, not written per skill.
- **`RECENT`** — **ten rows, not a history.** Date, units, XP. It answers "is this thing
  moving", it is not for browsing; the Chronicle owns full history.
- **`AHEAD`** — the milestone ladder with tier names and a low-precision estimate
  (`50 Pathfinder ~4 months`). An **estimate, not a target**.
- **`ON THE MAP`** — place-bound milestones with a `→ fly to` that closes the sheet and flies the
  map there. This is the only navigation out of the sheet, and it points at the map.

**`~9 runs to 48` is required, not decorative** (`04-game-design.md` §4.1). A percentage that
moves 1.8% reads as nothing; "nine runs away" reads as a plan. It is computed from **that
skill's own trailing median session**, so it is honest and it improves as you do.

**No charts.** A line going up over time is a stats page, and it invites comparison with your
past self. The bar and the ladder are enough.

Estimates are deliberately shown at low precision — "~3 years" — because a precise date is a
deadline, and a deadline is an obligation this app does not create.

## Acceptance criteria

- [x] `/skills/:skillId` is a route rendered as a sheet over `/skills`; browser back, Esc
      **and** a click on the scrim all dismiss it (no gesture is the only path).
- [x] It works for **every** registry skill, activity and meta, with no per-skill component and
      no special case; an unknown `skillId` renders a graceful not-found rather than crashing.
- [x] The header shows level, `xp / next` and `<n> XP to <L+1>`, all derived from `4L²`.
- [x] `~<n> runs to <L+1>` is computed from that skill's **trailing median session size**, is
      shown for every skill that has at least one session, and is omitted (not zeroed) for a
      skill with none.
- [x] The rules sentence is generated from the registry — changing `xpPerUnit` in YAML changes
      the sentence with no source edit.
- [x] `RECENT` shows at most **ten** ledger-derived rows with a `… n more` affordance that does
      **not** expand into a full history.
- [x] `AHEAD` lists milestone levels with tier names and estimates at low precision (months or
      years, never dates).
- [x] `ON THE MAP` lists place-bound milestones only, and `→ fly to` closes the sheet and centres
      the map on that location.
- [x] The sheet contains **no chart, graph or sparkline**.
- [x] Sum of all XP ever shown in `RECENT` plus older rows equals the level bar's XP — the sheet
      is the ledger rendered (I-15).
- [x] The sheet renders offline from cache.
- [x] *(from 0076)* Vigil's detail sheet renders from the same component as Wayfaring's, with the rules
      sentence generated from `groundMultipliers: null` — it must **not** claim "half on ground
      you have run before".
- [x] *(from 0076)* Vigil's sheet omits the `ON THE MAP` section entirely rather than rendering an empty one,
      and this falls out of having no place-bound milestones, not a skill-id check.

## Notes


**Blocked 2026-10-06 on 0242:** RECENT reads bySkill (GSI3), which AppSync cannot query until its projection carries owner

`RECENT` reads the ledger (T4) via the owner-read path — one row per (activity, skill, reason),
so a single run may contribute two or three rows to one skill. Decide once whether to group them
per activity in the display; if grouped, the grouping must be presentational only and the
underlying rows must still be inspectable, because the sheet is the app's answer to "why do I
have this XP".

A meta skill's sheet has no `ON THE MAP` section for most skills — omit the heading entirely
rather than showing an empty one.

- 2026-10-07 — two criteria were moved here from 0076 (operator decision). They assert Vigil's
  sheet, and 0076 was ready before this sheet existed. Satisfy them with the general mechanism:
  the rules sentence comes from `groundMultipliers`, and `ON THE MAP` is omitted when there are no
  place-bound milestones. Never with a branch on the skill id.

## Resolution

**Shape.** The sheet is a child route of a new `app/skills/layout.tsx` that keeps the panel
mounted under it (`SkillsShell` in `skills-page.tsx`, now a layout component providing the panel's
state through context). `/skills/page.tsx` renders nothing. `/skills/[skillId]/page.tsx` prerenders
every registry id (`generateStaticParams`; the build shows `● /skills/[skillId]`, 10 paths), so a
tile's link is prefetched and the sheet opens offline. I chose this over Next's
parallel/intercepting routes, which the approach note proposed: a layout gives the same result
(deep link = panel + sheet, back = panel) with no `@slot`/`(.)` machinery.

**Files.**
- `lib/skills/detail.ts` (new) is the whole sheet as data, `skillDetail()`, and names no skill.
  - Header from `levelProgress`, as the tile reads it.
  - `~N runs/sessions` uses the panel's own `recentSessions`/`median`, with the noun from
    `logMode`. Omitted (null) with no session.
  - `rulesSentence()` is built from `xpPerUnit`, `unit`, `softCapUnits`, `groundMultipliers` /
    `unitMultipliers` and the rows that feed this one. Wayfaring reads exactly §5.5's sentence and
    Vigil reads `100 XP per kilometre.`
  - `RECENT` is grouped per activity with the reasons kept as `parts`: ten rows, the rest counted.
  - `AHEAD` uses `SKILL_MILESTONES` (04 §4.3, D-290). The cadence is sessions over the trailing
    span (at least 14 days), rounded by `lowPrecision` to "under a month", "~N months" or
    "~N years".
- `app/skills/skill-sheet.tsx` (new) is the one presentational component.
  - Dismissed by Esc, a click on the scrim, a Close button, or back. Body scroll is locked and
    focus moves to the dialog. Not-found renders inside the sheet.
  - `RECENT` rows are `<details>`, so expanding one shows the ledger rows under it. `… n more` is
    plain text.
- `app/skills/skill-sheet-route.tsx` (new) is the container. It dismisses with `router.back()` when
  the panel was on screen first, and `router.replace("/skills")` after a deep link, so dismissing
  never leaves the app. `NO_PLACES` is the one line `0248` replaces.
- `lib/skills/transport.ts` gains `fetchSkillLedger`, the whole of one skill's history via `bySkill`
  (GSI3; queryable since `0242`). `lib/skills/load.ts` gains `loadSkillLedger`: cache first, written
  back, and no read while a replay runs.
- `lib/map-camera.ts` gains `parseAt` and `atHref`. In `components/map/map-shell.tsx`,
  `/?at=<lng>,<lat>` makes the loaded map `flyTo` there, outranking the run-centring default. The
  parameter is then stripped, so a reload does not fly again.
- Docs: **D-290** (one ladder, `ON THE MAP` empty until landmarks exist, `RECENT` grouping, the
  floor-version finding); `06` §5.5's mockup names and bullets amended to match.
- Filed **`0248`** (capability 12): record place-bound milestones. Nothing in the codebase records
  where a level was earned.

**Tests.** `lib/skills/detail.test.ts` (26) covers:
- the header against `4L²`
- median-not-mean and one session per activity
- `~N` shown for every enabled skill and null with no sessions
- the operator's "goes down by one" check
- the sentence for Wayfaring, Vigil, a soft cap and a fed skill, plus a YAML-style `xpPerUnit`
  edit changing it
- the ten-row cap and its count
- I-15 with a cross-version floor
- the ladder, and no dates.

`app/skills/skill-sheet.test.tsx` (9) renders every enabled skill through the one component and
covers: not-found, `… n more` not being a link, Vigil omitting `ON THE MAP`, fly-to appearing only
with places, no chart/canvas/polyline, and no skill id in the sheet's source.
`lib/skills/load.test.ts` (+3) and `lib/map-camera.test.ts` (+2) cover the loader and `?at=`. Full
suite on Node 22: 162 files, 2,909 tests green. `eslint`, `tsc`, the `check-*` scripts and
`next build` are clean (the build after moving the gitignored `tmp/0242/smoke.ts` aside; it fails
`tsc` on its own and CI never sees it).

**What went wrong.**
- **The first model filtered the ledger to the current ruleset version, which broke I-15 on live
  data.** The live Cartography `retained_floor` row is stamped `xpRulesVersion: 2` (the replay that
  wrote it) under a v3 ledger, and it counts: 2,643 + 13,342 = 15,985 displayed. My synthetic
  fixture had put the floor on the current version, so the suite passed while the sheet would
  have shown 2,643 against a 15,985 bar. Now every row of the skill is in the partition, and only
  the session estimate reads the current version. The test now uses the live shape.
- The first interaction probe reported `→ fly to` as a dismiss. The button sat below the sheet's
  scroll fold, so the synthetic click landed on the scrim. That was a probe bug, not a code bug.
- `generateStaticParams` needed a `RuleSet[]` cast: `BUNDLED_RULES` values are typed `unknown`.

**Not proven by me.** I did not drive the real Next router (the app is auth-gated, and I have no
browser session). Back and `router.replace` are structural (the sheet unmounts when the route
leaves `/skills/:id`), and the operator check below covers them. The map's actual `flyTo` was not
exercised in a WebGL browser: `parseAt` is unit-tested, the click handler is probed, and no real
place exists to fly to until `0248`.

## Operator validation

*Planned at ticket-write:* On **`/skills/wayfaring`** in the desktop browser: open it from the panel and read the
line `~N runs to <next level>`. Import one replayed or synthetic activity of your usual distance (manual adapter or through
the queue, D-229), and confirm
the number went **down by roughly one** — if it moved by three or by nothing, the trailing median
is wrong. Check `AHEAD` shows no calendar dates. Press Esc to dismiss; reopen and press the browser
back button, and confirm both land back on `/skills`, not on the map.

**Not done as planned:** importing a synthetic activity into the live stack would write XP that can
never be removed (D-135; the same call `0076` made). Faked instead, two ways:
- **Live ledger, in memory** (`tmp/0074/runs-drop.ts`, gitignored; SkillState + XpLedgerEntry
  scanned 2026-10-07): Wayfaring L15, 285 XP to 16, `~2 runs`. Adding one usual session (the
  trailing median, 208 XP) gives 77 XP to 16 and `~1 run`. **Down by exactly one.**
- `detail.test.ts` asserts the same drop on a ten-session fixture.

**Live I-15 (agent, 2026-10-07):** for every skill with standing, the sheet's ledger total equals
the bar:

| Skill | Bar | Ledger | RECENT | More | Carried |
|---|---|---|---|---|---|
| Cartography | 15,985 | 15,985 | 1,740 | 5 | 13,342 |
| Constitution | 1,584 | 1,584 | 691 | 9 | 0 |
| Might | 80 | 80 | 80 | 0 | 0 |
| Wayfaring | 4,675 | 4,675 | 2,172 | 8 | 0 |

**Headless Chromium probe (agent, 2026-10-07, WSL)** — `tmp/0074/sheet.html` + `drive.mjs`, the
shipped `SkillsPanel` + `SkillSheet` bundled over the live data and driven over CDP:
- Focus moves to the dialog on open.
- Esc → dismiss; scrim click → dismiss; Close → dismiss; a click inside the sheet → stays open.
- `→ fly to` (fixture place) → `fly:-83.1,27.5`, sheet closed.
- Vigil: `100 XP per kilometre.`, no `ON THE MAP`, `AHEAD` with no estimates (no sessions).
- `/skills/no-such` → "NO SUCH SKILL".
- Expanding Wayfaring's top row shows `new ground · 2.6 km +264 / familiar ground · 3.6 km +179`.
- 400 px: no horizontal scroll (400 = 400). Screenshots at 1280 and 400 px read as §5.5's
  wireframe.
- `AHEAD` (Wayfaring, live): `25 Journeyman ~7 months · 50 Adept ~7 years · … 99 Mastery ~53 years`.
  No calendar dates.

**Deployed (agent, 2026-10-07):** Amplify job 328 (commit `84d0f15`) SUCCEED. Signed-out `curl` of
`/skills`, `/skills/wayfaring` and `/skills/no-such` → `307` to `/?next=…`. The new routes sit
behind the same auth gate as before; nothing leaked a signed-out render. The signed-in render is
the operator check below.

**Operator, desktop browser, deployed app (job 328), verified 2026-10-07: "checks are good."** Both checks below passed. Open `/skills`, click a tile and look at the sheet (layout,
legibility, whether the long `AHEAD` estimates read as an estimate rather than a verdict). Press
Esc, reopen it, press browser back. Both should land on `/skills`.
