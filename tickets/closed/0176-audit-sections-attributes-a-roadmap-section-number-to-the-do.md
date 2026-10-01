---
id: 176
slug: audit-sections-attributes-a-roadmap-section-number-to-the-do
title: audit --sections attributes a roadmap section number to the doc named beside it
type: bug
priority: med
status: closed
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-06T15:57:14Z
started: 2026-10-01T02:13:39Z
closed: 2026-10-01T02:16:24Z
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

- [x] A section number is attributed only to the doc it actually follows, not to every doc on the
      line. The intended reading of ``` `02-data-model.md` §8.3 step 2, roadmap §4.3 ``` is
      `02-data-model.md` → `§8.3` only.
- [x] `audit 05-strava-adapter --sections` no longer lists `02-data-model.md §4.3`, and still
      lists `§1.1`, `§8` and `§8.3`.
- [x] A line naming two design docs attributes each `§` to the nearer preceding doc rather than to
      both.
- [x] A `§` with no doc before it on the line is dropped rather than attached to a later doc.
- [x] `node --test .claude/skills/tickets/scripts/tickets.test.mjs` passes, with a case covering
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

## Resolution

**Files touched** — `.claude/skills/tickets/scripts/tickets.mjs` (`citedSections()` and its doc
comment, new `CITE_TOKEN` / `CITE_CONNECTORS`); `.claude/skills/tickets/scripts/tickets.test.mjs`
(four `0176:` cases in the `--sections` suite, the first using the `0036` line verbatim).

**What changed.** The docs × sections cross product is gone. Each line is scanned once for
filenames and `§` refs, in order. A filename sets the current doc: a design doc if it is a real
`docs/NN-name.md`, otherwise *no* doc, so `AUDIT.md`, `R3-geospatial.md` or a ticket filename
ends the run. A `§` attaches to the current doc, and is dropped when there is none (criterion 4).

**What went wrong first, and the rule that replaced it.** The ticket's suggested fix ("remember the
most recent doc, attach each § to it") does not satisfy its own first criterion, because
`02-data-model.md` *is* the most recent doc when `roadmap §4.3` arrives. So something has to break
the run. My first version broke it on **any** non-connector word between the doc and the `§`.
Diffing `--sections` for all 20 capabilities before and after showed that dropped many genuine
citations, where a description sits between sections: `§9 accessibility requirements and run the
§9.6`, `T1, §4.4 step 2, §4.5`, and the "Files amended" table rows (`§1.2 ceiling, §1.3 schema
block`). The shipped rule only looks at **the word directly before the `§`**, ignoring backticks,
emphasis and quotes. If that word is the doc itself or a connector (`and or to through plus also
vs the a at in see with`), the `§` is the doc's. Any other word is the `§`'s own referent
(`roadmap §4.3`, `R6 §2.1`, `contract §5`, `` `02` §4 ``), so the `§` is dropped. Punctuation
before the `§` (`,`, `—`, `(`, `–`) keeps the run.

**The trade-off.** When the word before a `§` is unexpected, the `§` is dropped, never
misattributed. That is the safer direction for a reading list the auditor follows without
re-deriving it. I listed every `§` the final rule drops for a word, across all tickets: 15. Every
one is correct (`roadmap`, `R6`, `while`, `since`, `tick`) or prose naming a section as a
*correction* rather than a citation (`0174`'s "it is §2.6"). A real citation is never lost
outright by this, because the same sections are cited properly elsewhere in those tickets.

**Effect on other capabilities.** The before/after diff changed the reading list for 17 of 20
capabilities. Almost all of the removals are `§`s with no design doc before them on the line,
which the old code hung on whatever doc shared the line. For example, `00-vision.md` lost `§9.6`
(`0117`: "And §9.6, which is … `00-vision.md` §5"), and `09-roadmap.md` lost `§2`/`§4` in `08`.
No decision record: this is a parser bug fix inside the existing D-153 audit design.

## Operator validation

None for the operator: a CLI subcommand with no user-visible surface. The agent verified it on WSL2,
2026-09-30:

- `node --test .claude/skills/tickets/scripts/tickets.test.mjs`: 187/187 pass, including four new
  `0176:` cases (the verbatim `0036` line, two docs on one line, `§` with no doc before it, and a
  description between sections).
- `tickets.mjs audit 05-strava-adapter --sections` now prints
  `docs/02-data-model.md  §1.1, §8, §8.3`. `§4.3` is gone and §1.1, §8 and §8.3 remain. The only
  other change for `05` is that `03-integrations.md §5` no longer appears; the old cross product
  invented it from a line where `§5` belongs to `contracts/ingestion-contract.md`.
- I ran `--sections` for all 20 capabilities before and after the change and read the diff, plus a
  per-line listing of every `§` the new rule drops for a word (15 drops, reviewed individually above).
  Two-doc lines were checked on `07-fog-projection-and-cells` (`02` and `05` share lines in `0046`)
  and `17-tickets-ui` (`06-ui-ux.md` and `07-ticketsmith.md` sharing `§5.2`, which now goes to `07`
  only).
