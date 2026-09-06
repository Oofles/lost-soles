---
id: 174
slug: trace-sanitation-is-cited-as-03-integrations-md-2-2-in-21-pl
title: Trace sanitation is cited as 03-integrations.md §2.2 in 21 places; it is §2.6
type: bug
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-09-06T15:57:09Z
---

## Description

Found by the `05-strava-adapter` drift audit (§2, divergence 1).

Trace sanitation lives in **`03-integrations.md` §2.6** ("Activity type mapping" → "Trace
sanitation"). **§2.2 is OAuth.** Twenty-one citations across the capability point at §2.2, and
seven of them are inside a settled decision.

| Where | Count |
|---|---|
| `src/adapters/strava/sanitize.ts` | 9 |
| `src/adapters/strava/sanitize.test.ts` | 4 |
| `src/adapters/strava/normalize.ts` (line 227, the `rejectedPoints` rationale) | 1 |
| `docs/decisions/DECISIONS.md` — **D-197 and D-201** | 7 |

**The doc is not the one that moved.** `git show` of the initial commit (`f876f84`) has §2.2 as
OAuth and §2.6 as activity type mapping; the numbering has never changed. So this is
`code-was-wrong` in the audit's sense: the pointers are wrong, not the section.

**Why it is worth a ticket rather than a shrug.** The citations are load-bearing prose — they
are the argument for why the gate is 12.5 and per-kind, and D-197 quotes "§2.2's own reasoning"
about what a human can run. A reader who follows the pointer lands in the OAuth flow and finds
nothing that supports the sentence, which is exactly the state that makes someone distrust the
whole comment block. The comments are unusually good; that is the reason to fix the address
rather than delete them.

**Note the two citations that are already correct and must not be swept up:**
`normalize.ts:64` and `normalize.ts:361` cite **`05-fog-of-war.md` §2.2**, which genuinely is
"Trace → cells". `oauth.ts` and `client.ts` cite `03-integrations.md` §2.2 for OAuth, correctly.
A blind find-and-replace breaks four right citations to fix twenty-one wrong ones.

## Acceptance criteria

- [ ] Every `03-integrations.md` §2.2 citation whose subject is trace sanitation reads §2.6 —
      9 in `sanitize.ts`, 4 in `sanitize.test.ts`, 1 in `normalize.ts`.
- [ ] D-197 and D-201 in `docs/decisions/DECISIONS.md` cite §2.6. **The decisions' substance is
      not touched** — this is a corrected cross-reference, not an amendment, and the standing
      rule against editing a settled `D-xxx` to make a ticket easier is not in play because
      nothing about what was decided changes.
- [ ] The four correct citations are still correct: `normalize.ts:64` and `normalize.ts:361`
      still read `05-fog-of-war.md` §2.2; `oauth.ts` and `client.ts` still read
      `03-integrations.md` §2.2.
- [ ] `npm run typecheck`, `npm run lint --max-warnings 0` and `npm test` are clean — comment-only
      changes, so any movement here is a signal something else was edited.

## Steps to reproduce

1. `grep -n "§2\.2" src/adapters/strava/sanitize.ts` — nine hits, all about the speed gate.
2. Open `docs/03-integrations.md` at §2.2. It is "OAuth". The gate is in §2.6, under
   "Trace sanitation".
3. `git show f876f84:docs/03-integrations.md | grep -nE '^## 2\.[0-9]'` — the numbering is
   original; the section did not move.

## Expected vs actual

**Expected:** a citation resolves to the text it quotes.

**Actual:** twenty-one resolve to the OAuth section, including seven inside D-197 and D-201.

## Notes

Filed by the `05-strava-adapter` audit, 2026-09-06, as divergence 1 of four.

The general shape is worth recording because it will recur: **every one of these citations was
written from a ticket, and the ticket had the section content in front of it without the section
number.** Nothing in the toolchain checks that a `§n.n` in a comment resolves to a heading that
exists, let alone to the right one. If this happens a third time, the cheap fix is a CI check
that parses `<doc> §<n>` out of comments and asserts the heading exists — `docs/INDEX.md` already
carries the heading table it would need.

## Operator validation

None — comment and cross-reference changes with no runtime surface. Verified by the agent with
the greps in the acceptance criteria plus a clean typecheck/lint/test run.
