---
id: 140
slug: docs-index-md-is-stale-and-the-gate-has-been-red-on-every-pu
title: docs/INDEX.md is stale, and the gate has been red on every push since ac977fd
type: bug
priority: med
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-01T22:29:00Z
started: 2026-09-02T02:02:14Z
---

## Description

`node scripts/build-index.mjs --check` has failed on **every** `gate.yml` run since `ac977fd`
(2026-09-01 03:48) — fourteen consecutive red runs at the time of filing. It is the only failing
step: typecheck, lint, `npm test` and both D-100/token checks all pass, and the three steps AFTER
it (`bash -n` on the hook, the Next build, and both bundle-leak scans) are **never reached**.

The drift is real, not a checker bug. An earlier commit added `§3.3.1 (operator) criteria` to both
`docs/07-ticketsmith.md` and `docs/TICKET_FORMAT.md` without regenerating the index; `07` also grew
from 1,235 to 1,341 lines, so every section line-range below §3.3 in that document is now wrong.
`docs/INDEX.md` exists precisely so a session can `sed -n` straight to a section (D-151), and the
file's own header says it: **"a stale index is worse than none"** — it sends you to the wrong lines
confidently.

Found while working `0137`, and filed rather than fixed inside it: unrelated cause, and `0137` must
not absorb it. Note `docs/decisions/DECISIONS.md` is NOT one of the 13 indexed documents, so
appending decisions does not contribute to this.

## Acceptance criteria

- [ ] `node scripts/build-index.mjs --check` exits 0 on `main`.
- [ ] The regenerated line ranges for `docs/07-ticketsmith.md` §3.3 onward are spot-checked against
      the real file — a regenerated index that is confidently wrong is the failure mode here.
- [ ] `gate.yml` reaches the steps after the index check, and they are seen to pass or fail on
      their own merits. Three checks have been dark for fourteen runs.
- [ ] Decide and record whether a stale index should be able to mask the checks below it, or
      whether `gate.yml` should run the index check LAST (or with `continue-on-error`). A docs
      index is the least severe check in the file and it is currently the most blocking.

## Steps to reproduce

1. `node scripts/build-index.mjs --check` on a clean `main` → `docs/INDEX.md is out of date`, exit 1.
2. `gh run view <any gate run since ac977fd> --log-failed` → the same line.

## Expected vs actual

**Expected:** the index tracks the docs, and the gate is green or red for a reason that matters.

**Actual:** fourteen consecutive red runs on a docs index, with three real checks never reached —
which is exactly the reflex `0137` calls more dangerous than the flake itself: a red build that
means nothing.

## Notes

`build-index.mjs --check` **writes** `docs/.index-summaries.json` as a side effect, even in check
mode. That is why a `--check` run dirties the tree. Worth deciding whether `--check` should be
read-only; a checker that mutates the thing it checks is a small version of the same problem.

Related: `0120` (created the index), `0013`/`gate.yml` (the workflow), `0137` (where this was found).

## Operator validation

None required — this is a CI-visible check with no rendered surface. The observable result is
`gate.yml` going green, which the operator can confirm from the Actions tab on the next push.
