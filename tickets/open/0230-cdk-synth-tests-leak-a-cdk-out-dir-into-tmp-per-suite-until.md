---
id: 230
slug: cdk-synth-tests-leak-a-cdk-out-dir-into-tmp-per-suite-until
title: CDK synth tests leak a cdk.out dir into /tmp per suite, until the suite fails ENOSPC
type: bug
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-01T19:35:31Z
started: 2026-10-26T01:42:16Z
---

## Description

**Found during `0228`, 2026-10-01.** A full `vitest run` failed ten `amplify/*.test.ts` suites
with `AmplifyDataConstructInitializationError … ENOSPC: no space left on device, copyfile
…/asset-awscli-v1/lib/layer.zip -> /tmp/cdk.outXXXXXX/…`. `/tmp` is a 16 GB tmpfs on this
WSL machine, and it was full: **509 `/tmp/cdk.out*` directories, about 15 GB**, left by earlier
runs.

Each of the 10 suites that import `amplify/backend.ts` and call `Template.fromStack` synthesises
into a fresh `mkdtemp` `cdk.out` under `os.tmpdir()` (about 31 MB each, mostly asset zips), and
nothing removes it. **Measured: about 300 MB and 10 directories per full run.** At that rate the
suite starts failing after roughly 50 runs, and the failure looks like an infrastructure-code
regression rather than a full disk. That misdirection is the real cost: the ENOSPC line is buried
under an Amplify construct error.

The suites affected: `activity-model`, `activity-query-grant`, `basemap-tiles-stack`,
`explored-cells-table`, `fog-delivery-read-grant`, `ingest-receipt-table`,
`process-activity-stack`, `profile-model`, `raw-archive-immutability`, `xp-ledger-tables`.
`scripts/pre-commit-hook.test.mjs` failed in the same run for the same reason (no space for its
temp repo).

## Acceptance criteria

- [x] A full `vitest run` leaves no new `cdk.out*` directory in `os.tmpdir()`. A check counts them
      before and after, so the leak cannot quietly return.
- [x] Cleanup also happens when a suite fails or the run is interrupted mid-way, or the ticket
      records why a leftover from a killed run is acceptable.
- [x] The CDK assertion suites still pass and still synthesise the real `backend.ts`. The fix
      must not stub the synth to save space.

## Steps to reproduce

1. `ls -d /tmp/cdk.out* | wc -l`
2. `npx vitest run amplify`
3. Repeat step 1: the count has risen by 10, about 300 MB.

## Expected vs actual

**Expected:** the count is unchanged after the run.

**Actual:** +10 directories per run, and eventually `ENOSPC`, which fails the suite.

## Notes

- Candidates, **not decided**: point the synth at one per-run directory (`CDK_OUTDIR`, or the
  `outdir` of the `App` the Amplify backend builds, if that is reachable) created in a vitest
  `globalSetup` and removed in its teardown; or run vitest with `TMPDIR` set to a gitignored
  repo-local directory that `globalSetup` empties. The second also catches the pre-commit test's
  temp repos, but moves the growth onto the repo's disk if teardown is skipped.
- Workaround until it lands: `rm -rf /tmp/cdk.out*`. It is safe, because they are regenerated on
  every synth.
- Filed under `18` because it is test-harness hygiene with no home in a feature capability.

## Operator validation

None beyond a smoke test: the before/after directory count around a full `vitest run`.

## Resolution

**Approach: a private `TMPDIR` per test file, under the real temp dir.** Neither candidate in
the Notes was taken exactly as written. The chosen one keeps the second candidate's reach (every
`os.tmpdir()` user, not only the CDK) without its cost (growth on the repo's disk).

- `scripts/vitest-setup-tmpdir.mjs` (vitest `setupFiles`, runs in the worker before each test
  file is imported) sets `process.env.TMPDIR` to a fresh
  `<real tmp>/lost-soles-vitest-<worker pid>-XXXXXX` and removes it in `afterAll`. `os.tmpdir()`
  reads `TMPDIR` on every call, so the CDK `App`'s `mkdtemp("cdk.out")`, the Amplify data
  transformer's `transformer-assets-*` dirs (a second leak found while testing this), every
  suite's own `mkdtemp`, and child processes such as `pre-commit-hook.test.mjs`'s git repos all
  land inside it.
- `scripts/vitest-global-setup.mjs` (vitest `globalSetup`, main process) sweeps per-file dirs
  whose worker pid is dead, at setup (what a killed run left) and at teardown (what a file that
  threw at module scope left: such a file never runs its `afterAll`, and vitest ends the worker
  without an `exit` event; both checked empirically). It counts `cdk.out*` in the real temp dir
  at setup and **fails the run at teardown** if any new one appeared, naming them. That is the
  criterion-1 before/after check. It runs on every `npm test`, so the leak cannot return
  quietly. Checked: with `setupFiles` removed, one CDK suite fails the run with exit 1 and names
  the leaked `cdk.out` dir.
- `scripts/vitest-tmpdir.mjs` holds the shared helpers and the full rationale.
  `scripts/vitest-tmpdir.test.mjs` asserts the per-file `TMPDIR` is in effect, and that the sweep
  removes a dead pid's dir and spares a live one and unrelated entries.
- `vitest.config.ts` registers both at the root `test`, so the `node` and `edge` projects inherit
  them through `extends: true`.

**Rejected:**
- `CDK_OUTDIR`. Setting it makes every CDK `App` register a `beforeExit` auto-synth
  (`aws-cdk-lib` `core/lib/app.js`), so a worker would synthesise a second time on its way out.
  One shared outdir would also have concurrent suites writing the same stack template file that
  `Template.fromStack` reads back from disk. And it covers only the CDK.
- A repo-local `TMPDIR` (the gitignored `tmp/`). It moves the growth onto the repo's disk, and a
  leftover there is what the guard scripts already trip over (ticket `0250`). This approach
  writes nothing under the repo, so it does not interact with `0250`.

**Criterion 2, killed runs.** A failing test cleans up in `afterAll`. A module-scope throw (where
every CDK suite synthesises, so where an ENOSPC lands) is swept at teardown. A run killed by
Ctrl-C leaves its per-file dirs (measured: 18 after a SIGINT 7 s into `vitest run amplify`), and
the next run's setup removes them (measured: 0 after a one-file run). That is acceptable: only a
run killed outright leaves anything, and it lives at most until the next `vitest run`, on a tmpfs
that a reboot clears.

**Criterion 3.** No suite was edited. Every synth still imports the real `amplify/backend.ts`
and calls `Template.fromStack`. Only where the CDK writes its assembly changed.

**Coverage.** The fix is config-level, so it covers every synth-calling suite in the tree today
(18 `amplify/*.test.ts` files, up from the 10 listed above, including every `*-stack.test.ts`
suite `0283` names) and any added later, with no per-file opt-in to forget.

**Known limit.** The teardown check counts the whole real temp dir, so a *different* checkout
running a pre-0230 suite at the same moment can trip it. The error message says so. Once this is
on `main`, every checkout's runs write only to their own per-file dirs.

**Files:** `vitest.config.ts`, `scripts/vitest-tmpdir.mjs`, `scripts/vitest-setup-tmpdir.mjs`,
`scripts/vitest-global-setup.mjs`, `scripts/vitest-tmpdir.test.mjs`, this ticket.
