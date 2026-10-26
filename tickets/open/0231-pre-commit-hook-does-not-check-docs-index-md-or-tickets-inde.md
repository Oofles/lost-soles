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
started: 2026-10-26T03:02:11Z
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

- [x] A commit that stages a change under `docs/` leaving `docs/INDEX.md` stale is blocked, with
      a message naming the fix (`node scripts/build-index.mjs`, then stage `docs/INDEX.md`).
- [x] A commit that stages a change under `tickets/` leaving `tickets/index.json` stale is blocked,
      with the equivalent message (`tickets.mjs index`).
- [x] Both checks judge the STAGED tree, not the worktree, as layer 4 does: a file regenerated on
      disk but not staged still blocks. Tests in `scripts/pre-commit-hook.test.mjs` cover both
      cases for each file.
- [x] A commit staging neither path does not pay for either check.
- [x] The hook's checks and CI's `build-index.mjs --check` / `tickets.mjs index` + `git diff` agree:
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

## Resolution

**Layer 5, "derived indexes", added to `.githooks/pre-commit`.** It blocks a commit whose staged
tree carries a stale `docs/INDEX.md` or `tickets/index.json`, and the message names the fix. It
does **not** regenerate the file or `git add` it for you. That settles the Notes' open question:
the acceptance criteria say "is blocked, with a message naming the fix", and blocking is what every
other layer does (proposed as a new decision in the wave report).

Files touched:

- `.githooks/pre-commit`: new layer 5. A pure-bash `case` gate over the staged paths decides
  `--docs` and/or `--tickets`, so a commit staging neither path never starts node. The checker is
  run under `require_node`, and the layer fails closed when the checker is missing.
- `scripts/check-staged-indexes.mjs` (new): exports the STAGED content of `docs/` +
  `scripts/build-index.mjs`, and/or `tickets/` + `tickets.mjs`, into a scratch directory with
  `git checkout-index --stdin`, then runs the staged generators there:
  `build-index.mjs --root <dir> --check`, and `tickets.mjs index` (with `TICKETS_ROOT=<dir>`)
  compared byte for byte against the staged `index.json`. Exit 0 means current, 1 means stale (the
  fix is printed), 2 means it could not check (D-176: a broken guard, not a pass).
- `docs/capabilities/WAVES.md`: §3 and §6 describe the wave-agent bypass (see below).
- `scripts/pre-commit-hook.test.mjs`: `setup` and `env` options on `runHook`, and a layer-5 suite
  of 24 cases that run the real generators. It covers stale-blocks and fresh-passes for each file, and
  regenerated-on-disk-but-not-staged blocking for each file. A deleted doc and a `git mv` of a
  ticket to `closed/` both block. A commit touching neither path passes with node absent from
  PATH, which proves layer 5 never ran. Docs staged with node missing blocks, and so does a missing
  checker or a generator absent from the stage. Seven scenarios compare the hook's verdict against
  CI's own commands, run on a clean checkout of the would-be commit.

Decisions and findings:

- **The staged generators run, not the worktree's.** CI runs the committed copies. Using the
  worktree's copies would let an unstaged generator edit make the hook and CI disagree.
- **The early `exit 0` on an empty `$staged` was wrong for this layer.** `$staged` is
  `--diff-filter=ACM`. It drops deletions, and because rename detection is on, it also drops a
  `git mv` (status R). A commit that only moves a ticket to `closed/`, or only deletes a doc, had an
  empty `$staged` and returned before layer 5 ran. The tests caught this. Layer 5 takes its own
  `--no-renames` listing above the early return, and the return now waits for both listings to be
  empty.
- **A deleted `tickets/index.json` passes, deliberately, to match CI.** `tickets.yml` runs
  `git diff --exit-code tickets/index.json`, which ignores an untracked file, so CI is green on
  such a commit. The criterion is that the two never disagree, so the hook follows CI here. The gap
  itself is reported for a follow-up ticket. A deleted `docs/INDEX.md` blocks in both.
- **Bypass is `git commit --no-verify`**, which is the hook's existing documented bypass. This
  ticket's commit did **not** need it. `core.hooksPath` is the absolute path
  `/home/vivicat/lost-soles/.githooks`, so a worktree commit runs the MAIN checkout's hook, which
  until this merges is the old one. The new hook was run by hand on this commit's staged tree.
  Layers 1–4 passed. Layer 5 blocked, and only on `tickets/index.json`: WAVES §3 forbids a wave
  agent from staging that file, and editing a ticket file makes it stale. 536 ms in total.
  Once this merged, every wave agent would have hit the same block, because each one edits its own
  ticket file.
- **`LOST_SOLES_WAVE_AGENT=1` skips layer 5 only.** This was the operator's answer to that
  question: option (c), chosen over letting agents stage `index.json` and over `--no-verify`.
  With the variable set to exactly `1`, layer 5 prints a one-line notice naming the variable and
  does not check. Layers 1–4, gitleaks included, run before it and are unchanged. Any other value,
  including `0` or empty, still checks.
  - Tests: a stale index passes under `=1`. It still blocks when the variable is unset, `0`, empty
    or `true`. Under `=1`, gitleaks, the literal-pattern layer and the geography layer all still
    block.
  - `docs/capabilities/WAVES.md` §3 (the index-files row) and the §6 agent prompt's commit bullet
    now say to commit with `LOST_SOLES_WAVE_AGENT=1 git commit …` and never with `--no-verify`.
  - The hook's block message names the variable too.
  - `docs/capabilities/` is not an input to `build-index.mjs`, so `docs/INDEX.md` stays current.

## Operator validation

None beyond a smoke test: stage a doc edit without regenerating and confirm the commit is refused.
Then regenerate, stage and confirm it passes. A push is green on `gate` and `tickets`.
