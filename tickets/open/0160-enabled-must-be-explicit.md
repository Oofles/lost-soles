---
id: 160
slug: enabled-must-be-explicit
title: An omitted `enabled` silently disables a skill, and only distance skills are caught
type: bug
priority: med
status: open
size: s
capability: 04-domain-contract-and-rules
depends_on: [29]
blocked_by: []
source: agent
created: 2026-09-04T15:32:58Z
---

## Description

Found while writing `0031`. `rules/xp-rules-v1.yaml` carries `enabled: true` on every row and the
validator does not require it, so an omitted `enabled` reads as `undefined`, which
`selectActivitySkills` treats as falsy — **the skill silently stops matching.**

For a **distance** skill this is caught: `0029`'s totality check reports *"no skill measures
distance for a run with hasTrace=true"*, verified by deleting Wayfaring's `enabled` and watching
three errors appear. For a **strength** skill it is not caught by anything. Delete `might`'s
`enabled` and the ruleset validates clean, seeds clean, and pushups quietly stop scoring.

**Why this matters more than a typo normally would.** XP never decreases (D-135), so a period of
silent under-award is corrected only by adding — a replay job (`04` §4.4), not an edit. And the
symptom is absence: nothing errors, nothing logs, a skill simply never appears in a tally. That is
the same failure shape D-141 was written to prevent, one field along.

**The fix, consistent with `revealsGround` (D-189):** require `enabled` explicitly on every row
rather than defaulting it. The argument is the same one and it is stronger here, because the
dangerous default is the one JavaScript already supplies: `undefined` is falsy, so *silence means
off*. A field whose omission disables a skill must not be omittable.

Considered and rejected: **defaulting to `true`**. It removes the hazard but makes the file's
meaning depend on a rule written in code rather than on what the row says, and `02` §3.2 describes
`enabled` as a real attribute of the item, not an optional annotation.

## Steps to reproduce

```
# 1. Delete `enabled` from a STRENGTH row — the case nothing catches.
#    (`might` in rules/xp-rules-v1.yaml)
# 2. Validate:
node -e "…" # or: validateRuleSet(loadRuleSet(1))
```

Verified 2026-09-04 by deleting the field in a scratch copy of the parsed ruleset:

- **`wayfaring`** (a distance skill) — three errors, from `0029`'s totality check:
  *"no skill measures distance for a run with hasTrace=true"*, and the same for `walk` and `hike`.
  `selectActivitySkills` returns `[]` for a traced run.
- **`might`** (a strength skill) — **zero errors.** The ruleset validates clean and pushups match
  nothing.

## Expected vs actual

**Expected:** a skill row missing a required field is rejected at seed time, naming the row.

**Actual:** the row is accepted and the skill silently stops matching, because `undefined` is
falsy and `selectActivitySkills` filters on `!skill.enabled`. A distance skill is caught only
incidentally, by a check looking for a different problem; a strength skill is not caught at all.

## Acceptance criteria

- [ ] The validator rejects any skill row without a boolean `enabled`, naming the row's path.
- [ ] The message says why there is no default: an omitted flag reads as `undefined`, which is
      falsy, so silence would mean "off".
- [ ] A test deletes `enabled` from a **strength** row — the case nothing currently catches — and
      asserts the validator now fails.
- [ ] A test asserts the shipped `rules/xp-rules-v1.yaml` still validates clean.
- [ ] `02-data-model.md` §3.2's `enabled` row states that it is required and has no default.
- [ ] The registry-delta harness (`0030`) still passes — a delta row must carry `enabled` too.

## Notes

Deliberately NOT extending `0029`'s totality check to demand a skill for every measure. That would
be a much larger claim — it would make "every exercise has a live skill" a build-time invariant —
and it is the wrong instrument: the defect here is a missing field, and a missing field should be
caught by field validation, not inferred from a downstream absence.

`0031` did not fix this because `0031` is a `docs` ticket and fixing it there would have widened
its scope. The doc half — §3.2 saying `enabled` is required — is listed above so the code and the
doc change together (D-153).

## Operator validation

None. A validator rule with no rendered surface. Verify by agent: the shipped file still validates
clean, and a strength row with `enabled` deleted now fails where it previously passed — record
both, since "previously passed" is the whole reason the ticket exists.
