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
started: 2026-09-04T16:59:18Z
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

- [x] The validator rejects any skill row without a boolean `enabled`, naming the row's path.
- [x] The message says why there is no default: an omitted flag reads as `undefined`, which is
      falsy, so silence would mean "off".
- [x] A test deletes `enabled` from a **strength** row — the case nothing currently catches — and
      asserts the validator now fails.
- [x] A test asserts the shipped `rules/xp-rules-v1.yaml` still validates clean.
- [x] `02-data-model.md` §3.2's `enabled` row states that it is required and has no default.
- [x] The registry-delta harness (`0030`) still passes — a delta row must carry `enabled` too.

## Notes

Deliberately NOT extending `0029`'s totality check to demand a skill for every measure. That would
be a much larger claim — it would make "every exercise has a live skill" a build-time invariant —
and it is the wrong instrument: the defect here is a missing field, and a missing field should be
caught by field validation, not inferred from a downstream absence.

`0031` did not fix this because `0031` is a `docs` ticket and fixing it there would have widened
its scope. The doc half — §3.2 saying `enabled` is required — is listed above so the code and the
doc change together (D-153).

## Operator validation

**None required of the operator** — a validator rule with no rendered surface. The ticket asked
for two things to be recorded by the agent, and the second is the one that matters: *"a strength
row with `enabled` deleted now fails **where it previously passed**"*. Both were run on this
machine (Node 22, WSL2).

**The "previously passed" half, demonstrated rather than asserted.** The `validateEnabled` call
was commented out and the new suite re-run:

| | with the check disabled | with it enabled |
|---|---|---|
| `validate.test.ts` | **5 failed**, 32 passed | 37 passed |
| a strength row missing `enabled` | **zero errors** | `skills[6].enabled`, named |
| a distance row missing `enabled` | 3 errors, none about the field | `skills[0].enabled`, named |

The two 0160 tests that stayed **green with the check disabled are supposed to** — one is the
shipped-file baseline, and the other is the assertion that *nothing else* reports the mutation.
That second one is the defect written down as a test: strip the `.enabled` errors and the mutated
ruleset is completely clean, which is exactly why field validation had to exist rather than
extending a downstream check.

**Smoke tests, all from a clean tree:**

| Check | Command | Result |
|---|---|---|
| Rules tests | `npx vitest run src/rules` | 7 files, 134 passed |
| Full suite | `npm test` | 27 files, 446 passed, 1 skipped |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint at `--max-warnings 0` | `npm run lint` | exit 0 |
| D-100 boundary | `node scripts/check-boundaries.mjs` | exit 0 |
| Registry-delta harness (criterion 6) | `npx vitest run src/rules/registry-delta.test.ts` | 14 passed |
| Backlog | `tickets.mjs validate` | 0 errors, 0 warnings |

## Resolution

**Files touched** — `src/rules/validate.ts` (`validateEnabled`, called from the per-row loop),
`src/rules/validate.test.ts` (+7 tests), `docs/02-data-model.md` §3.2 (the `enabled` row).

The fix is the one the ticket specified and nothing more: require `enabled` explicitly on **every**
row rather than defaulting it. Not only activity rows — Slayer is `kind: meta` and ships
`enabled: false` (D-122), so the flag is meaningful on meta rows too and a check that skipped them
would have left the same hole one row along.

**The rejected alternative stays rejected, and the reason got stronger while writing it.**
Defaulting to `true` removes the hazard but relocates the file's meaning into code. The asymmetry
that settles it is that the dangerous default here is the one JavaScript already supplies:
`selectActivitySkills` filters on `!skill.enabled`, so `undefined` is falsy and **silence means
off**. A field whose omission disables a skill must not be omittable.

**One side effect worth naming.** `validateSelection` runs only when the shape checks are clean, so
a distance row missing `enabled` now reports one precise error instead of three vague ones. That is
a strict improvement — the three said *"no skill measures distance for a run with hasTrace=true"*,
which describes a symptom two inferential steps from the missing field — but it does mean the old
messages no longer appear for this input, and a reader looking for them should look here.

**What went wrong: the skill-name grep caught my own docstring.** The first version of
`validateEnabled`'s comment used a real skill id to explain the defect, and §3.8 check 6
(`no-skill-names.test.ts`) failed the build on it, correctly. Reworded to describe the row by its
`logMode` rather than name it — **not exempted**. Worth recording because this is now the third
time in this project a check has been tripped by prose *about* the check rather than an instance of
it (0126's probe, 0133's own fixture, and now this), and each time the right move was to change the
text rather than widen the exemption.

**No `D-xxx` filed.** This implements the D-189 principle on a second field; it does not decide
anything new. The reasoning lives on the `enabled` row in §3.2, next to `revealsGround`, which is
where a reader meets the question.
