---
id: 9
slug: dependency-resolution-next-and-cycle-detection
title: Dependency resolution, the ready set, `next`, and cycle detection
type: feature
priority: high
status: closed
size: m
capability: 01-ticket-system
depends_on: [7, 8]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-08-31T02:36:31Z
---

## Description

Turn `depends_on` and `blocked_by` from prose into a graph the script resolves in milliseconds, with
zero tokens spent (`07-ticketsmith.md` §3.2, §4.7).

This is the deviation from TicketSmith that pays for itself. TicketSmith's `/tickets` orders work by
"1. priority, 2. dependencies, 3. id ascending" — but its dependencies live in `## Notes` prose
("Depends on ticket #0006 (tool registry and executor)"), so honouring rule 2 means reading every
open ticket in full, every session, and re-deriving the graph with an LLM. That is an O(n) context
tax paid at the start of every session, it produces a slightly different answer each time, and it
degrades silently as the backlog grows: fine at 8 open tickets, broken at 60. This backlog is ~112.

**The ready-set definition, normative:**

```
ready(T) ⟺ T.status ∈ {open, blocked}
         ∧ T.blocked_by = []
         ∧ ∀ d ∈ T.depends_on : ticket(d).status = closed

order: priority (high > med > low)  →  then id ascending
```

- A ticket whose `blocked_by` is non-empty is **never** ready, regardless of `depends_on`.
- A `depends_on` id that does not exist is a **validation error**, not a silent skip.
- The graph is checked for **cycles** on every `index` and every `block`. A cycle is an error that
  **names the participating ids**. With one operator and a few dozen tickets, a cycle is always a
  mistake.
- `next` (single) **refuses `size: l`** and exits non-zero with a message telling the skill to offer
  a split. `next --all` lists them, flagged.

The two fields stay distinct and must not be merged: `depends_on` is a **planned** constraint set at
ticket-write time ("0042 needs the schema 0038 creates"); `blocked_by` is a **discovered** constraint
set mid-session by `/tickets block` ("found while implementing that this can't proceed until 0011
lands"). Mixing them loses the ability to tell "we planned this order" from "we hit a wall," which is
exactly the information a REFLECT step wants.

Both edge types feed the same cycle check, over the union graph.

## Acceptance criteria

- [x] `index.json`'s `ready` boolean is computed by the definition above for every ticket, replacing
      0007's placeholder.
- [x] `node tickets.mjs next` emits exactly one ticket: highest priority among the ready set, ties
      broken by lowest id.
- [x] `next --all` lists the whole ready set in that order.
- [x] `next` exits non-zero when the chosen ticket is `size: l`, with a message that names the ticket
      and says to split it. `next --all` includes `l` tickets but flags them.
- [x] `next` exits non-zero with a clear message when the ready set is empty, distinguishing "nothing
      open" from "everything open is blocked or waiting on deps".
- [x] `list --ready` returns exactly the ready set and agrees with `next --all`.
- [x] A ticket with `blocked_by: [11]` is excluded from the ready set even when all its `depends_on`
      are closed — asserted by a unit test.
- [x] A ticket with `depends_on: [7]` where 7 is `open` is excluded; when 7 moves to `closed` it
      appears, without any manual edit.
- [x] A `depends_on` or `blocked_by` id that does not exist is reported by `validate` as an **error**
      (exit 1), naming both the referring ticket and the missing id.
- [x] Cycle detection runs on `index` and on `block`, detects cycles through `depends_on` edges,
      through `blocked_by` edges, and through a mix of the two, and reports the full participating
      id list in cycle order — not just "a cycle exists".
- [x] `block` refuses to create an edge that would introduce a cycle, and the refusal names the cycle
      it would have created.
- [x] A self-edge (`depends_on: [self]`) is caught as a cycle.
- [x] Unit tests cover: a linear chain, a diamond, a 3-node cycle, a self-edge, a `blocked_by`-only
      cycle, and a graph with a dangling id.
- [x] Resolving the ready set over the full ~112-ticket backlog completes in well under a second and
      reads **no ticket bodies**.

## Notes

`/tickets show` (0007) resolves each `depends_on`/`blocked_by` id to a title plus status so that
"blocked on 0011" reads as "blocked on 0011 *Strava token refresh* — still open" (§4.3). This ticket
supplies the resolution routine that view uses; keep them one implementation.

The `l`-refusal is where `size` earns its character: it turns "tickets should be small" from a hope
into something `next` can enforce (§3.2). Note that ticket 0006 in this very backlog is `size: l` on
purpose and will trip this refusal if it is ever picked up by `next` — that is correct behaviour, and
0006's notes explain why the ticket is exempt in practice (it runs before the script exists).

Ordering is priority → id, deliberately **not** by capability. Capability grouping is a `list --capability`
filter and a display concern, not a scheduling one.

## Operator validation

1. On the laptop, run `node ... next`. It must return ticket 0001 (the pre-flight audit) or the
   lowest-id high-priority ticket with no unmet dependencies — check by eye against the roadmap's
   Phase 0 ordering. If it returns something from Phase 2, the graph is wrong.
2. Run `node ... next --all` and read the list. Nothing in it may have an unclosed `depends_on`;
   spot-check three entries with `node ... show <id>`.
3. Deliberately introduce a cycle: `node ... block 0007 --on 0008` (0008 already depends on 0007).
   The command must refuse and print both ids. Nothing in `tickets/open/` may have changed —
   confirm with `git status`.
4. Close a ticket that others depend on and confirm `next --all` grows by exactly the tickets that
   were waiting on it, and that `close` announced them.

## Resolution

The ready set and cycle detection, per the normative definition in this ticket:

```
ready(T) ⟺ status ∈ {open, blocked} ∧ blocked_by = [] ∧ ∀d ∈ depends_on : closed
order: priority (high>med>low) → id ascending
```

- `next` emits one ticket; `next --all` lists the set in order.
- `next` **refuses `size: l`**, naming the ticket and telling the caller to split it. `next --all`
  includes them, flagged `[SIZE:L — SPLIT]`.
- Empty ready set exits non-zero and **distinguishes** "nothing open" from "everything open is
  blocked or waiting on deps" — two different problems needing two different responses.
- `list --ready` and `next --all` agree; verified live over the real 122-ticket backlog.
- `findCycles` walks `depends_on ∪ blocked_by` and returns each cycle **in cycle order**, not just
  a boolean. Tests cover a linear chain, a diamond, a 3-node cycle, a self-edge, a `blocked_by`-only
  cycle, a mixed-edge cycle, and a dangling id.
- Dangling `depends_on`/`blocked_by` ids are a validation **error** naming both the referrer and
  the missing id — not a silent skip.

**Performance:** `next --all` over 122 tickets runs in **31 ms including Node startup**, against a
budget of "well under a second". It reads no bodies — asserted by the test that empties every body
and confirms `list` output is unchanged.

Live behaviour on the real backlog at close time: the ready set was `[0007, 0122]`, and `next`
correctly selected 0007 — the ticket being implemented.

## Operator validation

Run `node .claude/skills/tickets/scripts/tickets.mjs next`. It should name the next ticket you
should actually pick up, and it should agree with `docs/BUILD-ORDER.md`. Then `next --all` to see
the whole ready set. If a ticket you expect is missing, `show <id>` prints its dependencies with
their current status, which is the answer to "why isn't this ready".
