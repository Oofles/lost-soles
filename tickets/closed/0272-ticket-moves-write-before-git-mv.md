---
id: 272
slug: ticket-moves-write-before-git-mv
title: Ticket moves write the file before git mv, so an untracked ticket is left half-closed
type: bug
priority: med
status: closed
size: s
capability: null
depends_on: []
blocked_by: []
source: agent
created: 2026-10-15T18:00:08Z
started: 2026-10-15T18:02:11Z
closed: 2026-10-15T18:02:11Z
---

## Description

Every ticket transition that moves a file (`close`, `triage-move`, `triage-decline`,
`triage-merge`) wrote the new frontmatter in place, and only then ran `git mv`. `git mv` refuses
an untracked file, and the command died after the write. The file was left in its old folder
claiming its new status. Found closing `0271`: the ticket was created and closed in one commit, so
it was never tracked, and `0271`'s code commit landed with `status: closed` in `tickets/open/`.

The same failure hit any capture hand-carried into `tickets/inbox/`, which D-184 makes the normal
path for ideas from the phone. So it was not only a self-inflicted case.

## Acceptance criteria

- [x] A move checks its destination and moves the file before writing anything. A refused move
      leaves the source byte-identical. Tested with an occupied destination.
- [x] An untracked ticket closes: it moves with a plain rename and lands in `closed/` with the new
      frontmatter. Tested.
- [x] A tracked ticket still moves with `git mv`, so git records a rename and history follows it.
      Tested.
- [x] An untracked inbox capture can be promoted with `triage-move`. Tested.
- [x] One helper serves all four commands. No `git("mv", …)` call remains outside it.

## Steps to reproduce

1. `tickets.mjs create …`, which writes an untracked file in `tickets/open/`.
2. Tick its criteria and write `## Resolution` and `## Operator validation`.
3. `tickets.mjs close <id> --allow-dirty`.

## Expected vs actual

**Expected:** the ticket is in `tickets/closed/` with `status: closed`.

**Actual:** `fatal: not under version control`. The file stays in `tickets/open/` with
`status: closed` and a `closed:` timestamp.

## Notes

- Found by the orchestrator while closing `0271`, 2026-10-15. The operator asked for it to be
  filed and fixed in the same session.
- Also fixed here because the new test reached it: `requireCleanTree` read `git status --porcelain`
  without `--untracked-files=all`. Git collapses a wholly untracked folder to one `?? tickets/` line,
  so the exemption for the ticket being closed could not match it, and `close` refused as dirty.

## Operator validation

None: tooling. The suite proves it, and this ticket's own close exercised the fix, because the
ticket file was untracked when `close` ran.

**Done 2026-10-15 (agent).** `node --test .claude/skills/tickets/scripts/tickets.test.mjs` passes:
199 pass, 0 fail, including the four `0272` cases. This ticket was closed from an untracked file
and landed in `tickets/closed/` with `status: closed`. `--allow-dirty` was needed only because
this fix's code was uncommitted in the same tree, as D-150's one-commit close requires.

## Resolution

- `.claude/skills/tickets/scripts/tickets.mjs`: new `moveTicketFile(src, dest, content)`, used by
  `close`, `triage-move`, `triage-decline` and `triage-merge`. It refuses an existing destination
  before touching anything. It `git mv`s a tracked file and `renameSync`s an untracked one, then
  writes the content at the destination. Tracked-ness is `git ls-files --error-unmatch`, which also
  counts a staged new file. `requireCleanTree` reads porcelain with `--untracked-files=all`.
- `.claude/skills/tickets/scripts/tickets.test.mjs`: the `0272` suite, four cases.
- No decision: it restores what D-158 and the close procedure already assumed, which is that a
  refused transition writes nothing.
