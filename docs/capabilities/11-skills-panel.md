# 11-skills-panel

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`11-skills-panel\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (5)

- `0073` — /skills panel — every skill, level, bar, Total Level headline
- `0074` — /skills/:skillId detail sheet
- `0075` — The rules that keep the skills panel readable in year ten
- `0076` — Vigil renders as a peer of Wayfaring with no special case — the UI half of D-132
- `0077` — Gold-leaf and contrast compliance on the skills panel (D-148)

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

*Written at the capability audit, 2026-10-08.*

**Eight tickets, five planned.** `0242` (the `bySkill` GSI could not be queried through AppSync)
was found by building the sheet. `0246` and `0247` came from the operator looking at the 15-skill
preview: Total Level shown twice, and three columns wasted on a desktop screen. All three were
right, and none was in the plan. The panel was designed on paper for a phone, and the desktop
browser corrected it within one look.

**The code matched the design. The design had not caught up with its own decisions.** §2 found
two divergences. (1) §1.5 promises swipe-down to dismiss a sheet. `0074` shipped Esc, scrim, Close
and back without amending §1.5 → `0249`, low priority. (2) §1.5 still called the desktop
"secondary, D-124" a month after D-227 and D-251 made it the *only* viewing surface. The auditor
read that line literally and told the operator the phone was the main device, which the operator
had corrected many times before. This is the third capability running (after `09` and `10`) where
an unapplied decision misled the work, not the code. D-227 itself said "`06` is written
phone-first", and ticket `0187` holds that pass. Until it lands, **any claim in `06` about which
device matters is suspect; D-227/D-251 win.**

**§1 failed for reasons outside the code.** The agent shell's Node 20 failed the unit tests, and
the gitignored `tmp/` probes failed typecheck and lint. `0246` hit the same lint failure and fixed
the probe instead of the config. → `0250`.

**One operator check slipped through a close.** `0077` closed with its perceptual check marked
"pending". It was done at the audit: "Checks are good." The close procedure refuses an unchecked
`(operator)` criterion, but a pending line in `## Operator validation` gets past it. That is worth
knowing, but not worth a gate yet.

**What held.** Vigil needed no code (D-132): the panel, the sheet and Total Level treat it as a
peer, and a test proves it. The 0074 sheet totals matched the bars for every live skill (I-15).
XP and fog baselines did not move.

## Audit — 2026-10-08 (`tickets.mjs audit --record`)

**Verdict: PASS.** Mechanical half: 12 passed, 0 failed, 0 n/a. See AUDIT.md §1, §4, §5.

**Divergences (2 of a budget of 3):**

1. **code-was-wrong** — `0249` — 06 §1.5 promises swipe-down dismissal; 0074 shipped the sheet without it
2. **design-was-wrong** — `D-251` — 06 §1.5 still called desktop 'secondary, D-124'; amended to the viewing surface

- `typecheck` — **pass** — npm run typecheck
- `lint` — **pass** — npm run lint
- `unit-tests` — **pass** — npm run test
- `script-tests` — **pass** — node --test tickets.test.mjs
- `invariant-sweep` — **pass** — 18/30 invariants cited by a test name, none lost. Ratchet only: the remaining 12 are not due until 0116 sets "complete": true in docs/capabilities/invariant-citations.json, which makes this row all-or-nothing
- `boundary-greps` — **pass** — check-boundaries.mjs clean
- `vigil-test` — **pass** — src/rules/registry-delta.test.ts, app/skills/vigil-peer.test.tsx
- `validate` — **pass** — 0 errors across open/ and closed/
- `fog-no-refog` — **pass** — 1 baselined user(s): cells 1141 → 1141, gen 134 → 134 — none lower (docs/capabilities/regression-baseline.json)
- `xp-not-lower` — **pass** — 1 baselined user(s), 10 skill(s): cartography 15985/L23, constitution 1584/L11, might 80/L4, wayfaring 4675/L15 — none lower (docs/capabilities/regression-baseline.json)
- `blocked-by-closed` — **pass** — no blocked_by points at a closed ticket
- `capability-tickets-closed` — **pass** — 8 closed

<!-- audit-record {"capability":"11-skills-panel","audited":"2026-10-08T15:20:23Z","verdict":"pass","mechanical":{"pass":12,"fail":0,"na":0},"divergences":2} -->
