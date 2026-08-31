---
id: 125
slug: pre-commit-hook-has-no-test
title: The pre-commit hook has no test — a silent edit disabled a layer
type: bug
priority: high
status: open
size: s
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T02:59:59Z
---

## Description

The `.githooks/pre-commit` hook is the layer that makes an accidental `git add .` survivable, and it
is the direct remediation of O-005. **It has no test.** A scripted edit on 2026-08-31 inserted a new
check after the first `exit 0` — which was the `[ -z "$staged" ] && exit 0` early return — leaving
the entire literal-pattern scan as unreachable dead code. Commit `30438db` was made with that layer
off, and **nothing surfaced it.** It was found by reading the diff afterwards.

Nothing was smuggled in (gitleaks runs before that point and was unaffected; a full-history scan and
a manual sweep of that commit are clean). The point is that it *could* have been, and the failure
mode was total silence.

Every other guard in this project is tested. This one — the one whose whole job is to catch a
mistake made in a hurry — is the one that is not.

## Acceptance criteria

- [ ] A test harness runs `.githooks/pre-commit` against a temporary git repo, per layer.
- [ ] One test per layer, each proving it **blocks**: gitleaks (real PAT), literal patterns (PEM
      header, slack token, AWS key id), skill frontmatter (unparseable `SKILL.md`).
- [ ] A negative control proves an ordinary file still commits — a hook that blocks everything is as
      broken as one that blocks nothing, and fails less visibly.
- [ ] A test proves `gitleaks:allow` exempts a line, and that it exempts **only that line**.
- [ ] A structural test asserts there is **exactly one** `exit 0` reachable at the end and no
      unreachable code after an early exit — the specific defect that caused this ticket.
- [ ] `bash -n .githooks/pre-commit` runs in CI.
- [ ] The suite runs in CI on every push.

## Steps to reproduce

1. Edit `.githooks/pre-commit` with a script that replaces the first occurrence of `exit 0`.
2. Observe that `[ -z "$staged" ] && exit 0` is the first occurrence, not the final one.
3. Commit a file containing `-----BEGIN RSA PRIVATE KEY-----`. It succeeds.

## Expected vs actual

**Expected:** any edit that disables a scanning layer fails a test.
**Actual:** the layer became dead code and every commit still reported success. The hook printed its
gitleaks banner as usual, so it looked like it was working.

## Notes

Test the hook by invoking it as git does — stage a file, run the hook, check the exit code — rather
than by grepping its source. The `--force` lesson from 0008 applies: a textual test on a script
whose own error messages quote the patterns it looks for passes for the wrong reasons.

## Operator validation

Break the hook on purpose: comment out the `gitleaks protect` call, run the suite, and confirm it
fails and names the layer. Restore it.
