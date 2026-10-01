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

- [ ] A full `vitest run` leaves no new `cdk.out*` directory in `os.tmpdir()`. A check counts them
      before and after, so the leak cannot quietly return.
- [ ] Cleanup also happens when a suite fails or the run is interrupted mid-way, or the ticket
      records why a leftover from a killed run is acceptable.
- [ ] The CDK assertion suites still pass and still synthesise the real `backend.ts`. The fix
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
