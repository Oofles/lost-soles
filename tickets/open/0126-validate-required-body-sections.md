---
id: 126
slug: validate-required-body-sections
title: validate: enforce required body sections on every ticket, not just closed ones
type: chore
priority: med
status: open
size: s
capability: 01-ticket-system
depends_on: [11]
blocked_by: []
source: agent
created: 2026-08-31T03:12:16Z
---

## Description

Found by 0011's deliberate-error injection pass. `validate()` checks body structure in only two
places: closed tickets must have `## Resolution` and `## Operator validation`, and `type: bug`
tickets must have `## Steps to reproduce` and `## Expected vs actual`. Everything else about a
ticket body is unchecked.

Four probes against a scratch copy of the backlog, each expected to fail validation, all passed
clean with exit 0:

- an **open** ticket with `## Operator validation` renamed away — not caught
- an open ticket with **both** `## Description` and `## Acceptance criteria` renamed away — not caught
- a ticket whose body was **deleted entirely**, leaving frontmatter only — not caught
- a `type: design` ticket with no `## Options considered` / `## Open questions` — not caught
  (no `design` tickets exist in the backlog today, so this one is latent rather than live)

The third is the one that matters: a ticket file can carry a perfectly valid frontmatter block, no
body at all, and the validator will call the backlog clean.

**This is a gap in the design, not a defect in the code.** `07-ticketsmith.md` §4.7 lists the
validation rules, and `tickets.mjs` implements all 13 errors and all 5 warnings faithfully — 0011's
audit confirmed that line by line. But §3 makes the four body sections normative for *every* ticket,
and §4.7's list has no rule for them. Two sections of the same document disagree about whether an
empty body is valid.

So this ticket has to settle the design question before it changes any code: **§4.7 gains the rule,
and the change is recorded as a `D-xxx` amending the spec** — not a silent extension of the
validator beyond what the doc authorises. That ordering matters; it is the D-153 rule (the code
changes or the doc changes, never neither) applied to a disagreement *inside* the doc.

This is deliberately scoped to the **validator**, not the backlog: the current 125 tickets all have
their four sections (verified during 0011), so turning this check on should not produce a single new
error. If it does, that is a genuine find and each one gets fixed in the ticket.

## Acceptance criteria

- [ ] `07-ticketsmith.md` §4.7's error list is amended to include the body-section rule, with a
      `D-xxx` in `DECISIONS.md` recording why §3 and §4.7 disagreed and which now governs.
- [ ] `validate` errors when any non-inbox ticket is missing `## Description`, `## Acceptance
      criteria`, `## Notes`, or `## Operator validation`.
- [ ] The `type`-conditional rules are expressed as a single type→sections table alongside the
      existing `bug` rule, not as another hand-rolled `if`, and `design` gets `## Options considered`
      and `## Open questions`.
- [ ] Inbox tickets are exempt — they are free-form captures by design (`07-ticketsmith.md` §2.3).
- [ ] Each of the four probes above is re-run against a scratch copy and now produces an error.
- [ ] `validate` over the real backlog still exits 0 with no new errors. Any error it does surface is
      fixed in the ticket file, and named in this ticket's `## Resolution`.

## Notes

Filed by 0011 under D-152 rather than fixed inline: 0011's own instruction is that fixes go in the
tickets, not the validator, and that a rule which seems wrong is a separate argument. Extending the
validator is squarely "a separate argument", so it is a separate ticket.

Note that `create` already **emits** the right sections per type — including `## Options considered`
and `## Open questions` for a `design` ticket, which the 0008 tests cover. So the generator and the
validator disagree: one writes sections the other does not require. Making `validate` enforce what
`create` already produces is the smallest coherent fix.

Related to [[0123]] in kind — both are cases where the format spec and what the tooling actually
enforces had drifted apart.

## Operator validation

1. On the laptop, delete the whole body of a ticket in a scratch copy of `tickets/open/`, run
   `node .claude/skills/tickets/scripts/tickets.mjs validate`, and watch it exit 1 naming that file.
2. Run the same command against the real `tickets/` and confirm it still exits 0.
