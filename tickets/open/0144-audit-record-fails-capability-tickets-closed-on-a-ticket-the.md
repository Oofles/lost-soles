---
id: 144
slug: audit-record-fails-capability-tickets-closed-on-a-ticket-the
title: audit --record fails capability-tickets-closed on a ticket the audit itself just filed
type: bug
priority: med
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-02T01:59:37Z
---

## Description

`AUDIT.md` §2 says a divergence resolves one of exactly two ways, and for the code-was-wrong branch:

> **the code was wrong** → file a `bug` ticket, or fix now if trivial

`audit --record`'s §5 mechanical check `capability-tickets-closed` requires every ticket in the
capability to be closed. **So filing the ticket §2 tells you to file makes the audit fail**, on the
capability you are closing, for having done the thing the procedure just asked for.

Hit for real closing capability `02` on 2026-09-02. The audit found that `check-design-tokens.mjs`
does not scan `src/`, filed it as `0142` against `02` (correctly — the script is `0016`'s artifact),
and the immediately-following `--record` went from `8 passed, 0 failed` to
`7 passed, 1 failed — capability-tickets-closed: 1 still open: 0142`. The verdict was already
`forced` on the drift budget, so nothing was concealed, but had the divergence count been three or
fewer the audit would have flipped from `pass` to `forced` purely because its own finding existed.

**The perverse incentive is the point of this ticket.** The three ways out are all worse than the
bug: file the ticket against a *different* capability than the one it belongs to; fix it inline
regardless of size, absorbing unplanned work into an audit; or notice the pattern and stop filing
audit findings as tickets at all. The last is the one that actually happens, quietly, and it defeats
D-153 — the audit exists to convert drift into tracked work.

Note `deferred` is already excluded from this check (D-136/D-174) and the record even prints a
sentence explaining that a capability may pass with deferred work outstanding. The same reasoning
applies to a ticket the audit itself just filed: it is *known* outstanding work, recorded on
purpose, not forgotten work.

## Steps to reproduce

1. Run `audit <cap>` on a capability whose tickets are all closed — the table is green.
2. `create` a ticket against that capability, as AUDIT.md §2 directs for a `code-was-wrong`
   divergence.
3. Re-run `audit <cap>` → `capability-tickets-closed` now FAILs, naming the new ticket.

## Expected vs actual

**Expected:** a ticket filed by the audit, as its own §2 remedy, does not fail the audit that filed
it — the same way `deferred` does not.

**Actual:** it does, and the only clean escapes are to misfile the ticket or not to file it.

## Acceptance criteria

- [ ] A ticket filed as an audit's own §2 resolution does not fail `capability-tickets-closed`.
      How it is identified is the design question — a `source: audit` value, a frontmatter
      reference to the audit that filed it, or comparing `created` against the audit timestamp.
      **Pick one and say why in the Resolution**; timestamp comparison is the tempting one and is
      also the one that silently exempts any ticket filed in the same minute.
- [ ] Whatever the mechanism, it cannot exempt a ticket that merely *happens* to be open — a
      capability with ordinary unfinished work must still fail this check. Exempting by capability
      or by recency alone fails this criterion.
- [ ] The `--record` output states the exemption where it applies, in the same voice as the existing
      `deferred` sentence, so a reader of the capability doc sees the outstanding work rather than
      an unexplained green row.
- [ ] A test covers both directions: an audit-filed ticket does not fail the check, an ordinary open
      ticket does.
- [ ] `AUDIT.md` §2 and §5 are reconciled in prose, so the procedure no longer reads as though it
      contradicts itself.

## Notes

Found by the capability `02` close audit (2026-09-02) and recorded in that capability doc's
`--force` reason as the second of two overrides. Related to `0134` (which built the divergence list
and the drift budget) and `0136`/D-174 (which established the precedent that known-outstanding work
need not fail the check).

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

None expected — this is ticket-system tooling with no user-visible surface. The proof is the test
required by criterion 4.
