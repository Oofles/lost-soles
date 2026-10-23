---
id: 162
slug: doc-tables-match-ruleset
title: Extend the doc-vs-ruleset assertion from 04 §1.3's example to the prose tables that restate rows
type: chore
priority: med
status: open
size: m
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-09-04T17:05:22Z
started: 2026-10-23T02:20:14Z
---

## Description

**D-193 holds by review today, which is the weakest kind of enforcement and the reason the
failure it describes has now happened twice.** This ticket gives it a check.

`src/rules/doc-schema.test.ts` already does the job for exactly one passage: it asserts that
every row of `04-game-design.md` §1.3's YAML example agrees with `rules/xp-rules-v1.yaml` field
by field, and that the example still passes the real validator. The mechanism works. It covers
one example and no prose.

The capability `04` audit found three tables outside that example restating ruleset values, all
stale, all falsified by changes D-031 promises are free:

| Where | Said | Shipped |
|---|---|---|
| `04-game-design.md` §1.1 | Roving **35 XP/km** | 60, since `0158` |
| `04-game-design.md` §3.2 | no Vigil / Roving / Cadence row | five distance skills exist |
| `02-data-model.md` §3.2 | `unit` is `km \| rep \| second \| cell` | `share` is also in use |

All three were amended by that audit. Nothing stops the fourth.

## Acceptance criteria

- [x] A check parses the ruleset-derived values out of the design docs' **prose tables** — at
      minimum `04` §1.1 and §3.2, and `02` §3.2's attribute vocabularies — and compares them to
      `rules/xp-rules-v1.yaml`. *Amended: compares them to the **newest** `rules/xp-rules-vN.yaml`
      (v3 today), not v1. v2 and v3 shipped after this ticket was filed; the docs describe the
      ruleset a user is scored under now (D-279), and v1 is history (D-282). A passage that
      describes an older version names it and is checked against that one.*
- [x] It **fails** when a rate, unit or flag in a doc disagrees with the file. Proven by changing
      one number in a scratch copy and watching it go red, naming the doc, the row and both values.
- [x] It **fails** when a skill row is added to the YAML and a table that enumerates skills does
      not gain a row — the `0157` case, which is the one that actually happened twice.
- [x] A dated snapshot table, which D-193 explicitly permits, is either exempt by an explicit
      marker or is itself checked against its stated date. Whichever is chosen is written down;
      an exemption nobody can see is how the next table drifts.
- [x] The check runs in CI on every build, alongside the other `scripts/check-*.mjs` gates.
- [x] It reports every disagreement, not the first — the same discipline as the rules validator.

## Notes

**Scope discipline.** This is a checker for values the ruleset owns. It is **not** a prose linter
and must not try to verify design *reasoning* — §3.2's session-parity argument is prose that
happens to contain numbers, and the check's job is the numbers, not the argument. If that
distinction turns out to be unmakeable mechanically, that is a finding worth recording rather
than a reason to widen the check until it produces noise.

Filed by the `04-domain-contract-and-rules` drift audit, which recorded D-193 and needed
somewhere honest to put "and this is not enforced yet".

## Operator validation

None. A CI check with no rendered surface. Verify by agent: each failure mode above is shown to
go RED on a seeded disagreement before the check is trusted green — this project has twice been
bitten by a gate that had only ever been seen passing.

## Resolution

**`scripts/check-doc-ruleset.mjs`** is the check D-193 recorded as missing. It runs in
`amplify.yml`'s build phase and in `gate.yml`, as `--self-test` followed by the real run, next to
`build-rules-json.mjs --check`. `scripts/check-doc-ruleset.test.mjs` runs the same seeds under
`npm test`.

**Which ruleset.** The newest `rules/xp-rules-vN.yaml`, read by directory scan, so v3 today. v2
changed only Cartography's rate and v3 only added Vigil's `treadmill` exercise, so for the tables
v2 and v3 are the same. A passage that describes an older version says so, either with a snapshot
marker or with an "in vN" qualifier, and is checked against that version. Seeded versions never
change (D-282), so a passage pinned to one cannot drift.

**What it reads.** It works from a registry (`PASSAGES`), not a prose scan:

- **`04` §1.1.** The activity table must hold exactly the `kind: activity` rows and the meta table
  exactly the `kind: meta` rows, matched by display `name`. Each row's `Unit` is checked against
  the row's `unit`. Any `N XP/<unit>` in a row is checked against `xpPerUnit`. A `1/3 …` in
  `Fed by` is checked against every `feeds` rate into that skill. A row marked `POST-MVP` must be
  exactly a disabled row. Two named sentences are checked too: "MVP ships **N enabled skills**: M
  activity skills — … — plus …", for both counts and both name lists, and "**Only X opens the
  map**", against `revealsGround`.
- **`04` §1.2.** The dated snapshot (see below): the `**N enabled rows** (names)` sentence,
  `maxLevel`, and each ceiling row as rows × `maxLevel` or `deepMaxLevel`.
- **`04` §3.2.** The table must hold exactly the enabled rows. Each row's unit and its
  `XP per unit` (or the `1/3` feeds rate) are checked. In `A typical session`, an `N … = M` entry
  must satisfy M = N × rate to within 0.5 XP, since D-193 also covers totals derived from a rate.
- **`02` §3.2.** Every key a row uses (`id` read as `skillId`) must be an attribute row. Every
  `kind`, `logMode` and `unit` value in use must appear in that row's vocabulary. Every exercise
  key in use must appear in the `exercises` shape, and every `logMode` that carries exercises
  must appear in its list. The two "Only `x` … in vN" sentences are checked against the vN they
  name.
- **Unregistered enumerations.** Any table in `docs/NN-*.md` or `docs/contracts/` whose first
  column names five or more distinct skills fails unless its section is registered. The threshold
  is five because `04` §8's worked-example tables name three or four skills and are backed by
  `propagate.test.ts`.

A missing registered heading, table or sentence **fails** rather than passing over nothing. Every
disagreement is reported, each naming the doc, section, line, row and both values.

**Snapshots: checked, not exempted.** A section that holds the visible line
`> **Ruleset snapshot: \`vN\`, YYYY-MM-DD.**` is checked against vN instead of the newest version.
vN must be the version in effect on that date: the newest whose `effectiveFrom` is on or before
it. `04` §1.2 is marked this way and is required to be (`requireSnapshot`). There is no exemption
marker at all. That rule is written in the script header, in the marker line in `04` §1.2, and in
the new sentence in `04` §1.1.

**Scope boundary held.** §3.2's session-parity argument ("885 vs 840", "~17 XP/min") is not read.
The line between the two is mechanical: tables plus a short list of named sentences. Neither the
worked examples in §8 nor the capability evidence tables under `docs/capabilities/` are read.

**Doc amendments.**

1. **`02` §3.2, the `exercises` row. This was real drift**, found by the check on the tree as it
   stood. v3 (D-286) gave Vigil, a `logMode: trace` row, the `treadmill` exercise with `kind: run`.
   The row said `for logMode: reps|duration` with shape `{id, label, entry, quickValues}`. It now
   says `reps|duration|trace` and `{id, label, entry, kind, quickValues}`, with a sentence
   explaining `kind`.
2. **`04` §1.1 and §3.2, the Unit columns.** These were not wrong values, but they gave a display
   word where the unit code belongs: "kilometre", "pushup", "plank-second", "new cell" and "—" for
   Constitution, whose unit is `share`. Both columns now lead with the unit code, with any gloss
   after it: `km`, `rep` (pushup), `second` (plank), `cell` (new), `share`. That is what lets the
   check compare them.
3. **`04` §1.1.** "`rules/xp-rules-v1.yaml` is the authority" now reads "the newest
   `rules/xp-rules-vN.yaml`", plus one sentence naming the check.
4. **`04` §1.2.** The snapshot marker line was added above the ceiling paragraph.

**Proof each failure goes red.** `--self-test` and the vitest file run 17 seeded disagreements:

- a rate in the doc, and a rate in the YAML (the Roving 35 → 60 case)
- a unit, a derived total, a feeds rate, `enabled`, `revealsGround`
- a skill row added to the YAML (the `0157` case)
- the §1.1 skill count
- `share` dropped from `02`'s unit set (the original D-193 case)
- an exercise key, and an attribute
- a snapshot whose date and version disagree, a snapshot value, and a snapshot marker removed
- an unregistered skill table, and a renamed heading

Each must produce a report matching the expected doc, row and values. A further case applies
four seeds at once and must get four or more reports. Run against the docs as they were at the
parent commit, the check reports the two `02` exercises disagreements, the missing §1.2 marker
and the unit-column wording. Those are the findings above.

**Files touched:**

- `scripts/check-doc-ruleset.mjs` (new)
- `scripts/check-doc-ruleset.test.mjs` (new)
- `amplify.yml`
- `.github/workflows/gate.yml`
- `docs/04-game-design.md` (§1.1, §1.2, §3.2)
- `docs/02-data-model.md` (§3.2)
- this ticket

**Not done, and why.** D-193 itself still says "not enforceable by a script today". That needs a
follow-up line in `DECISIONS.md`, which this agent may not edit; it is proposed in the wave report (recorded at merge as D-443).
`src/rules/doc-schema.test.ts` still compares §1.3 against v2. That is harmless, because v3's
scoring fields are v2's byte for byte, and it was left alone as outside this ticket.
