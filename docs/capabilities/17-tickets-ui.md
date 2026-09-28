# 17-tickets-ui

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`17-tickets-ui\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

> **WITHDRAWN 2026-09-28 by D-252.** The phone is not a viewing or input surface (D-251), and
> at the desktop the repo, GitHub, `tickets.mjs` and the agent cover everything this capability
> planned. All five tickets were declined, and this capability's audit records the withdrawal.

## Tickets (5)

- `0107` — /dev/tickets capture sheet — title, body, two chip rows, Save
- `0108` — Browse tickets, grouped by capability, priority-then-id within group
- `0109` — /dev/tickets/:id detail with depends_on status resolved inline
- `0110` — Ticket read cache + GitHub push webhook — explicitly a cache, never authoritative
- `0111` — Enforce the v1 non-goals — create and browse only, no write path from the phone

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

**Withdrawn before any of it was built. This audit records the withdrawal; it did not verify
shipped work.** On 2026-09-28 the operator removed the phone first as a viewing surface (D-251),
then as an input surface: *"I don't use /log or capture from my phone."* Every ticket here rested
on D-092's "phone-friendly" requirement:
- `0107`: a capture sheet sized for a thumb;
- `0108`–`0110`: read-only mirrors so the phone never needed GitHub;
- `0111`: a guard so the phone could only ever create.

With the premise gone, the operator chose to close the capability rather than rebuild it for the
desktop, where the repo, GitHub, `tickets.mjs` and the agent already cover it (D-252).

**What the design got wrong.** It treated the operator's *platform* (Android, D-124) as their
*usage*. D-124 was right that the phone is Android. It never established that the phone was
where the app would be used. That was assumed, and then built into eight capabilities' worth of
tickets. The correction arrived in three steps (D-227, D-240, D-251), each discovered during
validation rather than asked up front. **The next design pass should ask where a feature will be
*used*, not only what the platform is.**

**What it got right.** It put the load-bearing half, the capture endpoint and `inbox/` triage, in
capability `03`, and left the UI last and droppable ("*Last, because `03` already did the
load-bearing half*"). Withdrawing `17` therefore cost five declined tickets and no deleted code
beyond two stub routes (`0216`).

**Divergence recorded:** one, `design-was-wrong` under D-252. D-092's requirement was retired.
There was no shipped code to drift from it.

**Estimate vs. actual:** zero sessions against an unestimated five tickets.

**For the next capability:** nothing changes in practice. `18`'s tickets were swept under `0215`
along with the rest of the backlog.

## Audit — 2026-09-28 (`tickets.mjs audit --record`)

**Verdict: PASS.** Mechanical half: 11 passed, 0 failed, 1 n/a. See AUDIT.md §1, §4, §5.

**Divergences (1 of a budget of 3):**

1. **design-was-wrong** — `D-252` — D-092 required a phone-friendly in-app ticket UI; D-251 removed the phone as a viewing and input surface, so capability 17 was withdrawn and 0107-0111 declined before anything was built

- `typecheck` — **pass** — npm run typecheck
- `lint` — **pass** — npm run lint
- `unit-tests` — **pass** — npm run test
- `script-tests` — **pass** — node --test tickets.test.mjs
- `invariant-sweep` — **pass** — 9/30 invariants cited by a test name, none lost. Ratchet only: the remaining 21 are not due until 0116 sets "complete": true in docs/capabilities/invariant-citations.json, which makes this row all-or-nothing
- `boundary-greps` — **pass** — check-boundaries.mjs clean
- `vigil-test` — **pass** — src/rules/registry-delta.test.ts
- `validate` — **pass** — 0 errors across open/ and closed/
- `fog-no-refog` — **pass** — 1 baselined user(s): cells 1035 → 1035, gen 61 → 61 — none lower (docs/capabilities/regression-baseline.json)
- `xp-not-lower` — **na** — no source under src/ or amplify/ references snapshots/skillstate/ yet — activates when the T4 skill-state snapshot exists (02 §8.2, 0067; D-135, I-16)
- `blocked-by-closed` — **pass** — no blocked_by points at a closed ticket
- `capability-tickets-closed` — **pass** — 5 closed

<!-- audit-record {"capability":"17-tickets-ui","audited":"2026-09-28T17:43:50Z","verdict":"pass","mechanical":{"pass":11,"fail":0,"na":1},"divergences":1} -->
