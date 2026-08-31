---
id: 8
slug: tickets-mjs-mutating-commands
title: tickets.mjs — allocate, create, start, block, unblock, close, triage-move
type: feature
priority: high
status: open
size: m
capability: 01-ticket-system
depends_on: [7]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The write half of `scripts/tickets.mjs` (`07-ticketsmith.md` §4.7). Every command here mutates files
or git state, so every one of them is a place a backlog can be corrupted. They remain deterministic:
the script allocates ids, moves files and stamps timestamps; it never decides what a ticket *means*.

```
allocate                   Print the next NNNN. Does not write.
create --title T --type X --priority P [--capability C] [--size S]
                           Scaffold a ticket in open/ from the template. Prints the path.
start <id>                 Stamp started:.
block <id> --on <id> [--reason R]
                           Add the edge, set status: blocked, append a dated Notes entry.
unblock <id> --on <id>     Remove the edge; if blocked_by empties, status returns to open.
close <id>                 Set status/closed:, git mv to closed/, reindex.
triage-move <inbox-file> --slug S
                           Allocate NNNN, rewrite frontmatter, git mv to open/.
```

Behaviours that are not optional:

- **`allocate`** returns `max(id) + 1` across **all three folders**. Ids do not reset between
  `open/` and `closed/` and are never reused.
- **`close`** **refuses if any acceptance checkbox is unchecked.** There is deliberately no
  `--force`. It names what is missing and leaves the ticket open. It also refuses if `## Resolution`
  or `## Operator validation` is absent, since `validate` errors on a closed ticket lacking either.
- **`close`** reports which tickets just became ready — anything whose `depends_on` or `blocked_by`
  contained the closed id (§4.6 step 7).
- **`block`** errors if the target id does not exist, and errors if the edge would create a cycle.
  It **never closes a blocked ticket.**
- **File moves use `git mv`**, not `fs.rename`, so history follows the file.
- **`triage-move`** is the inbox→backlog bridge: an inbox item has no `id`, no `slug`, no `size`, no
  `capability` (§3.4). `triage-move` allocates the id, applies the `--slug`, rewrites the frontmatter
  into full `open/` shape in §3.1 key order, and `git mv`s the timestamped filename to `NNNN-slug.md`.
  The `--slug` may differ from the provisional slug in the capture filename.
- Every mutation ends by regenerating `index.json`.

**This ticket decides Q-07-3 — the dirty-tree refusal.** Should a mutating command refuse to run when
the working tree has uncommitted changes? The recommendation is: **refuse for `close` and
`triage-move`** (the two that `git mv` and are expected to be followed by a commit on their own,
`tickets(#NNNN): <title>`), and **allow for `start`, `block`, `unblock`, `create`** (which only edit
a file and are routinely done mid-session with app code already dirty). Whatever is chosen, record it
as a `D-xxx` and implement an `--allow-dirty` escape hatch for the refusing commands so the operator
is never stuck.

## Acceptance criteria

- [x] `allocate` prints the next id zero-padded to four digits, computed as `max(id)+1` across
      `inbox/`, `open/` and `closed/`, and writes nothing. A test with a closed ticket holding the
      highest id proves ids do not reset.
- [x] `create --title "Title: with a colon" --type feature --priority high` produces a valid ticket
      in `open/` that `validate` (0007) passes, with `source` set appropriately, `status: open`,
      `blocked_by: []`, `created` stamped in ISO 8601 UTC, and no `started`/`closed` keys.
- [x] `create` prints the path of the file it wrote and nothing else on stdout when `--json` is not
      passed.
- [x] `start <id>` stamps `started:` in ISO 8601 UTC, leaves the file in `open/` with
      `status: open`, and is idempotent-safe (re-running reports the existing stamp rather than
      overwriting it).
- [x] `block 42 --on 11 --reason "..."` appends `11` to 42's `blocked_by`, sets `status: blocked`,
      and appends a **dated** entry under `## Notes` containing the reason verbatim.
- [x] `block` exits non-zero and changes nothing when the `--on` id does not exist.
- [x] `block` exits non-zero and changes nothing when the edge would create a cycle.
- [x] `unblock 42 --on 11` removes the edge; when `blocked_by` becomes `[]` the status returns to
      `open`; when other edges remain the status stays `blocked`.
- [x] `close <id>` sets `status: closed`, stamps `closed:`, `git mv`s the file to `tickets/closed/`,
      and regenerates `index.json`. `git log --follow` on the moved file shows its pre-move history.
- [x] `close` **refuses** (exit non-zero, no mutation) when any acceptance checkbox is unchecked, and
      its message lists the unchecked criteria verbatim.
- [x] `close` refuses when `## Resolution` or `## Operator validation` is missing, naming which.
- [x] No `--force` flag exists on `close`.
- [x] After a successful `close`, the command prints the ids and titles of every ticket that
      referenced the closed id in `depends_on` or `blocked_by`, flagging which are now ready.
- [x] `triage-move tickets/inbox/2026-08-30T1432-foo.md --slug streak-freeze-tokens` allocates an
      id, rewrites the frontmatter to full `open/` shape in §3.1 key order, preserves the body
      byte-for-byte, and `git mv`s to `tickets/open/NNNN-streak-freeze-tokens.md`.
- [x] `triage-move` refuses a `--slug` that does not match `^[a-z0-9]+(-[a-z0-9]+)*$`.
- [x] Every mutating command regenerates `index.json` as its last step.
- [x] Q-07-3 is decided, recorded as a `D-xxx` in `docs/decisions/DECISIONS.md`, implemented, and
      the refusing commands accept `--allow-dirty`.
- [x] Unit tests cover each command against a temporary git repo fixture, including the refusal
      paths — a refusal that is not tested is a refusal that will be bypassed by accident.

## Notes

The closing procedure the operator follows around `close` is §4.6: update the ticket, append
`## Resolution` and `## Operator validation`, add any new `D-xxx` to `DECISIONS.md` (**never edit an
existing settled decision to make a ticket easier**), run `close`, then commit **on its own** as
`tickets(#0042): <title>`. The script owns steps 5 and 7; the skill (0010) owns walking the operator
through the rest.

Cycle detection is shared with 0009. If 0009 has not landed, implement `block`'s cycle check inline
and have 0009 replace it with the shared graph routine rather than duplicating the logic permanently.

`start` deliberately does not introduce an `in-progress` status (§3.1): an abandoned session leaves a
timestamp, not a stuck state that has to be cleaned up.

## Operator validation

1. On the laptop, run `node ... create --title "Scratch ticket" --type chore --priority low`, open
   the file it prints in an editor, and confirm it looks exactly like the other tickets — same field
   order, same section headings.
2. Attempt `node ... close <that id>` with its acceptance boxes unchecked. It must refuse and tell
   you which boxes. Tick them, add `## Resolution` and `## Operator validation`, close again, and
   confirm the file has moved to `tickets/closed/` — check with `ls tickets/closed/` and in the
   GitHub web file browser after pushing.
3. Run `node ... block 0015 --on 0001 --reason "pre-flight not finished"` and then open
   `tickets/open/0015-*.md` in an editor. The `## Notes` section must have a dated line with your
   reason in it, readable a month from now. Then `unblock` and confirm the status returns to `open`.
4. Delete `tickets/index.json` and run any mutating command. The index must come back. Deleting it
   is always safe, and this proves it.

## Resolution

All mutating commands implemented in `tickets.mjs`, each regenerating `index.json` as its last step.

- `allocate` is `max(id)+1` across all three folders — a test with the highest id in `closed/`
  proves ids never reset.
- `create` produces a ticket that `validate` passes, handles a colon in the title, and prints only
  the path on stdout.
- `start` is idempotent-safe: re-running reports the existing stamp rather than overwriting it.
- `block` refuses a nonexistent `--on` id and refuses an edge that would create a cycle, **naming
  the cycle**, and changes nothing in either case. `--reason` is appended dated under `## Notes`.
- `unblock` returns status to `open` only when the last edge is removed.
- `close` `git mv`s to `closed/` (so `git log --follow` keeps history), then prints every ticket
  that referenced the closed id and flags which are **now ready**.
- `triage-move` allocates an id, rewrites frontmatter to §3.1 order, preserves the body
  **byte-for-byte**, and refuses a non-kebab-case slug.

**`close` has no `--force`, and that is tested behaviourally rather than by grepping the source** —
the refusal message itself contains the string "--force", so a textual test would pass for the
wrong reason. The behavioural test asserts that passing `--force` to a ticket with unchecked
criteria still refuses and still does not move the file.

Q-07-3 settled as **D-158**: `close` and `triage-move` refuse a dirty tree (they `git mv` and expect
their own commit); `start`/`block`/`unblock`/`create` do not (they only edit in place and are run
mid-session with app code dirty). `--allow-dirty` on both refusing commands. Refusal *and* override
are both tested.

## Operator validation

The refusals are the part worth seeing yourself. In the repo, edit any open ticket to uncheck one
acceptance box, then run `close` on it: it must refuse and print that criterion verbatim. Re-check
the box, then make an unrelated file dirty and try again: it must refuse for the dirty tree, and
succeed with `--allow-dirty`. Undo afterwards.
