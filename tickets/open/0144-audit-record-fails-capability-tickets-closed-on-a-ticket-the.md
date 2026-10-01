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
started: 2026-10-01T00:42:23Z
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

- [x] A ticket filed as an audit's own §2 resolution does not fail `capability-tickets-closed`.
      How it is identified is the design question — a `source: audit` value, a frontmatter
      reference to the audit that filed it, or comparing `created` against the audit timestamp.
      **Pick one and say why in the Resolution**; timestamp comparison is the tempting one and is
      also the one that silently exempts any ticket filed in the same minute.
- [x] Whatever the mechanism, it cannot exempt a ticket that merely *happens* to be open — a
      capability with ordinary unfinished work must still fail this check. Exempting by capability
      or by recency alone fails this criterion.
- [x] The `--record` output states the exemption where it applies, in the same voice as the existing
      `deferred` sentence, so a reader of the capability doc sees the outstanding work rather than
      an unexplained green row.
- [x] A test covers both directions: an audit-filed ticket does not fail the check, an ordinary open
      ticket does.
- [x] `AUDIT.md` §2 and §5 are reconciled in prose, so the procedure no longer reads as though it
      contradicts itself.

## Notes

Found by the capability `02` close audit (2026-09-02) and recorded in that capability doc's
`--force` reason as the second of two overrides. Related to `0134` (which built the divergence list
and the drift budget) and `0136`/D-174 (which established the precedent that known-outstanding work
need not fail the check).

## Resolution

**Mechanism: the `--record` call's own divergence list (D-262).** None of the three options the
ticket offered. An open ticket in the capability is exempt from `capability-tickets-closed` only when
the same `--record` names it in `--divergence "code-was-wrong|<id>|…"`. Why:

- **It is the audit's own record, so there is nothing new to keep honest.** `source: audit` or a
  frontmatter back-reference would add a field that outlives the audit. Timestamp comparison is
  recency by another name, the failure the ticket warned about.
- **Criterion 2.** A ticket that just happens to be open is not named as a divergence, so it still
  fails, including alongside a named one (tested). Someone *could* name an ordinary unfinished
  ticket to get a pass. It would show up in the record as a divergence, and it would spend one of
  the three slots in the drift budget. That cost is the deterrent; I judged it enough for a
  single-operator project.
- **The plain `audit <cap>` table cannot know**, because it has no divergences. It still fails, and
  the row now says how the exemption works (`… — one filed as this audit's own code-was-wrong
  finding is exempted by naming it in --record --divergence`).

**Files**
- `.claude/skills/tickets/scripts/tickets.mjs`
  - `auditChecks` takes `filedByAudit`.
  - The check splits open tickets into "still open" and "filed by this audit", and names both in
    the row.
  - Divergence parsing moved out of `cmdAudit` into `recordDivergences` and now runs *before* the
    checks. Side effect: a `--record` missing its divergence assertion is refused before the slow
    npm checks run, not after.
  - The record writes a **"Filed by this audit, and therefore excluded from
    `capability-tickets-closed`"** sentence, in the voice of the deferred one, plus `filed: [...]`
    in the `audit-record` JSON. The key appears only when non-empty, so older records still compare
    equal.
  - Refs are parsed as integers (`0142` and `#0142` both work). A `design-was-wrong` ref is never
    treated as a ticket.
- `.claude/skills/tickets/scripts/tickets.test.mjs`: one new test covering both directions:
  - the plain table fails and shows the hint;
  - a named ticket passes with verdict `pass` and `filed: ["0002"]`, and the doc sentence is
    written;
  - an unnamed open ticket next to the named one still fails, and the refused record writes
    nothing;
  - a design-was-wrong ref exempts nothing.

  Full suite 182/182.
- `docs/capabilities/AUDIT.md`: §2's code-was-wrong branch now says to name the ticket in
  `--record` and that this exempts it. §5 gains the `capability-tickets-closed` row with both
  exceptions (D-174, D-262), so the two sections no longer contradict each other.
- `docs/decisions/DECISIONS.md`: **D-262**.

**Left alone, on purpose.** `openInCapability`, which also drives `next`'s `0209` gate, is
unchanged. If an audit files a ticket and then its `--record` is refused for some other reason (for
example a placeholder REFLECT), `next` tells you to work that ticket rather than re-run the audit.
That is no worse than before this ticket, and a passing record lifts the gate. Changing it would
have widened the scope.

## Operator validation

None needed from the operator: this is ticket-system tooling with no screen. Agent smoke test,
2026-09-30, real repo: `tickets.mjs audit 01-ticket-system` prints
`FAIL capability-tickets-closed 5 still open: 0144, 0145, 0153, 0176, 0227 — one filed as this
audit's own code-was-wrong finding is exempted by naming it in --record --divergence`, which is
the hint, live. The exemption itself is proved in both directions by the new test, not run against
the real capability doc, because a real `--record` would append an audit record to
`01-ticket-system.md` that nobody performed. `validate`: 0 errors.
