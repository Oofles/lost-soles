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
started: 2026-09-01T04:20:34Z
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

- [x] `tickets.mjs audit <capability>` runs `AUDIT.md` §1: typecheck, lint, the vitest suite, the
      `node:test` script suite (D-160), the invariant sweep, the boundary greps, the Vigil test, and
      `validate`. Each reports `pass`, `fail` or `na`.
- [x] **An `na` result carries a non-empty reason naming what would make the check applicable.** A
      check may never return `na` with an empty or generic reason, and there is a test asserting it
      for every check the command can emit.
- [x] The scriptable §4 regressions are present and correctly `na` today: `explored-r10.bin`
      regenerates, no cell re-fogged, total XP not lower.
- [x] §5 hygiene runs: no `blocked_by` pointing at a closed ticket, and every ticket in the
      capability is closed. The latter **fails** for `01-ticket-system` today, which is correct — the
      capability has open tickets.
- [x] The invariant sweep is real, not a placeholder: it parses `I-n` rows from `02-data-model.md`
      §9 and reports which are cited by a test. It is `na` while **no** test cites any invariant, and
      the reason says exactly what turns it on.
- [x] Exit code is non-zero if any check fails; `na` never fails the run.
- [x] `--json` emits the full result set for `0134` and the skill to consume.
- [x] An unknown capability name is refused, listing the capabilities that exist.

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

## Resolution

**`.claude/skills/tickets/scripts/tickets.mjs`** — a new `audit <capability>` command, ~170 lines.
Twelve checks across `AUDIT.md` §1, §4 and §5, each returning `pass`, `fail` or `na`, printed as a
table grouped by section and also available as `--json` for `0134`. Exit 1 if anything failed;
`na` never fails.

Against the real repo today:

```
audit 00-preflight-and-repo    8 passed, 0 failed, 4 n/a
audit 01-ticket-system         7 passed, 1 failed, 4 n/a
                               FAIL capability-tickets-closed — 4 still open: 0121, 0133, 0134, 0135
```

Capability `01`'s failure is correct and is the point: it has open tickets, so its audit cannot pass.
Capability `00`'s mechanical half is green.

**The three-verdict model is recorded as `D-171`.** The reason attached to an `na` is the
load-bearing half, not the verdict — `na` with no reason is indistinguishable from a skip, and a skip
is how a check disappears. Every `na` names its activation condition ("ticket `0030` puts the Vigil
test permanently in CI", "activates as soon as one test names an `I-n`"), so the audit doubles as a
list of what the project has not yet earned the right to check. This is D-169 one layer up: the
output must preserve the difference between *checked* and *could not check*.

**The invariant sweep is real rather than a placeholder.** It parses the `| **I-n** |` rows out of
`02-data-model.md` §9 — 30 of them, 12 marked `[S]` — and reports which are cited by a test. It stays
`na` while none are, because 30 failures on a repo with no domain model is noise that trains everyone
to ignore the row.

### The sweep tripped on its own test fixture

Caught by running the finished command against capability `00`, which failed with *"28/30 invariants
have no citing test"*. Nothing was wrong with the backlog: the sweep scanned the whole repo, and
**this ticket's own test file contains `| **I-1** |` rows as fixture data**. The check was activated
by the string that describes it.

Fixed by scoping the scan to the application roots — `src/`, `app/`, `lib/`, `scripts/` — which is
where invariants are actually enforced; the ticket tooling under `.claude/` is not. There is a
regression test that a citation outside those roots does not activate the sweep.

Worth recording beyond the fix: this is the second time today a check has been tripped or nearly
tripped by text *about* the check rather than a real instance of it — the first was `0126`'s probe
`sed`-ing the wrong type. Both were caught by running the thing against reality rather than reading
it.

**Tests** — 9 new cases (83 total, was 74). The one carrying the design is the assertion that **every
`na` result has a reason** longer than a token and phrased to name an activation condition, checked
across every `na` the command can emit on a bare repo. Also: `na` alone exits 0; an open ticket in
the capability fails and is named; a `blocked_by` pointing at a closed ticket fails §5; the sweep's
three states (`na` → `fail` naming only the uncited → `pass`); the fixture-scoping regression; an
unknown capability is refused with the real list; and the printed table names §2/§3/§6 as not run.

**Docs** — `07-ticketsmith.md` §4.3 gains the `/tickets audit` row (normative), `reference.md` gains
the command and an "audit and the three verdicts" section, and `SKILL.md` gains an `audit` routing
row whose instruction is *"a green table is not a passed audit — say which halves did not run."*
`SKILL.md`'s frontmatter was edited to list the new subcommand; additively, with no `: ` introduced
into a plain scalar, and `check-skills.mjs` re-run (`0123`'s failure mode).

**Deliberately not done** — this command writes nothing and gates nothing. The recorded result,
divergence list and drift budget are `0134`; `next` refusing across a capability boundary is `0135`.
`AUDIT.md` §5's AWS-spend item stays manual, because it says *check the Billing console, not an
estimate*, and a script that estimated it would be the dishonest tick this ticket exists to prevent.

## Operator validation — 2026-09-01

Ran `node .claude/skills/tickets/scripts/tickets.mjs audit 01-ticket-system` and
`audit 00-preflight-and-repo` on the laptop and read both tables.

- Every `n/a` row states a reason naming what activates it. The four today are the Vigil test
  (`0030`), the fog blob (capability `07`), the XP ledger (capability `09`), and the invariant sweep
  (first test to cite an `I-n`). All four are true statements about this repo.
- `capability-tickets-closed` is red for `01` while `0121`, `0133`, `0134` and `0135` are open, and
  green for `00` where all 9 are closed. Both are correct.
- Exit codes: 1 for `01`, 0 for `00`.

Agent-run, laptop. No `(operator)` criterion: this is a CLI reporting on a repo, and the one thing a
human would add — judging whether each `n/a` reason is *convincing* — I have written out above for
you to disagree with rather than asserted as checked.
