---
id: 121
slug: tickets-audit-subcommand
title: /tickets audit — run the capability close audit and refuse to advance until it passes
type: feature
priority: high
status: open
size: m
capability: 01-ticket-system
depends_on: [9, 10]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] `scripts/tickets.mjs audit <capability>` runs AUDIT.md §1 in full and reports pass/fail per
      item: typecheck, lint, tests, the invariant sweep, the boundary greps, the Vigil test,
      `validate`.
- [ ] §4 regression checks run automatically where they are scriptable (`explored-r10.bin`
      regenerates; no cell re-fogged; total XP not lower).
- [ ] §5 hygiene checks run: no `blocked_by` pointing at a closed ticket; every ticket in the
      capability is closed.
- [ ] The skill (0010) drives §2 and §3 interactively: it lists the design sections this
      capability's tickets cited, and **requires an explicit divergence list — an empty list must be
      asserted, never assumed by omission.**
- [ ] **The drift budget is enforced**: more than three divergences fails the audit and prints the
      instruction to run a DESIGN session rather than continue.
- [ ] Each divergence is resolved as `code-was-wrong` (files a ticket) or `design-was-wrong`
      (amends the doc + records a new `D-xxx`). **Neither is not an allowed outcome** — the command
      exits non-zero if any divergence is left unresolved.
- [ ] A capability's REFLECT section must be non-empty before the audit passes.
- [ ] `/tickets next` **refuses to start a ticket in a new capability** while the previous
      capability's audit has not passed, and says which one is blocking.
- [ ] **Bootstrap gap handled.** This command lives in capability `01`, so capabilities `00` and
      `01` necessarily complete before it exists. Enforcement therefore begins at capability `02`.
      As part of this ticket, run the audit **retroactively against `00` and `01`** and append both
      results to their capability docs — otherwise the first two capabilities are the only ones in
      the project that never get audited, and they are the ones everything else rests on.
- [ ] Audit results append to `docs/capabilities/NN-name.md` with a timestamp.

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
