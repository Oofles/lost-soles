---
id: 140
slug: docs-index-md-is-stale-and-the-gate-has-been-red-on-every-pu
title: docs/INDEX.md is stale, and the gate has been red on every push since ac977fd
type: bug
priority: med
status: closed
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-01T22:29:00Z
started: 2026-09-02T02:02:14Z
closed: 2026-09-02T02:09:17Z
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

- [x] `node scripts/build-index.mjs --check` exits 0 on `main`.
- [x] The regenerated line ranges for `docs/07-ticketsmith.md` §3.3 onward are spot-checked against
      the real file — a regenerated index that is confidently wrong is the failure mode here.
      Checked against `grep -n '^#\{2,3\} '`: §3.3 `422-456`, §3.3.1 `457-500`, §3.4 `501-523`,
      §3.5 `524-540`, §3.6 `541-616`, §4.2 `644-683`, §4.7 `772-903` — every one lands on a real
      heading line.
- [x] `gate.yml` reaches the steps after the index check, and they are seen to pass or fail on
      their own merits. Three checks have been dark for fourteen runs.
      Run `33581910439` on `28f4420`: **all 21 steps ran, all succeeded**, including `build`,
      `bundle leak check self-test` and `no secret in built output`. It was four dark steps, not
      three — `bash -n .githooks/pre-commit` was also behind the index check.
- [x] Decide and record whether a stale index should be able to mask the checks below it, or
      whether `gate.yml` should run the index check LAST (or with `continue-on-error`). A docs
      index is the least severe check in the file and it is currently the most blocking.
      **Decided: LAST, and still blocking. `continue-on-error` rejected.** Recorded as **D-177**.

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

## Resolution

Three changes, one per cause. The stale index was the reported symptom; the other two are why it
stayed unnoticed for fifteen pushes and why `--check` was unpleasant to run.

**1. Regenerated the index.** `docs/INDEX.md` — 13 documents, 557 sections. The drift was as
diagnosed: `§3.3.1 (operator) criteria` was added to `07-ticketsmith.md` without regenerating, so
every range below §3.3 was wrong. Criterion 2 exists because a regenerated index that is
*confidently wrong* is the real failure mode, so the ranges were checked against
`grep -n '^#\{2,3\} '` rather than trusted. One thing worth recording: the generator's fence
tracking is correct — `## Acceptance criteria` at `07:463` sits inside a ```` ```markdown ```` block
as an *example* of a ticket body, and is properly not indexed as a section. A naive heading grep
would have indexed it.

Note the index reports `1,341 lines` for a file `wc -l` calls 1,340. That is
`text.split("\n").length` counting the empty string after the final newline, it is consistent
across all 13 documents, and it is not worth changing — but it is why the ticket's own description
says 1,341.

**2. `--check` is now read-only (D-178).** Raised in this ticket's own Notes as "worth deciding",
and decided. `writeFileSync(SIDECAR, …)` sat *above* the `--check` branch, so every check run
rewrote `docs/.index-summaries.json`. A checker that mutates the thing it checks left a dirty tree
behind an apparently read-only command — on CI that makes a verification step also a mutation step.
Both writes now happen only on the regenerate path. Nothing was lost: `nextSidecar` is built in
memory and the comparison never needed it on disk. I hit this for real during the capability `02`
audit, where a `--check` run dirtied the tree and I had to `git checkout` the file.

**3. The index check runs LAST in `gate.yml`, and stays blocking (D-177).** This is criterion 4's
decision and the one that actually matters.

`continue-on-error: true` was considered and **rejected**. It would make the job green on a stale
index, which lets the index rot silently — and `docs/INDEX.md` exists so a session can `sed -n`
straight to a section (D-151), its own header saying a stale index is worse than none because it
sends you to the wrong lines *confidently*. Non-blocking is the wrong direction. The check was
correct; its **position** was wrong.

The rule is written into the workflow so new steps inherit it: **order by severity, not by cost.**
Anything whose failure means "something unsafe shipped" runs before anything whose failure means "a
document is untidy". Cheapest-first is the normal instinct and it is wrong here precisely because
the cheapest checks tend to be the least serious, and fail-fast then lets them mask the most
serious. `amplify.yml` is deliberately untouched — it never carried the index check, and the LOCK
(D-163) should not start failing deploys over documentation.

**What the ticket got slightly wrong, corrected here:** it says *three* checks were dark. It was
**four** — `bash -n .githooks/pre-commit` also sat after the index check and never ran. Minor, but
the count is the whole argument for the reordering, so it should be right.

**Files touched:** `scripts/build-index.mjs`, `.github/workflows/gate.yml`, `docs/INDEX.md`,
`docs/.index-summaries.json`, `docs/decisions/DECISIONS.md` (D-177, D-178).

**No test was added,** and that is a gap worth naming rather than hiding. `build-index.mjs` has no
test file at all, so "`--check` does not write" is asserted by nothing and could regress silently —
the same shape as the defects `0125` and `0137` were filed for. It is not absorbed into this ticket
because a first test harness for the generator is its own piece of work, not a line in a bug fix.
**Filed as `0145`** (`low` — the blast radius is a documentation index, not the map).

## Operator validation

**Performed by the agent, 2026-09-02, with CI evidence rather than a local claim** — the whole point
of this ticket is what happens on GitHub's runner, not on this machine.

- **Gate run `33581910439` on commit `28f4420`: SUCCESS.** The first green `gate` run since
  `ac977fd` on 2026-09-01, ending a streak of fifteen consecutive red runs.
- **All 21 steps ran and succeeded**, read back from
  `repos/Oofles/lost-soles/actions/runs/33581910439/jobs` rather than inferred from the job's
  overall conclusion. The four previously-dark steps are individually `success`:
  `build`, `bundle leak check self-test`, `no secret in built output`, and
  `pre-commit hook is valid bash`.
- **`docs/INDEX.md is up to date` now appears last in the step list** and passed there.
- **`tickets` and `secret-scan` workflows both green** on the same commit.
- **`--check` leaves the tree clean**, confirmed by `git status --short` immediately after a run.

**Nothing here needs a screen or a device.** This is CI plumbing with no rendered surface, and the
original "None required" was the right call. What replaced it is the evidence, because "the gate is
green" is a claim that should carry a run id — this ticket exists because fifteen red runs went
unread, and an unverifiable green is how that starts again.

**Worth the operator's eyes once, at leisure:** open the Actions tab and confirm the `gate` run for
`28f4420` shows the full step list rather than stopping partway. That is the visible shape of the
fix, and it is the thing that was wrong for two days.
