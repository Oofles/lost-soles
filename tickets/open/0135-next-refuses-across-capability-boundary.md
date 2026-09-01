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
---

## Description

Split out of [`0121`](0121-tickets-audit-subcommand.md). This is the criterion `0121`'s own notes
call the one that gives the audit teeth:

> Without it the audit is advisory and will be skipped precisely when it matters most — under time
> pressure, late in the build, when drift has already accumulated.

`next` reads the audit record `0134` writes, and refuses to hand over a ticket in a new capability
while the previous capability's audit has not passed.

## Acceptance criteria

- [ ] `tickets.mjs next` refuses to return a ticket in capability `N` while capability `N-1`'s audit
      has not passed, and **names the blocking capability** rather than saying the ready set is empty.
- [ ] The refusal is scoped to a *change* of capability: continuing to work tickets inside the
      current capability is never blocked.
- [ ] Enforcement begins at capability `02`, per `0121` — `00` and `01` predate the command, and that
      bootstrap gap is closed by `0121`'s retroactive run, not by this ticket.
- [ ] `next --all` still lists the whole ready set, marking which entries are gated. The gate refuses
      to hand over work; it does not hide the backlog.
- [ ] A test proves the refusal fires, and a second proves it lifts once the audit record says passed.

## Notes

The `size: l` refusal in `next` (D-161) is the precedent for where this belongs: enforcement goes
where the operator is already paying attention, not in `validate`. A backlog that fails validation
because an audit is outstanding would train everyone to ignore `validate`.

## Operator validation

With capability `02`'s audit unrecorded, run `/tickets next` and confirm it refuses and names `02`.
Confirm `/tickets next --all` still lists everything, gated entries marked.
