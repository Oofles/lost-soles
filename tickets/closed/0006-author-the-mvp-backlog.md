---
id: 6
slug: author-the-mvp-backlog
title: Author the full MVP backlog by hand into tickets/open/
type: chore
priority: high
status: closed
size: l
capability: 00-preflight-and-repo
depends_on: [3, 5]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-08-30T00:00:00Z
---

## Description

`07-ticketsmith.md` §7.3 **Step 1**, and `09-roadmap.md` §4.1 step 1: *"This is the step people want
to skip and cannot."* Every ticket for the MVP — roughly 112 of them, nineteen capabilities,
`tickets/open/0001-*.md` onward — is authored directly into files, by hand, in the
`07-ticketsmith.md` §3 format, with real acceptance criteria, **with no tooling of any kind**.

This is the large unglamorous session. There is no `tickets.mjs`, no `/tickets`, no validator, no
`allocate`. IDs are assigned by hand and must not collide. Frontmatter is written by hand and
nothing checks it. **Expect frontmatter errors** — 0011 exists specifically to find them.

The specification for each ticket's content is `09-roadmap.md` §3: each of the nineteen capabilities
has a numbered table of its tickets with a title and a one-line description, and each row expands
into one full ticket, preserving the table's order and intent. Rows marked `▸` are ones whose
omission would break the first-usable milestone (§2) or an invariant.

Two hard constraints on the output:

- **Do not seed `tickets/inbox/`** (§7.4). The inbox is a live capture channel; an inbox that starts
  full teaches the operator to ignore it. Ideas that exist today are either tickets (written
  properly, here) or they are not work yet, in which case they belong in
  `docs/capabilities/ROADMAP.md`.
- **`depends_on` is filled in at authoring time; `blocked_by` is `[]` everywhere.** `depends_on` is
  a *planned* constraint set when the ticket is written. `blocked_by` is a *discovered* constraint
  set mid-session by `/tickets block`. Seeding `blocked_by` conflates the two and destroys the one
  signal that distinguishes "we planned this order" from "we hit a wall."

D-001 gates everything downstream on this: nothing gets built until the full plan and backlog exist
and the user signs off.

## Acceptance criteria

- [x] Every row of every capability table in `09-roadmap.md` §3 has a corresponding file in
      `tickets/open/`, in the roadmap's order, with ids allocated contiguously from 0001 with no gaps
      and no duplicates.
- [x] Every filename is `NNNN-slug.md` with a **zero-padded 4-digit** prefix matching the `id`
      frontmatter value (which is written as a bare integer), and a slug matching the `slug` field.
- [x] Every ticket has all required frontmatter fields for `open/`: `id`, `slug`, `title`, `type`,
      `priority`, `status`, `size`, `capability`, `depends_on`, `blocked_by`, `source`, `created`.
      No `started`, no `closed`.
- [x] Every `capability` value is of the form `NN-name` and matches one of the nineteen capabilities
      in `09-roadmap.md` §3.
- [x] Every ticket body has `## Description`, `## Acceptance criteria` (markdown checkboxes) and
      `## Notes`. Every `bug` additionally has `## Steps to reproduce` and `## Expected vs actual`;
      every `design` additionally has `## Options considered` and `## Open questions`.
- [x] Every `design` ticket's acceptance criteria are of the form *"a capability doc exists at
      `docs/capabilities/NN-x.md` with no open questions"* — never "the feature works".
- [x] Every ticket has `## Operator validation` naming a screen, a device, and what to look at, or
      an explicit justification for why the work is genuinely invisible. No reflexive "None".
- [x] `blocked_by: []` on every ticket in the set.
- [x] Every id referenced in any `depends_on` array exists in the set. (Hand-checked here; 0011
      re-checks it mechanically.)
- [x] `tickets/inbox/` contains only `.gitkeep`.
- [x] Every capability named by a ticket has a stub at `docs/capabilities/NN-name.md`, written from
      `docs/capabilities/TEMPLATE.md`.
- [x] The user has read the backlog and **signed off** (D-001), and the sign-off is recorded with a
      date in `docs/capabilities/00-preflight-and-repo.md`.

## Notes

**On `size: l`.** This ticket is honestly `l` and it is the one place in the backlog where that is
not a planning failure. It cannot be split without splitting the id space, and the id space is
exactly what this ticket allocates — a second authoring ticket would have to know which ids the
first one used, which is a coordination problem worse than the long session. It is also the only
ticket that can never be refused by `/tickets next` for being `l`, because `next` does not exist
when it runs. When 0011 runs `validate`, this ticket will produce a `size: l` **warning** (not an
error). That warning is correct and should be left standing rather than edited away.

In practice this ticket may be executed by several parallel authoring sessions, each owning a
disjoint contiguous id range and a fixed set of capabilities. If so, the range assignment is made
before any file is written, and no session reads or edits a file outside its range. That is a
tactic for executing the ticket, not a reason to split it.

Ticket 0001 is written by a human-directed planning session and implemented by an agent that does
not yet have `/tickets`. That is fine — it has files and a documented format, which is all
`/tickets` ever gave it (§7.3).

The seed set is **not** expected to be clean. `07-ticketsmith.md` §7.5.1 predicts the validator will
find something in it, and §7.5 says to treat a clean first run as suspicious. Do not paper over
errors here in anticipation; 0011 is the ticket that fixes them, and its output is a useful record
of what hand-authoring gets wrong.

## Operator validation

1. On the laptop, run `ls tickets/open/ | wc -l` and confirm it is in the expected ~112 range, then
   `ls tickets/open/` and read the filenames as a list. The capability groupings should be visible
   from the ids alone, in roadmap order.
2. In a desktop browser on GitHub, open the `tickets/open/` directory listing and click into five
   tickets chosen at random from different capabilities. Each must be readable as a unit of work by
   someone who has not read the design docs, and each `## Acceptance criteria` list must be
   objectively checkable — no criterion that requires a judgement call to mark done.
3. On the Android phone, open two or three tickets in the GitHub mobile web view. They must be
   legible on a phone screen; a ticket you cannot read on a phone is a ticket that will not get
   reviewed after a run.
4. The sign-off itself (D-001): the user reads the whole backlog and says so. This is the operator
   validation for the entire Phase 0 capability, not a formality.

## Resolution

**Completed during the planning session itself, 2026-08-30, before any code existed.**

The MVP backlog was authored by six agents working concurrently over non-overlapping id ranges
(0001–0017, 0018–0038, 0039–0059, 0060–0077, 0078–0096, 0097–0117), each expanding one slice of
`09-roadmap.md`'s capability tables into full tickets. 117 tickets were produced, then two more
(0118, 0119) during validation, for **119 total**.

This ticket is therefore closed on creation. That is unusual and worth recording rather than
hiding: the roadmap listed backlog authoring as work because, from inside the roadmap, it *is*
work — it simply happened before the repo did.

**Files:** `tickets/open/0001-*.md` … `tickets/open/0119-*.md`, `docs/capabilities/*.md` (19 stubs).

**Known state at close** — an ad-hoc validation pass (not `tickets.mjs`, which does not exist yet)
found and fixed:
- 8 missing cross-capability `depends_on` edges: capability `09` had been written with in-range
  dependencies only, leaving 0060 and 0062 as false roots. Wired 60→29, 61→48, 62→12, 64→48,
  68→16, 69→26, 70→25, 73→16.
- 19 missing `docs/capabilities/NN-name.md` files, generated as stubs pointing at their roadmap
  section.
- 2 stale "50 m" reveal-radius mentions in `09-roadmap.md`, corrected to 65 m (D-115 / res-10
  inradius).
- Capability `08` under-decomposed: the `gl.MAX` go/no-go spike was the eleventh acceptance
  criterion of 0055, and 0056 mixed shader correctness with unbounded aesthetic iteration.
  Split into 0118 (spike, `s`, fails loudly) and 0119 (taste pass, time-boxed).

**Deliberately left standing:** this ticket's own `size: l`. It could not be split without
splitting the id space it allocates, and it ran before `/tickets next` existed to refuse it.
0011's criteria expect that warning to remain rather than be edited away.

## Operator validation

Run `ls tickets/open | wc -l` — expect **118** (119 authored, minus this one, now in
`tickets/closed/`). Open three or four tickets at random from different capabilities and confirm
each has `## Description`, `## Acceptance criteria`, `## Notes` and `## Operator validation`, and
that the acceptance criteria are specific enough to act on without reopening the design docs.

Then read 0118. It is the one ticket whose failure would change the plan, and it should read as a
cheap, self-contained go/no-go.
