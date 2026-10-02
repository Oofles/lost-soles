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

## Operator validation

None: build configuration with nothing on screen. Smoke test by the agent: push a docs-only commit
and confirm the Amplify job is skipped or cancelled, push a code commit and confirm it deploys, then
check Cost Explorer for the before/after figures.
