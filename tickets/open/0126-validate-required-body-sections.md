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

- [x] `07-ticketsmith.md` §4.7's error list is amended to include the body-section rule, with a
      `D-xxx` in `DECISIONS.md` recording why §3 and §4.7 disagreed and which now governs.
- [x] `validate` errors when any non-inbox ticket is missing `## Description`, `## Acceptance
      criteria`, `## Notes`, or `## Operator validation`.
- [x] The `type`-conditional rules are expressed as a single type→sections table alongside the
      existing `bug` rule, not as another hand-rolled `if`, and `design` gets `## Options considered`
      and `## Open questions`.
- [x] Inbox tickets are exempt — they are free-form captures by design (`07-ticketsmith.md` §2.3).
- [x] Each of the four probes above is re-run against a scratch copy and now produces an error.
- [x] `validate` over the real backlog still exits 0 with no new errors. Any error it does surface is
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

## Resolution

**`.claude/skills/tickets/scripts/tickets.mjs`** — the two hand-rolled body-structure checks (the
`closed` pair and the `bug` pair) are replaced by one `SECTION_RULES` table of
`{rule, applies, sections}`, read by a `missingSections(fm, body, folder)` helper that returns `[]`
for `inbox` and otherwise every missing section with the rule name that owns it. Rule names stay
distinct — `missing-section`, `bug-section`, `design-section`, `closed-section` — because "this bug
has no repro steps" and "this ticket has no body" want different reactions from whoever reads the
output. `closed-section` now covers only `## Resolution`; `## Operator validation` moved into the
base set, since it is required everywhere now.

**The four probes from the description were re-run against a scratch copy of the real backlog** and
all four now produce errors: `## Operator validation` renamed away, `## Description` + `## Acceptance
criteria` renamed away, the body deleted entirely (four errors, one per section), and `type: design`
with no `## Options considered` / `## Open questions`. `validate` over the real `tickets/` still
exits 0 — **no ticket in the backlog needed fixing**, as 0011's audit predicted.

**One probe was wrong before the rule was.** The first `design` attempt reported exit 0 and looked
like the rule failing; the mutation was a no-op, because it `sed`-ed `type: chore` on a ticket that
is `type: feature`. Re-run correctly it errors as expected. Recorded because a probe that passes for
the wrong reason is exactly the failure `0123` warned about, and it nearly went the other way here.

### The inbox exemption fixed a live bug, not a hypothetical one

Criterion 4 was written as a precaution. It is not. The `bug` rule ran in **every** folder, so an
inbox capture with `type: bug` and no `## Steps to reproduce` failed validation — and the inbox
format has no such section by design (§2.3). Proven against the pre-change code before touching it:

```
ERROR  tickets/inbox/…-fog-flickers.md  [bug-section]  bug ticket is missing '## Steps to reproduce'
ERROR  tickets/inbox/…-fog-flickers.md  [bug-section]  bug ticket is missing '## Expected vs actual'
```

"Fog flickers when panning" typed on a phone at mile six is the single most likely capture this
project will ever receive, and it turned the whole backlog red. Nobody hit it because no `type: bug`
capture has been made yet. There is a regression test.

### `triage-move` now leaves a promoted capture failing validate — deliberately

Found while checking the interaction rather than predicted by the ticket. A promoted capture has
only `## Description`, so it lands in `open/` missing three required sections.

Put to the operator, because the alternative was reasonable: `triage-move` could append a
`- [ ] TODO` skeleton the way `create` does, keeping the workflow green. **Decided against.** An
unfinished triage would then validate clean, and a green tick on an empty criterion is D-169's
failure wearing a different hat. A promoted capture is not yet a ticket, and the error is the gate.
Recorded in D-170 and in `reference.md` so it reads as a decision rather than a bug, with a test
asserting it.

The existing "preserves the body byte-for-byte" triage test is untouched, which was the other reason
to prefer this direction — that assertion is deliberate and worth keeping.

**Tests** — 10 new cases (68 total, was 58). Each base section asserted **individually**, since a
rule that only fired when all four were absent would pass a single-section test and miss every
realistic case; the frontmatter-only probe asserting all four are named, not just the first; the
`design` pair; the inbox exemption including the `type: bug` capture; `missingSections` returning
`[]` for inbox directly; `closed-section` still owning `## Resolution`; the `triage-move` behaviour
above; and **everything `create` emits, `validate` accepts, for all six types** — the generator and
the validator disagreeing is how this drift survived, so they are now asserted against each other.

**Docs** — `07-ticketsmith.md` §4.7's error list amended with a note on why the amendment happened
(normative), `TICKET_FORMAT.md`, `reference.md`, and **`D-170`** in `docs/decisions/DECISIONS.md`.

**Not done:** nothing was deferred, and no follow-up ticket was filed.

## Operator validation — 2026-09-01

**Both checks were run by the agent, and neither needed a human.** Stated plainly rather than
dressed up, since D-169 landed an hour ago and the temptation it guards against is the one where a
check gets described in a way that implies more than happened.

1. Body deleted from a ticket in a scratch copy of `tickets/open/` → `validate` exits 1 naming that
   file and all four missing sections. ✔
2. The same command against the real `tickets/` → **0 errors, 0 warnings**, exit 0. ✔

Neither is device- or screen-dependent — this is a validator running on a laptop, and there is no
`(operator)` criterion on this ticket because inventing one would be ceremony. The nearest thing to
a human-only check here is whether the refusal *reads* usefully when triage is left half-finished;
the message names the missing sections and the file, and is asserted by test.
