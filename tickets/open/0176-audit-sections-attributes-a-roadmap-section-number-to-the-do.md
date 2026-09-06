---
id: 176
slug: audit-sections-attributes-a-roadmap-section-number-to-the-do
title: audit --sections attributes a roadmap section number to the doc named beside it
type: bug
priority: med
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-06T15:57:14Z
---

## Description

Found by the `05-strava-adapter` drift audit, which it sent to the wrong reading.

`audit <capability> --sections` builds §2's reading list. For each line of each ticket it
collects every design doc named on that line and every `§n.n` on that line, then takes the
**cross product** — every section is attributed to every doc on the line.

`citedSections()`, `tickets.mjs`:

```js
const docs = [...line.matchAll(/(?<!\d)(\d\d-[a-z0-9-]+\.md)/g)] ...
const secs = [...line.matchAll(/§\s*[\d]+(?:\.[\d]+)*/g)] ...
for (const d of docs) { for (const sec of secs) cites.get(d).add(sec) }
```

One line in `0036` reads:

> *"**the rebuild drill depends on it** (`02-data-model.md` §8.3 step 2, roadmap §4.3)"*

`docs` finds `02-data-model.md`. `secs` finds `§8.3` **and `§4.3`**. "roadmap" is prose, not
`09-roadmap.md`, so it never becomes a second doc to hang `§4.3` on — and `§4.3` is attributed to
the only doc on the line.

The audit's reading list therefore told me to re-read **`02-data-model.md` §4.3, "The write
path"** — the XP ledger — as a design section governing the Strava adapter. It governs nothing of
the kind. I read it before working out why it was there.

**Why this matters more than a stray row.** §2 is the half of the audit no script can do, and its
whole value is that the reading list is trustworthy enough to follow without re-deriving it — that
is the tax this tooling exists to remove. A list that silently includes sections nobody cited
spends the auditor's attention on the wrong pages, and worse, it is invisible: a wrong row looks
exactly like a right one. The failure is quiet in the direction that matters.

The inverse error is possible too and is worse: a line naming two docs and one section attributes
that section to **both**, so a genuine citation can be diluted by a neighbour.

## Acceptance criteria

- [ ] A section number is attributed only to the doc it actually follows, not to every doc on the
      line. The intended reading of ``` `02-data-model.md` §8.3 step 2, roadmap §4.3 ``` is
      `02-data-model.md` → `§8.3` only.
- [ ] `audit 05-strava-adapter --sections` no longer lists `02-data-model.md §4.3`, and still
      lists `§1.1`, `§8` and `§8.3`.
- [ ] A line naming two design docs attributes each `§` to the nearer preceding doc rather than to
      both.
- [ ] A `§` with no doc before it on the line is dropped rather than attached to a later doc.
- [ ] `node --test .claude/skills/tickets/scripts/tickets.test.mjs` passes, with a case covering
      the `0036` line verbatim.

## Steps to reproduce

```
node .claude/skills/tickets/scripts/tickets.mjs audit 05-strava-adapter --sections
```

Lists `docs/02-data-model.md  §1.1, §4.3, §8, §8.3`. Then:

```
grep -rn "§4\.3" tickets/closed/003*.md tickets/closed/01*.md
```

One hit, and it is `roadmap §4.3`.

## Expected vs actual

**Expected:** the reading list contains the sections the tickets cite.

**Actual:** it contains the cross product of docs and sections per line, so a section number
belonging to a doc named only in prose is attributed to whichever design doc shares its line.

## Notes

Filed by the `05-strava-adapter` audit, 2026-09-06. Not counted as one of that audit's four
divergences — it is a defect in the audit tooling (capability `01`), not a place capability `05`'s
implementation differs from its design.

Sits beside `0161`, which is the other "the audit's own instrument is wrong" ticket. Neither is
urgent; both cost real session time in exactly the sessions that can least afford it, because an
audit runs at a capability boundary when context is already long.

The fix is a scan rather than two independent regexes — walk the line once, remember the most
recent doc seen, attach each `§` to it. That also fixes the two-doc case for free.

## Operator validation

None — a CLI subcommand with no user-visible surface. Verified by the agent by re-running
`audit --sections` for `05-strava-adapter` and at least one capability whose tickets cite two docs
on one line, and by the new script test.
