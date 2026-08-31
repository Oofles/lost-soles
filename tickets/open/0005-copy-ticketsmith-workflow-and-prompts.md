---
id: 5
slug: copy-ticketsmith-workflow-and-prompts
title: Copy TicketSmith WORKFLOW.md, TEMPLATE.md and the three prompt files, with two edits
type: docs
priority: med
status: open
size: s
capability: 00-preflight-and-repo
depends_on: [3]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

`07-ticketsmith.md` §7.2: `WORKFLOW.md`, `TEMPLATE.md` and the three prompt files are **copied
wholesale from TicketSmith**. They are MIT-licensed, so this is a licensing non-event provided the
copyright notice is retained, and they are project-agnostic by design — they cost nothing to adopt
and they are the part of TicketSmith that is the actual value (§1.2).

Destinations:

```
docs/capabilities/WORKFLOW.md         # the capability lifecycle + anti-patterns
docs/capabilities/TEMPLATE.md         # the capability doc template
prompts/CAPABILITY_DESIGN.md
prompts/CONSOLIDATION_PASS.md
prompts/ARCHITECTURE_REVIEW.md
```

**Only two edits are permitted**, and they are the same two everywhere they apply:

1. **Point every reference at `docs/decisions/`** (a directory containing `DECISIONS.md` plus
   per-decision ADR files) rather than a single `docs/DECISIONS.md` at the docs root. This project's
   decision register is already a directory and stays one: an agent appends decisions constantly, and
   one file per decision avoids repeated edits to a growing shared file.
2. **Add the `inbox` state** to `WORKFLOW.md`'s description of the ticket lifecycle. TicketSmith has
   three states; Lost Soles has four, because D-092 requires phone capture and captures land
   unnumbered in `tickets/inbox/` until triage. The lifecycle reads
   `inbox → open ⇄ blocked → closed`, with `open` and `blocked` both living in `open/`.

Anything else stays byte-for-byte. Resist the urge to "improve" these files: the whole point of
copying them is that they encode a method that has already been argued out, and local edits are how
a borrowed method quietly becomes a different one.

## Acceptance criteria

- [ ] All five files exist at the paths above.
- [ ] Each copied file retains TicketSmith's MIT copyright notice, either inline at the top or in a
      `docs/capabilities/LICENSE-TICKETSMITH` referenced from each file.
- [ ] `grep -rn 'docs/DECISIONS.md' docs/capabilities prompts` returns **no hits** — every reference
      points at `docs/decisions/` or `docs/decisions/DECISIONS.md`.
- [ ] `docs/capabilities/WORKFLOW.md` describes a four-state lifecycle including `inbox`, and states
      that `open` and `blocked` share the `open/` folder with `blocked` derived from a non-empty
      `blocked_by`.
- [ ] `docs/capabilities/WORKFLOW.md` retains TicketSmith's anti-pattern list, including *"closing
      tickets without honest operator validation"* — the sentence `07-ticketsmith.md` §3.5 quotes:
      *"If the validation section is always 'None,' nobody is checking the work. That's not
      validation; that's hope."*
- [ ] A `diff` of each copied file against its upstream original is recorded in
      `docs/capabilities/00-preflight-and-repo.md`, and every hunk in every diff is one of the two
      permitted edits. No third category of change appears.
- [ ] `docs/capabilities/TEMPLATE.md` is the template 0006 and every later capability doc is written
      from — its section headings match what the capability docs actually use.

## Notes

`docs/capabilities/ROADMAP.md` is **ours, not TicketSmith's** — it records which capability is next,
not their designs — and it is created by 0003, not by this ticket.

TicketSmith's `/tickets` is a `.claude/commands/*.md` command file. We deliberately do **not** copy
that: 0010 builds a project *skill* instead, because only skills get supporting-file directories and
helper scripts (`07-ticketsmith.md` §4.1). The command file is the one piece of TicketSmith that is
correctly left behind.

The `## Operator validation` idea comes from these files and is the single best thing in them
(§3.5). Do not weaken it while transcribing.

## Operator validation

1. On the laptop, open `docs/capabilities/WORKFLOW.md` in an editor and read the lifecycle section.
   The word `inbox` appears and the four states are described in order.
2. In a desktop browser on GitHub, open each of the five files and confirm the MIT notice is visible
   without scrolling past the first screen.
3. Practical check, and the one that actually matters: hand an agent `docs/capabilities/TEMPLATE.md`
   and ask it to start a capability doc for `00-preflight-and-repo`. If it produces the right shape
   without asking clarifying questions about the format, the copy is complete and correct.
