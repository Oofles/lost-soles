---
id: 174
slug: trace-sanitation-is-cited-as-03-integrations-md-2-2-in-21-pl
title: Trace sanitation is cited as 03-integrations.md §2.2 in 21 places; it is §2.6
type: bug
priority: med
status: closed
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-09-06T15:57:09Z
started: 2026-10-26T01:42:16Z
closed: 2026-10-26T02:05:58Z
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

- [x] Every `03-integrations.md` §2.2 citation whose subject is trace sanitation reads §2.6 —
      9 in `sanitize.ts`, 4 in `sanitize.test.ts`, 1 in `normalize.ts`.
      *Amended (agent, 0174): the counts were stale when built. `0045` moved the gate into
      `src/domain/geo.ts`, taking four `sanitize.ts` citations and one `sanitize.test.ts`
      citation with it, already corrected to §2.6 there. The tree held 5 in `sanitize.ts`, 3 in
      `sanitize.test.ts` and 1 in `normalize.ts`, plus 2 the audit missed (`normalize.test.ts`
      and `scripts/make-strava-fixture.mjs`). All 11 now read §2.6.*
- [x] D-197 and D-201 in `docs/decisions/DECISIONS.md` cite §2.6. **The decisions' substance is
      not touched** — this is a corrected cross-reference, not an amendment, and the standing
      rule against editing a settled `D-xxx` to make a ticket easier is not in play because
      nothing about what was decided changes.
      *Done by the orchestrator in the wave's shared-file commit: the seven occurrences, plus two
      more in **D-198** (the sanitizer's "break the trace into segments", which is
      `03-integrations.md:793`, inside §2.6). D-197, D-198 and D-201 now hold no §2.2.*
      *Left for the orchestrator (agent, 0174): `DECISIONS.md` is a shared file under
      `WAVES.md` §3. The seven lines are listed in the Resolution. Count verified at 7.*
- [x] The four correct citations are still correct: `normalize.ts:64` and `normalize.ts:361`
      still read `05-fog-of-war.md` §2.2 (now at lines 63 and 335); `oauth.ts` and `client.ts` still read
      `03-integrations.md` §2.2.
- [x] `npm run typecheck`, `npm run lint --max-warnings 0` and `npm test` are clean — comment-only
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

## Resolution

Comment and cross-reference changes only, with no runtime surface. `03-integrations.md` §2.6
holds "Trace sanitation" (line 777 today). §2.2 is OAuth.

**Files touched**

- `src/adapters/strava/sanitize.ts`: 5 citations, at lines 5, 76, 103, 113 and 115. Line 5 names
  the doc. The other four are bare §2.2 inside the same comment block and now read §2.6.
- `src/adapters/strava/sanitize.test.ts`: 3 citations, at lines 168, 196 (a test title) and 210.
- `src/adapters/strava/normalize.ts`: 1 citation, line 226, the `rejectedPoints` rationale.
- `src/adapters/strava/normalize.test.ts`: 1 citation the audit missed, line 627. *"Under
  §2.2's single 8 m/s gate"* means `03`'s 8 m/s (`05` §2.2's gate is 12.0), so the line now
  names the doc and reads `03-integrations.md` §2.6.
- `scripts/make-strava-fixture.mjs`: 1 citation the audit missed, line 28, *"the sanitizer
  (§2.2, D-197)"*. It now reads `03-integrations.md` §2.6.
- This ticket.

**Why the counts differ from the Description.** The audit counted on 2026-09-06, before `0045`
(`71fcf22`) moved `MAX_IMPLIED_SPEED_MS` and the haversine into `src/domain/geo.ts`. Four of the
nine `sanitize.ts` citations and one of the four `sanitize.test.ts` citations moved with that
code, and `0045` had already corrected them to §2.6 (`geo.ts` lines 61, 85, 90 and 100,
`geo.test.ts` line 73). That left 5, 3 and 1. All of those are fixed, plus the two above.

**Left alone on purpose.** `normalize.ts` lines 63 and 335 (the ticket's 64 and 361, which have
moved since) cite `05-fog-of-war.md` §2.2, and that is correct. `oauth.ts` lines 5 and 146 and
`client.ts` line 4 cite `03-integrations.md` §2.2 for OAuth, also correct. Every other `§2.2`
under `src/` points at `05-fog-of-war.md` (Trace → cells) or at OAuth. So does
`docs/08-security-privacy.md` line 102, which is about privacy-zone truncation under the lesser
scope, and that is §2.2's scope argument.

**Criterion 2 (D-197 and D-201) belongs to the orchestrator**, because `DECISIONS.md` is a shared
file (`WAVES.md` §3). There are seven occurrences, verified. In each one, §2.2 becomes §2.6 and
nothing else in the text changes:

- D-197: `- **§2.2's 8 m/s was measured against real traces and found too tight.**`
- D-197: `implied speeds 8, 8, 9, 9, 9 and 13 m/s — and **caught zero GPS jumps.** The failure §2.2`
- D-197: `- **12.5 m/s (45 km/h) splits the observed data along §2.2's own reasoning.**`
- D-197: `- **§2.2 specified one number and only for one kind**`
- D-201: ``Ticket `0172`. Amends `03-integrations.md` §2.2.``
- D-201: `- **§2.2 specified the filter and never said where it starts.**`
- D-201: `→ nothing is corroborated and the evidence does not name a culprit, so fall back to §2.2`

D-197's existing "§2.6's table" (about `Ride`) is already correct and stays as it is.

*Orchestrator, at merge:* applied. **D-198** held the same wrong pointer twice (lines 1761 and 1763:
"what §2.2 requires", "§2.2 separately requires the sanitizer to *break the trace into
segments*"); that quote is `03-integrations.md:793`, in §2.6, so both were corrected too. The audit
counted 21; the real number was 25: 11 fixed in code here, 9 in decisions, and 5 that `0045`
had already corrected when it moved the gate into `src/domain/geo.ts`.

**Decisions:** none. This corrects an address. It does not amend anything.

**Verification.** Every guard in `amplify.yml`'s build phase passed. `check-secret-storage.mjs
--require-literals` ran with `AWS_APP_ID` and `AWS_BRANCH` set, against read-only AWS.
`npm run typecheck`, `npm run lint`, `npx vitest run` and `npm run build` are clean. A grep for
`§2\.2` over `sanitize.ts` and `sanitize.test.ts` returns nothing.

## Operator validation

None for the operator: comments and decision cross-references only, no runtime surface.

**Smoke test (orchestrator, 2026-10-25, `main` at `3955546`).** `grep -n "§2\.2"` over
`sanitize.ts` and `sanitize.test.ts` returns nothing. D-197, D-198 and D-201 hold no `§2.2`.
The four correct citations are unchanged (`normalize.ts` → `05-fog-of-war.md` §2.2; `oauth.ts`,
`client.ts` → `03-integrations.md` §2.2 for OAuth). All 40 `amplify.yml` gate commands pass on a
clean worktree, including typecheck, lint, the full suite and the build.
