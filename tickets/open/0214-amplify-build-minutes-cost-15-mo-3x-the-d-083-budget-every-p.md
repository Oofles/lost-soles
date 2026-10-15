---
id: 214
slug: amplify-build-minutes-cost-15-mo-3x-the-d-083-budget-every-p
title: Amplify build minutes cost ~$15/mo, 3x the D-083 budget — every push to main runs a ~9.5-minute build
type: chore
priority: high
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-09-28T16:39:26Z
started: 2026-10-15T14:55:53Z
---

## Description

**Found at capability `08`'s drift audit, §5 (2026-09-28).** Cost Explorer, account `286588821906`:

| Month | AWS Amplify | of which `USE1-BuildDuration` |
|---|---|---|
| 2026-08 | $2.46 | |
| 2026-09 (to the 28th) | **$15.05** | **$14.77** |

D-083's target is ~$1–5/mo all-in. Hosting compute ($0.16) and data transfer ($0.12) are noise.
**Build minutes are the whole overrun.** The last 48 `lost-soles` `main` jobs averaged ~9.5 minutes,
and at $0.01/min, $14.77 works out to about 155 builds in September.

The cause is the working agreement meeting Amplify's defaults. D-150 commits and pushes to `main`
after every ticket close, and a close is usually 2–3 commits: the work, the Resolution, then
`tickets(#NNNN)`. Amplify builds **every** push, including ones that touch only `tickets/` or
`docs/` and cannot change the deployed app. Most of the 155 builds were probably those.

The account also carries AWS Business Support+ at $29/mo. That is account-level, the account hosts
six other Amplify apps, and it is not this project's to change. It is recorded here only so nobody
re-discovers it and mistakes it for this project's overrun.

## Acceptance criteria

- [ ] A push whose diff touches only non-deployable paths (`tickets/`, `docs/`, `*.md`, and
      anything else that provably cannot change the build output, each listed) does not run an
      Amplify build. Use a mechanism Amplify supports, e.g. an `amplify.yml` diff check that ends
      the build early or `[skip-cd]`, and record the choice.
- [ ] A push touching deployable code still builds and deploys. The gate fails OPEN: if it cannot
      decide, it builds.
- [ ] The GitHub Actions gate (`0013`) still runs on every push. This ticket is about the Amplify
      deploy only.
- [ ] The saving is measured: build count and `USE1-BuildDuration` for the two weeks after, against
      the same window before, recorded in `## Resolution`.

## Notes

Filed by the agent from capability `08`'s audit. Capability `18` is where it logically belongs, but
the money is spent now, so pulling it forward is reasonable if the operator wants it.

If the diff-gate is not enough, the other lever is build length. `npm install --no-save` with no
lockfile-exact cache (D-162, `0128`) is likely a large share of the ~9.5 minutes.

Related: D-083, D-150, D-162, `0128`, `0013`.

- **2026-10-02 (capability 09 audit, §5):** September actuals from Cost Explorer: **$50.29 total**.
  That is Business Support+ $29.00, Amplify $18.73 (`USE1-BuildDuration` 1,841.5 min = $18.41,
  so worse than this ticket's $15 estimate), KMS $1.85, Route 53 $0.56 and S3 $0.10. NAT gateways: 0.
  Excluding the support plan, the app runs about $21/mo against D-083's $1–5, and build minutes
  are 88% of it.

## Resolution

**Mechanism: a `commit-msg` hook that tags provably non-deployable commits with Amplify's skip
token (D-311).** Files: `.githooks/commit-msg`, `scripts/skip-cd.mjs`, `scripts/skip-cd.test.mjs`
(14 tests, run against real temporary repositories with a real upstream), a pointer comment in
`amplify.yml`, and D-311 in `DECISIONS.md`.

- **The non-deployable list**, anchored at the repo root: `docs/`, `tickets/`, `prompts/`,
  `.claude/`, `.github/`, `README.md`, `CLAUDE.md`. Grep at 0214 found nothing in `app/`, `lib/`,
  `src/`, `components/`, `amplify/` or `next.config.ts` reading them. `lib/tickets/` is app code
  and is not on the list. Nested markdown such as `src/**/__fixtures__/README.md` builds anyway.
- **It judges the whole unpushed range.** Amplify reads only the head commit's message, so a docs
  commit on top of an unpushed code commit is not tagged.
- **It fails open.** No upstream, a git error, an empty commit (the usual way to force a rebuild), a
  rename out of code (`--no-renames`), or any other path, and the push builds.
- **Amplify matches the token anywhere in the message.** Found by accident: the first code commit
  (`bc309fe`) mentioned the token in its subject and Amplify started no job. The hook now defuses
  a hand-typed token on any commit it would not tag itself (`f4c265d`, which deployed both).
- **Rejected:** an `amplify.yml` diff check, because a build cannot end early as a success. Also
  rejected: auto-build off plus a path-filtered GitHub Action calling `amplify start-job`, because
  it puts AWS credentials in GitHub. See D-311.
- **The GitHub Actions gate is unaffected.** It does not read the Amplify token: `gate`, `tickets`
  and `secret-scan` ran on `bc309fe`, the push Amplify skipped.

**Before, measured 2026-10-01 to 10-14:** 124 Amplify jobs on `main`, `USE1-BuildDuration`
1,233.2 min = **$12.33**. Replaying those 124 pushes through `shouldSkip` (each job's range runs
from the previous job's commit) gives **52 jobs and 525 of 1,246 wall-minutes skipped, 42%**.
That is the projection; the after figure has not been measured yet.

The bigger lever is still build length (~9 min each). `npm install --no-save` with no cache hit
(D-162, `0128`) is a likely share of it, and a lockfile-keyed cache could cut it.

## Operator validation

None: build configuration with nothing on screen. Smoke test by the agent: push a docs-only commit
and confirm the Amplify job is skipped or cancelled, push a code commit and confirm it deploys, then
check Cost Explorer for the before/after figures.
