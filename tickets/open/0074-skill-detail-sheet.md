---
id: 74
slug: skill-detail-sheet
title: /skills/:skillId detail sheet
type: feature
priority: high
status: open
size: m
capability: 11-skills-panel
depends_on: [62, 63, 73]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-07T20:44:12Z
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

- [ ] `/skills/:skillId` is a route rendered as a sheet over `/skills`; browser back, Esc
      **and** a click on the scrim all dismiss it (no gesture is the only path).
- [ ] It works for **every** registry skill, activity and meta, with no per-skill component and
      no special case; an unknown `skillId` renders a graceful not-found rather than crashing.
- [ ] The header shows level, `xp / next` and `<n> XP to <L+1>`, all derived from `4L²`.
- [ ] `~<n> runs to <L+1>` is computed from that skill's **trailing median session size**, is
      shown for every skill that has at least one session, and is omitted (not zeroed) for a
      skill with none.
- [ ] The rules sentence is generated from the registry — changing `xpPerUnit` in YAML changes
      the sentence with no source edit.
- [ ] `RECENT` shows at most **ten** ledger-derived rows with a `… n more` affordance that does
      **not** expand into a full history.
- [ ] `AHEAD` lists milestone levels with tier names and estimates at low precision (months or
      years, never dates).
- [ ] `ON THE MAP` lists place-bound milestones only, and `→ fly to` closes the sheet and centres
      the map on that location.
- [ ] The sheet contains **no chart, graph or sparkline**.
- [ ] Sum of all XP ever shown in `RECENT` plus older rows equals the level bar's XP — the sheet
      is the ledger rendered (I-15).
- [ ] The sheet renders offline from cache.
- [ ] *(from 0076)* Vigil's detail sheet renders from the same component as Wayfaring's, with the rules
      sentence generated from `groundMultipliers: null` — it must **not** claim "half on ground
      you have run before".
- [ ] *(from 0076)* Vigil's sheet omits the `ON THE MAP` section entirely rather than rendering an empty one,
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

## Operator validation

On **`/skills/wayfaring`** in the desktop browser: open it from the panel and read the
line `~N runs to <next level>`. Import one replayed or synthetic activity of your usual distance (manual adapter or through
the queue, D-229), and confirm
the number went **down by roughly one** — if it moved by three or by nothing, the trailing median
is wrong. Check `AHEAD` shows no calendar dates. Press Esc to dismiss; reopen and press the browser
back button, and confirm both land back on `/skills`, not on the map.
