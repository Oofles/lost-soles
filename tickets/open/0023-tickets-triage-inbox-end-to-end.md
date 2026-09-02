---
id: 23
slug: tickets-triage-inbox-end-to-end
title: /tickets triage handles inbox files end to end
type: feature
priority: high
status: open
size: m
capability: 03-ticket-capture-endpoint
depends_on: [8, 18]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Captures are useless if they pile up untriaged. `/tickets triage` turns an inbox file into a
numbered open ticket, following `07-ticketsmith.md` §4.5, for each file in `tickets/inbox/`,
**oldest first**:

1. Read the capture. It will be one or two sentences written by someone out of breath.
2. **Batch every clarifying question into one round** — for that note, and for all notes if
   triaging several. Never drip questions. This is the difference between triage being a
   two-minute step and a twenty-minute one.
3. Expand into a real ticket: `## Description`, `## Acceptance criteria` as checkboxes,
   `## Notes`, plus the `bug`/`design` extra sections if the type calls for them, plus
   `## Operator validation` (§3.5).
4. Set `type`, `priority`, `size`, `capability`, `depends_on`. **Keep `source: ui`** and **keep
   the original `created` timestamp** — the idea's age is real information — and keep the
   operator's wording in the Description where it is usable.
5. `tickets.mjs allocate` for the next `NNNN`; derive the immutable slug from the final title.
6. `git mv tickets/inbox/<file> tickets/open/NNNN-slug.md`.
7. Commit once for the batch: `tickets: triage inbox (N items)`.

**Triage has four legitimate outcomes, not one** (§4.5/7): become a ticket; be **merged** into an
existing open ticket's `## Notes`; be **deferred** (left in the inbox with a dated note saying
why); or be **declined** — in which case it still moves to `closed/` with a `## Resolution`
explaining the decline. **Never delete a capture.** A declined idea re-captured three months
later should meet its own previous rejection.

## Acceptance criteria

- [ ] `/tickets triage` lists inbox files oldest-first and processes them in that order.
- [ ] All clarifying questions for the batch are asked in a single round; a transcript of a
      multi-item triage shows one question block, not one per item.
- [ ] A triaged capture emerges in `tickets/open/NNNN-slug.md` with `id`, `slug`, `size`,
      `capability` and `depends_on` populated and `status: open`.
- [ ] `source: ui` is preserved and `created` is byte-identical to the capture's original value.
- [ ] The filename's zero-padded prefix matches the frontmatter `id`, and the filename slug
      matches the frontmatter `slug`.
- [ ] The move is a `git mv` — `git log --follow` on the open ticket reaches the inbox capture.
- [ ] A batch of three produces exactly one commit, message `tickets: triage inbox (3 items)`.
- [ ] The merge outcome appends to an existing ticket's `## Notes` and moves the capture to
      `closed/` with a `## Resolution` pointing at the ticket it was merged into.
- [ ] The defer outcome leaves the file in `tickets/inbox/` with a dated note and no `id`.
- [ ] The decline outcome moves the file to `closed/` with a `## Resolution`; no code path
      deletes a file from `tickets/inbox/`.
- [ ] `tickets.mjs validate` is clean over the repo after a triage run.
- [ ] End to end: a capture dictated to the phone (0020) is triaged by this command into a
      numbered open ticket without any hand-editing of frontmatter.

## Notes

Depends on 0008 for `allocate` / `git mv` / the `tickets(#NNNN):` commit convention, and on 0018
for there being inbox files at all. Triage logic must not re-implement id allocation — a second
allocator is how two tickets end up with the same id.

This is the ticket that closes the loop the roadmap's done-condition names: *an idea dictated to
the phone at the end of a run appears in `tickets/inbox/` within 5 seconds, and `/tickets triage`
turns it into a numbered open ticket.*

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

**Desktop, Claude Code terminal.** After a real run with two or three captures sitting in the
inbox, run `/tickets triage`. Confirm you are asked all your clarifying questions **once**, not
one at a time. Then open the resulting files in `tickets/open/` and check that the Description
still contains recognisably your own words from the run, not a paraphrase — losing the operator's
wording is the failure mode that makes captures feel pointless.
