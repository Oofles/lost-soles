---
id: 231
slug: pre-commit-hook-does-not-check-docs-index-md-or-tickets-inde
title: Pre-commit hook does not check docs/INDEX.md or tickets/index.json, so CI goes red silently
type: bug
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-01T20:01:11Z
---

## Description

**Found 2026-10-01, from the operator's inbox.** Every `gate` run on `main` failed from
2026-09-29 to 2026-10-01: about 20 consecutive pushes. Each one passed typecheck, lint, the full
test suite, the build and every rule check, then failed the last step, `docs/INDEX.md is up to
date` (`node scripts/build-index.mjs --check`, `gate.yml:244`). Several `tickets` runs failed
the same way on `tickets/index.json` (`tickets.yml:27`). Both files are DERIVED: the first from the
design docs' headings and line counts, the second from ticket frontmatter and acceptance-criteria
counts. Sessions edited the sources without regenerating them.

**Nobody noticed for two days.** No agent session checks CI after pushing, and the only signal was
GitHub's failure emails to the operator. That makes a red gate background noise, and that is how a
real failure gets missed: a broken test on push 21 looks exactly like the stale index on pushes 1–20.

`.githooks/pre-commit` (`0125`) already has the right shape for this: it runs node checks
against the STAGED content and fails closed when node is missing. It just does not run either
of these two checks. Commit `18b953c` (filing `0230`) is a clean example: a ticket body was filled
in by hand after `tickets.mjs create`, the acceptance count went 1 → 3, and nothing stopped it.

## Acceptance criteria

- [ ] A commit that stages a change under `docs/` leaving `docs/INDEX.md` stale is blocked, with
      a message naming the fix (`node scripts/build-index.mjs`, then stage `docs/INDEX.md`).
- [ ] A commit that stages a change under `tickets/` leaving `tickets/index.json` stale is blocked,
      with the equivalent message (`tickets.mjs index`).
- [ ] Both checks judge the STAGED tree, not the worktree, as layer 4 does: a file regenerated on
      disk but not staged still blocks. Tests in `scripts/pre-commit-hook.test.mjs` cover both
      cases for each file.
- [ ] A commit staging neither path does not pay for either check.
- [ ] The hook's checks and CI's `build-index.mjs --check` / `tickets.mjs index` + `git diff` agree:
      no staged tree passes one and fails the other.

## Steps to reproduce

1. Edit any heading or add lines in `docs/05-fog-of-war.md`. Stage and commit it without
   running `build-index.mjs`.
2. The commit succeeds locally. Push.
3. `gate` fails at `docs/INDEX.md is up to date`.

## Expected vs actual

**Expected:** the commit is refused locally, with the regeneration command.

**Actual:** it commits cleanly, and CI fails after a 4.5-minute run, reported only by email.

## Notes

- Fixed by hand in commit "docs: regenerate INDEX.md and tickets/index.json (CI gate red since
  2026-09-29)". `gate`, `tickets` and `secret-scan` were green again on that push.
- Candidate, **not decided**: rather than block, the hook could regenerate and `git add` the two
  files itself. That is friendlier, but a hook that rewrites the commit is surprising, and the
  `tickets.mjs` commands deliberately do not commit. Blocking matches every other layer. Decide
  before code (D-152).
- The `tickets.mjs` commands that maintain `index.json` (`create`, `close`, `triage-*`) already
  regenerate it. The gap is a hand edit of a ticket body afterwards, which `create`'s TODO template
  makes routine.

## Operator validation

None beyond a smoke test: stage a doc edit without regenerating and confirm the commit is refused.
Then regenerate, stage and confirm it passes. A push is green on `gate` and `tickets`.
