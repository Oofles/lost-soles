---
id: 121
slug: tickets-audit-subcommand
title: /tickets audit — run the capability close audit and refuse to advance until it passes
type: feature
priority: high
status: closed
size: m
capability: 01-ticket-system
depends_on: [9, 10, 133, 134, 135]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-01T04:39:56Z
closed: 2026-09-01T04:43:41Z
---

## Description

**D-153.** `docs/capabilities/AUDIT.md` defines the capability close audit. A checklist nobody runs
is decoration, so this ticket makes it a command and puts it in the path of starting the next
capability.

`/tickets audit <capability>` walks AUDIT.md, running everything machine-checkable and prompting
for the rest.

The mechanical/judgemental split follows the rest of `/tickets` (07-ticketsmith §4): the script runs
tests, greps, ticket validation and cost checks; the model does the design-conformance reading in
§2, which is the part that actually catches drift and cannot be automated.

## Acceptance criteria

- [x] `scripts/tickets.mjs audit <capability>` runs AUDIT.md §1 in full and reports pass/fail per
      item: typecheck, lint, tests, the invariant sweep, the boundary greps, the Vigil test,
      `validate`.
- [x] §4 regression checks run automatically where they are scriptable (`explored-r10.bin`
      regenerates; no cell re-fogged; total XP not lower).
- [x] §5 hygiene checks run: no `blocked_by` pointing at a closed ticket; every ticket in the
      capability is closed.
- [x] The skill (0010) drives §2 and §3 interactively: it lists the design sections this
      capability's tickets cited, and **requires an explicit divergence list — an empty list must be
      asserted, never assumed by omission.**
- [x] **The drift budget is enforced**: more than three divergences fails the audit and prints the
      instruction to run a DESIGN session rather than continue.
- [x] Each divergence is resolved as `code-was-wrong` (files a ticket) or `design-was-wrong`
      (amends the doc + records a new `D-xxx`). **Neither is not an allowed outcome** — the command
      exits non-zero if any divergence is left unresolved.
- [x] A capability's REFLECT section must be non-empty before the audit passes.
- [x] `/tickets next` **refuses to start a ticket in a new capability** while the previous
      capability's audit has not passed, and says which one is blocking.
- [x] **Bootstrap gap handled.** This command lives in capability `01`, so capabilities `00` and
      `01` necessarily complete before it exists. Enforcement therefore begins at capability `02`.
      As part of this ticket, run the audit **retroactively against `00` and `01`** and append both
      results to their capability docs — otherwise the first two capabilities are the only ones in
      the project that never get audited, and they are the ones everything else rests on.
      **Amended at close:** `01`'s record is written in the same commit as this ticket's close, not
      before it. `capability-tickets-closed` cannot be true while this ticket — a capability-`01`
      ticket — is open, so the audit is only truthful once the close has moved it. Stated here
      rather than worked around with `--force`; see `## Resolution`.
- [x] Audit results append to `docs/capabilities/NN-name.md` with a timestamp.

## Notes

**Why this sits in capability `01` and not later:** the audit is worth most early, when drift is
cheap to correct. Putting it after capability `02` would mean the spine — the domain contract, the
adapter boundary, the ingest pipeline — is built before anything checks for divergence.
The cost is the bootstrap gap above, which is paid once, explicitly, by a retroactive run.


The last criterion is the one that gives this teeth. Without it the audit is advisory and will be
skipped precisely when it matters most — under time pressure, late in the build, when drift has
already accumulated.

`/tickets audit --force` may override for a genuine emergency, but it records the override in the
capability doc with a reason. Make skipping visible rather than impossible.

## Operator validation

Run `/tickets audit 00-preflight-and-repo` once capability `00` is complete. It must fail cleanly
if you delete a required section from a capability doc, and pass once restored. Then try
`/tickets next` on a capability-`01` ticket with `00` unaudited and confirm it refuses and names
the blocker.

## Resolution

**Split into three tickets before any code was written.** `0121` was `size: m` carrying ten criteria
across four separable pieces of work. Building all four in one pass would have produced a shallow
audit command and a rubber-stamped retroactive audit — the anti-rubber-stamping tool, rubber-stamped.
Operator-directed after the size was raised:

| | | |
|---|---|---|
| `0133` | the mechanical half — §1, scriptable §4, §5 | D-171, three verdicts |
| `0134` | the record, the divergence list, the drift budget, REFLECT | D-172 |
| `0135` | `next` refusing across a capability boundary | D-173 |
| `0121` | this ticket — the retroactive run that closes the bootstrap gap | |

Criteria 1–8 are satisfied by those three; this ticket's own work is criteria 9 and 10.

### The retroactive audits

**Capability `00` — recorded `pass`, 3 divergences, exactly at the budget.** D-155 (husky →
`.githooks`), D-156 (GitHub secret scanning unavailable), and `0125` (the pre-commit hook had no
test and a silent edit had disabled a layer) — the third added by this audit, since it closed after
the 2026-08-30 hand run. `0122` is deliberately **not** counted: nothing in the design spoke to a
dormant access key, so it is §5 hygiene, filed and settled as D-168.

**Capability `00`'s outstanding §3 item is resolved rather than inherited.** The hand audit left
ticket `0004`'s operator validation ⏳ — the operator had never opened the repo in a browser — and it
was still outstanding today, its `## Operator validation` still the instruction rather than a
result. Half of it is now void: *"confirm it is private"* is superseded by **D-165**, which made the
repository public deliberately. The rest is verified objectively against `origin/main` — `docs/`,
`tickets/` and `.githooks/` present, `.claude/settings.local.json` appearing **zero** times anywhere
in the tree, `.env.example` holding only placeholders.

That is recorded as an **agent** verification with the reasoning exposed, not as an operator result.
The distinction matters and cuts the other way from `0017`: there, the browser showed what a *user*
actually receives and no agent could stand in for it. Here nothing is visible in a rendered file
list that `git ls-tree origin/main` does not show more precisely.

**Capability `01` — recorded `pass`, 3 divergences, exactly at the budget.** The two from the hand
audit are now resolved (`0126`→D-170 design-was-wrong; `0127` code-was-wrong), and one is added:
`0010` closed on an operator-verifiable criterion that was ticked without verification, which
§3.5 forbade in spirit and nothing enforced — design-was-wrong, amended in §3.3.1 and §4.6 as D-169.

### The judgement this audit turns on, stated so it can be overruled

**`0123`'s invalid `SKILL.md` frontmatter is not counted as a divergence.** The frontmatter
reproduced `07-ticketsmith.md` §4.2's example byte-for-byte — `0010`'s criterion demanded exactly
that, and a programmatic check confirmed it. The implementation did not differ from the design; the
design shipped invalid YAML as its own example. A design defect found by other means is not
implementation drift, and both halves were corrected in one commit.

**Judge otherwise and capability `01` is at four divergences and owes a DESIGN session on
`07-ticketsmith.md`.** Four defects in one spec is exactly the signal the budget exists to raise, so
this call is written in the capability doc and here rather than buried in a count.

### Why `01`'s record lands in the close commit

The mechanical check `capability-tickets-closed` fails while any ticket in the capability is open —
and `0121` is a capability-`01` ticket. The audit of `01` is therefore only truthful *after* this
ticket has moved to `closed/`. So the order is: record `00`, commit the judgement work, close
`0121`, record `01`, commit both together.

`--force` would have made it one step. It was not used: forcing an audit to work around a
precondition that is *correct* would be the first entry in a habit this whole chain exists to
prevent, and D-172 records `verdict: forced` precisely so that would have been visible forever.
The criterion was amended to state the ordering instead.

### The gate, before and after

Before this ticket, `next` gated 12 of 13 ready tickets on `00-preflight-and-repo` and handed over
only `0121` — the ticket that clears the gap. After both records land, capability `02` onward is
ungated. The system pointed at its own remedy and then unlocked itself, which is the behaviour
D-173 was written for.

**Capability `01` is closed with this ticket.**

## Operator validation — 2026-09-01

- `tickets.mjs audit 00-preflight-and-repo --record …` → `verdict: pass`, written to the capability
  doc with a parseable record line. ✔
- `tickets.mjs audit 01-ticket-system --record …` → run after the close, `verdict: pass`. ✔
- `git ls-tree origin/main` verifying `0004`'s three substantive claims. ✔
- `tickets.mjs next` before the records: 12 gated on `00-preflight-and-repo`, `0121` handed over.
  After: capability `02` ungated. ✔

Agent-run, laptop. **One thing genuinely wants your eye rather than mine**, and it is not a command
to run: the `0123` judgement above. If you count it as a divergence, capability `01` is over budget
and the correct next action is a DESIGN session on `07-ticketsmith.md`, not capability `02`. I have
made the call and written the reasoning where it can be found; overruling it is a one-line change to
the capability doc and a re-record.
