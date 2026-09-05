---
id: 170
slug: d-194-is-assigned-to-two-different-decisions-so-every-citati
title: D-194 is assigned to two different decisions, so every citation is ambiguous
type: bug
priority: high
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-05T23:12:00Z
---

## Description

`docs/decisions/DECISIONS.md` carries **two different decisions both numbered `D-194`**:

| Line | Decision | Ticket | Added |
|---|---|---|---|
| 1547 | *An adapter's OAuth routes are generic `[source]` routes; the vendor half lives on a connector* | `0032` | 2026-09-03 |
| 1583 | *The raw archive stores ONE content-addressed object per ingest* | `0035` | 2026-09-04 |

`0035` allocated a number that was already taken. Nothing catches this: `tickets.mjs validate`
does not read `DECISIONS.md`, and the register is append-only prose that nobody re-reads from
the top.

**Why it matters more than a numbering nit.** The register exists so a citation is a pointer to
one piece of reasoning. `03-integrations.md` §929 says *"SUPERSEDED by D-194"* and means the
archive layout; `tickets/closed/0032` says *"Recorded as D-194"* and means the OAuth routes. A
reader following either citation has a 50% chance of landing on an unrelated decision and
concluding the document is wrong about itself — which is exactly the failure the register is
supposed to prevent.

It is cheap to fix now (two commits old, six citations total) and permanent if left.

## Acceptance criteria

- [ ] One of the two decisions is renumbered, and it is the LATER one (`0035`'s archive
      envelope) — renumbering `0032`'s would invalidate a citation in a document that has
      already been superseded on the strength of it.
- [ ] Every citation of the renumbered decision is updated: `docs/03-integrations.md` §3.2's
      superseded note, `tickets/closed/0035-*.md` (three places), and any code comment.
- [ ] The renumbered entry keeps a one-line note saying it was recorded as `D-194` by ticket
      `0035` and renumbered here, so a reader who followed a stale citation from outside the
      repo lands somewhere that explains itself.
- [ ] A check makes a second collision impossible — the cheapest being a test that parses
      `DECISIONS.md`'s `D-xxx` headings and asserts they are unique and monotonic.
- [ ] `D-195` and `D-196` (ticket `0036`) are left alone; they are already allocated and cited
      from `src/adapters/strava/normalize.ts`.

## Steps to reproduce

1. `grep -n "^- \*\*D-194" docs/decisions/DECISIONS.md`
2. Two hits, at different line numbers, with different subjects.

## Expected vs actual

**Expected:** a `D-xxx` names exactly one decision, forever.

**Actual:** `D-194` names two, and which one a citation means is decided by context the citation
does not carry.

## Notes

The uniqueness check is the durable half of this ticket, and it should probably also assert
**monotonicity** — a register whose numbers go backwards is one where a duplicate is about to be
introduced. `build-index.mjs` already walks the docs tree, so there is somewhere obvious for it
to live, though `0145` records that script as having no tests of its own.

Worth noting the allocation is the real problem: numbers are chosen by reading the file and
adding one, which is a read-modify-write with no lock, and every session is a concurrent writer
in the only sense that matters — none of them re-read before committing. A `tickets.mjs`
subcommand that allocated the next `D-xxx` the way it allocates ticket ids would remove the
class rather than this instance. That is bigger than this ticket; file it separately if the
check alone feels insufficient.

## Operator validation

None — a documentation-integrity defect with no rendered surface. The verification is the
uniqueness check in criterion 4, which fails on the current file and passes after the
renumbering. That is a stronger check than any manual read, since the failure it prevents is
precisely one a human reading top-to-bottom does not notice.
