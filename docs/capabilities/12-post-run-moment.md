# 12-post-run-moment

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`12-post-run-moment\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (8)

- `0078` — /run/:activityId route, its four entry points, and the persistent end state
- `0079` — Drive the 08 coverage mask from an animation clock, not from the cell set
- `0080` — Beat 1 — the map (0.0 to 2.9 s): camera, lantern, route ink, three kinds of ground
- `0081` — Beat 2 — the parchment tally (2.9 to 6.0 s), staggered count-ups, and never a zero
- `0082` — Beat 3 — queued level-up cards, and the D-146 guard that must never let one fire
- `0083` — Beats 4 and 5 — the chronicle line and the frontier line
- `0084` — Skip, interruption, reduced motion, WebGL loss, backfill, and the per-device seen flag
- `0085` — The no-new-territory fallback — the permanent trace layer and a run that still counts

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

*Written at the capability audit, 2026-10-15.*

**Twenty-one tickets, eight planned.** The sequence itself (`0078`–`0085`) shipped as designed. The
other thirteen came from three places. Building it exposed missing data: `0251` and `0253`, because
beat 1 could not know which cells *this* run revealed. The operator's looks asked for more: names on
the lines (`0256`, `0263`), landmarks recorded and drawn (`0248`, `0260`), and the "comes back into
season" line (`0262`). The rest was older debt this capability was the first to touch: `0159`,
`0212`, `0222`, `0255`, `0258`, `0264`. Planned at roughly eight sessions (one per ticket, D-151);
it took about eight days of sessions from 2026-10-08, most of the overrun being the operator-led
additions rather than rework.

**What the design got right, non-obviously.** The beat clock as one function of time (`0079`), with
skip, Esc, Back, reduced motion and WebGL loss all landing on the same end state, made `0084` a
test of one property instead of five features. "Never a zero" as row *omission* rather than copy
held through every smoke. D-146 survived a change of mechanism. The cards moved from a snapshot
diff to attribution by the activity's own XP (D-297), and `0159` still proved the guard red-then-green.

**What it got wrong.** It assumed the browser could work out a run's own reveal from the cell set.
It cannot without per-run classes (`0251`/`0253`, D-294). And it named a typeface (Cinzel) that `§8.4`
does not have.

**Divergences: nine found, over the budget of three, so a DESIGN pass ran before recording**
(`AUDIT.md` §2). The code broke no settled decision. Every documentation divergence was a decision
taken during the capability (D-297, D-299, D-301, D-294) that never reached the section it
changed. That is the fourth capability running (`09`, `10`, `11`, now `12`) where decisions
outran their docs. The pass amended `06` §3.2/§5.4/§8.4, `09` §5.2, `02` §3.8/§8.1–8.3, `05`
§4.4–4.5 and `08` §6.4, and recorded D-307 (the drill rebuilds landmarks, the trace web and
`classes.json`; a rebalance may move a landmark), D-308 (the 30 fps cap is ambient-only) and D-309
("remembered" is the on-screen word). Three were the code's fault and are filed: `0265` (Total XP
floor line on a failed read), `0266` (say "remembered"), `0267` (the tally's tap hint).

**§3.** The USE step happened on real data: the operator relived real runs for `0079`–`0081`
(2026-10-13) and looked at real landmarks for `0260`. Six tickets (`0082`–`0085`, `0255`, `0256`)
had closed with their perceptual check still "pending". The operator reported all good at this
audit, 2026-10-15. `0248`, `0262` and `0263` cannot be looked at until data exists (no skill past
50; no ground re-arms before about January 2027), and each says so. XP and fog baselines rose
(cells 1141 → 1352); nothing fell.

**What the next capability should do differently.** (1) **When a ticket records a D-xxx that
changes a cited section, amend that section in the same commit.** That is the whole drift of this
capability, and the cheapest rule that would have prevented it. (2) **Do not close with a perceptual
check marked pending.** Leave the criterion open, as `(operator)` criteria already require. The
`11` reflection saw one such slip; this capability had six.

## Audit — 2026-10-15 (`tickets.mjs audit --record`)

**Verdict: PASS.** Mechanical half: 12 passed, 0 failed, 0 n/a. See AUDIT.md §1, §4, §5.

**Filed by this audit, and therefore excluded from `capability-tickets-closed`:** `0265` The run ledger keeps a +N XP floor line when the earlier standing cannot be read; `0266` Say remembered, never re-armed, on screen; `0267` Show the tap-a-row hint on the post-run tally. This capability passed with work outstanding — its own code-was-wrong findings, filed as AUDIT.md §2 directs and listed under Divergences below, not forgotten.

**Divergences (3 of a budget of 3):**

1. **code-was-wrong** — `0265` — 06 §3.5 'Total XP always on screen'; the footer drops it when the before read fails
2. **code-was-wrong** — `0266` — the tally breakdown says 're-armed ground' beside 'N remembered'; D-309 picks remembered
3. **code-was-wrong** — `0267` — 06 §3.2's tap-a-row hint never shipped

- `typecheck` — **pass** — npm run typecheck
- `lint` — **pass** — npm run lint
- `unit-tests` — **pass** — npm run test
- `script-tests` — **pass** — node --test tickets.test.mjs
- `invariant-sweep` — **pass** — 18/30 invariants cited by a test name, none lost. Ratchet only: the remaining 12 are not due until 0116 sets "complete": true in docs/capabilities/invariant-citations.json, which makes this row all-or-nothing
- `boundary-greps` — **pass** — check-boundaries.mjs clean
- `vigil-test` — **pass** — src/rules/registry-delta.test.ts, app/skills/vigil-peer.test.tsx
- `validate` — **pass** — 0 errors across open/ and closed/
- `fog-no-refog` — **pass** — 1 baselined user(s): cells 1141 → 1352, gen 134 → 135 — none lower (docs/capabilities/regression-baseline.json)
- `xp-not-lower` — **pass** — 1 baselined user(s), 10 skill(s): cartography 16439/L23, constitution 1745/L11, might 80/L4, wayfaring 5159/L16 — none lower (docs/capabilities/regression-baseline.json)
- `blocked-by-closed` — **pass** — no blocked_by points at a closed ticket
- `capability-tickets-closed` — **pass** — 21 closed; 3 filed by this audit (0265, 0266, 0267)

<!-- audit-record {"capability":"12-post-run-moment","audited":"2026-10-15T13:26:22Z","verdict":"pass","mechanical":{"pass":12,"fail":0,"na":0},"divergences":3,"filed":["0265","0266","0267"]} -->
