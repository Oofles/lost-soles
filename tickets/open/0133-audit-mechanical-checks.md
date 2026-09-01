---
id: 133
slug: audit-mechanical-checks
title: tickets.mjs audit <capability>: the mechanical half of the close audit
type: feature
priority: high
status: open
size: m
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-01T04:18:14Z
---

## Description

Split out of [`0121`](0121-tickets-audit-subcommand.md), which is `size: l` in `size: m` clothing:
ten criteria spanning a check runner, a machine-readable audit record, a gate in `next`, and
retroactive audits of two capabilities. This ticket is the first piece — **the mechanical half only**,
`AUDIT.md` §1, the scriptable parts of §4, and §5. It writes nothing and blocks nothing; `0134` adds
the record and `0135` adds the teeth.

`tickets.mjs audit <capability>` runs every check that can be run without judgement and reports
pass / fail / **n/a** per item.

**The n/a rule is the design.** Most of `AUDIT.md` targets application code that does not exist yet —
there is no Vigil test (`0030`), no `rules/`, no fog blob, no ledger, no `src/pipeline`. Capability
`01`'s hand-run audit put it well: *"a checklist that is 60% dishonest ticks is worse than no
checklist."* So a check that cannot run is **n/a with a stated reason**, never a silent pass and never
a tick. This is D-169's lesson in another place: the difference between "checked" and "could not
check" must survive into the output.

## Acceptance criteria

- [ ] `tickets.mjs audit <capability>` runs `AUDIT.md` §1: typecheck, lint, the vitest suite, the
      `node:test` script suite (D-160), the invariant sweep, the boundary greps, the Vigil test, and
      `validate`. Each reports `pass`, `fail` or `na`.
- [ ] **An `na` result carries a non-empty reason naming what would make the check applicable.** A
      check may never return `na` with an empty or generic reason, and there is a test asserting it
      for every check the command can emit.
- [ ] The scriptable §4 regressions are present and correctly `na` today: `explored-r10.bin`
      regenerates, no cell re-fogged, total XP not lower.
- [ ] §5 hygiene runs: no `blocked_by` pointing at a closed ticket, and every ticket in the
      capability is closed. The latter **fails** for `01-ticket-system` today, which is correct — the
      capability has open tickets.
- [ ] The invariant sweep is real, not a placeholder: it parses `I-n` rows from `02-data-model.md`
      §9 and reports which are cited by a test. It is `na` while **no** test cites any invariant, and
      the reason says exactly what turns it on.
- [ ] Exit code is non-zero if any check fails; `na` never fails the run.
- [ ] `--json` emits the full result set for `0134` and the skill to consume.
- [ ] An unknown capability name is refused, listing the capabilities that exist.

## Notes

**Out of scope, deliberately** — these are `0134` and `0135`: the audit record written back to
`docs/capabilities/NN-name.md`, the divergence list and drift budget, the REFLECT check, and `next`
refusing across a capability boundary. This ticket's command is advisory and side-effect-free, which
is what makes it safe to iterate on.

`AUDIT.md` §5's AWS-spend item stays manual — it says *"check the Billing console, not an estimate"*,
and a script that estimated it would be exactly the dishonest tick this ticket is built to avoid.

## Operator validation

Run `node .claude/skills/tickets/scripts/tickets.mjs audit 01-ticket-system` on the laptop and
read the table. Every `na` row must state a reason you find convincing; the "every ticket closed" row
must be red while `0121`, `0134` and `0135` are open.
