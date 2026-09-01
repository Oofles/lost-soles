---
id: 134
slug: audit-record-and-drift-budget
title: The audit record: a parseable result block, the explicit divergence list, and the drift budget
type: feature
priority: high
status: open
size: m
capability: 01-ticket-system
depends_on: [133]
blocked_by: []
source: agent
created: 2026-09-01T04:18:14Z
---

## Description

Split out of [`0121`](0121-tickets-audit-subcommand.md). `0133` makes the mechanical checks runnable;
this ticket makes an audit a **recorded result** rather than a command someone ran once, and adds the
judgemental half's enforcement.

The audit result appends to `docs/capabilities/NN-name.md` in a block the script can parse back out,
because `0135` has to answer "has capability `01` passed its audit?" without a human in the loop.

## Acceptance criteria

- [ ] An audit writes a timestamped, **machine-parseable** result block to
      `docs/capabilities/NN-name.md`, and the script can read it back. The format is recorded as a
      `D-xxx` — it becomes load-bearing for `0135`, so it is a decision, not an implementation detail.
- [ ] The skill drives `AUDIT.md` §2 and §3 interactively: it lists the design sections this
      capability's tickets cited, and **requires an explicit divergence list. An empty list must be
      asserted, never assumed by omission.**
- [ ] Each divergence is resolved as `code-was-wrong` (files a ticket) or `design-was-wrong` (amends
      the doc and records a `D-xxx`). **Neither is not an allowed outcome** — the audit exits
      non-zero while any divergence is unresolved.
- [ ] **The drift budget is enforced**: more than three divergences fails the audit and prints the
      instruction to run a DESIGN session rather than continue.
- [ ] A capability's REFLECT section must be non-empty before the audit passes.
- [ ] `--force` overrides a failing audit **and records the override, with its reason, in the
      capability doc.** Skipping is visible, not impossible.

## Notes

The existing hand-run audits in `00-preflight-and-repo.md` and `01-ticket-system.md` are the format's
first readers — whatever block shape is chosen has to sit alongside them without making them look
malformed, or `0121`'s retroactive run turns into a rewrite of both documents.

## Operator validation

Delete the REFLECT section from a scratch copy of a capability doc and confirm the audit fails
naming it; restore it and confirm it passes. Then assert an empty divergence list explicitly and
confirm that is accepted, while omitting the list entirely is not.
