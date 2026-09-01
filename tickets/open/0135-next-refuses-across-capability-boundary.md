---
id: 135
slug: next-refuses-across-capability-boundary
title: next refuses to start a ticket in a new capability until the previous audit passed
type: feature
priority: high
status: open
size: s
capability: 01-ticket-system
depends_on: [134]
blocked_by: []
source: agent
created: 2026-09-01T04:18:14Z
started: 2026-09-01T04:36:31Z
---

## Description

Split out of [`0121`](0121-tickets-audit-subcommand.md). This is the criterion `0121`'s own notes
call the one that gives the audit teeth:

> Without it the audit is advisory and will be skipped precisely when it matters most — under time
> pressure, late in the build, when drift has already accumulated.

`next` reads the audit record `0134` writes, and refuses to hand over a ticket in a new capability
while the previous capability's audit has not passed.

## Acceptance criteria

- [x] `tickets.mjs next` refuses to return a ticket in capability `N` while capability `N-1`'s audit
      has not passed, and **names the blocking capability** rather than saying the ready set is empty.
- [x] The refusal is scoped to a *change* of capability: continuing to work tickets inside the
      current capability is never blocked.
- [x] Enforcement begins at capability `02`, per `0121` — `00` and `01` predate the command, and that
      bootstrap gap is closed by `0121`'s retroactive run, not by this ticket.
- [x] `next --all` still lists the whole ready set, marking which entries are gated. The gate refuses
      to hand over work; it does not hide the backlog.
- [x] A test proves the refusal fires, and a second proves it lifts once the audit record says passed.

## Notes

The `size: l` refusal in `next` (D-161) is the precedent for where this belongs: enforcement goes
where the operator is already paying attention, not in `validate`. A backlog that fails validation
because an audit is outstanding would train everyone to ignore `validate`.

## Operator validation

With capability `02`'s audit unrecorded, run `/tickets next` and confirm it refuses and names `02`.
Confirm `/tickets next --all` still lists everything, gated entries marked.

## Resolution

**`.claude/skills/tickets/scripts/tickets.mjs`** — `auditBlockers(capability, tickets)` plus a
rewritten `cmdNext`. A ticket in capability `C` where `C ≥ 02` is gated while any lower-numbered
capability **that has tickets** has not recorded a `pass` or `forced` audit. Recorded as `D-173`.

Against the real backlog right now:

```
$ tickets.mjs next
  0135  next refuses to start a ticket in a new capability until …

  12 higher-priority ticket(s) are gated on capability '00-preflight-and-repo' —
  its audit has not passed. 'tickets.mjs audit 00-preflight-and-repo' to start it.

$ tickets.mjs next --all
  0019  high [GATED on 00-preflight-and-repo] Harden the capture endpoint …
  …
  13 ready, 12 gated on an unaudited capability
```

That is the intended shape and it is worth stating plainly: **from this commit until `0121` records
the retroactive audits, every ticket from capability `02` onward is gated.** The system does not
deadlock — `0121` is in capability `01`, so `next` still hands it over, and it is precisely the
ticket that closes the bootstrap gap. The gate points at its own remedy.

### Four decisions inside the rule, none of them obvious

- **"Every lower capability", not "the immediately previous one"**, so skipping a capability cannot
  launder the gap. This also gives criterion 2 for free: a capability is never below itself, so work
  *inside* the capability you are in is never gated. Blocked from advancing, never from finishing.
- **The blocker reported is the EARLIEST gap, not the nearest.** The first implementation reported
  the highest-numbered unaudited capability, reasoning that it was "the nearest thing to fix". Run
  against the real backlog it said *"gated on 02-deploy-and-auth"* while `00` and `01` were both
  outstanding — you would audit `02`, come back, and be told `01`. Capabilities are built and
  audited in order, so the earliest gap is the only one that can actually be closed next. Caught by
  reading the output, not the code.
- **A `forced` verdict lifts the gate**, exactly as `pass` does. `--force` exists to make skipping
  visible rather than impossible (0121, D-172); a force that still blocked would be a refusal with
  extra steps. The record still says `forced`, never `pass`.
- **`next` prefers an ungated ticket over a gated higher-priority one** and says how many it passed
  over, rather than refusing outright whenever the top of the ready set is gated. Refusing outright
  would hide available work behind an unrelated capability's audit.

**Tests** — 8 new cases (101 total, was 93): the earliest-gap blocker; nothing below `02` gated;
work inside the current capability ungated; the gate lifting on both `pass` and `forced`; the
all-gated refusal naming the audit commands and `--all`; `--all` listing everything with markers; an
ungated low-priority ticket preferred over a gated high-priority one; and a ticket with
`capability: null` never gated.

**Two of my own test setups were wrong**, and the code was right both times. One asserted `next`
would return the capability-`02` ticket when all three ready tickets were ungated — `next` picks by
priority then id, so which ticket comes back says nothing about the gate; it now asserts against
`--all` that none is marked. The other built an "every ready ticket is gated" scenario that included
an ungated capability-`00` ticket. Recorded rather than quietly fixed: a test rewritten until it
passes is worth less than one that was wrong for a stated reason.

**Docs** — `07-ticketsmith.md` §4.3's `/tickets next` row (normative), `reference.md`'s ready-set
section (the gate is a `next` refusal, **not** a readiness rule — same placement as D-161), and
`SKILL.md`'s `next` section, which tells the agent not to route around a gate by starting a ticket
by hand. `D-173` in `DECISIONS.md`.

## Operator validation — 2026-09-01

On the laptop, against the real backlog:

- `tickets.mjs next` → hands over `0135` (capability `01`, ungated) and reports 12 gated on
  `00-preflight-and-repo`. ✔
- `tickets.mjs next --all` → all 13 ready tickets listed, 12 marked `[GATED on
  00-preflight-and-repo]`, footer `13 ready, 12 gated on an unaudited capability`. ✔
- The gate names `00-preflight-and-repo` — the earliest gap — rather than `02-deploy-and-auth`,
  which is what the first implementation said. ✔

The one thing an operator would judge that I cannot: whether being gated out of 12 tickets is
tolerable in practice, or whether it will be resented and forced. It is deliberately not something
`--force` makes hard, and `0121` clears it immediately.
