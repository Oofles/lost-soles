---
id: 13
slug: github-actions-pr-gate
title: GitHub Actions PR gate — tsc --noEmit, ESLint, vitest, mirrored in amplify.yml
type: chore
priority: high
status: open
size: m
capability: 02-deploy-and-auth
depends_on: [4, 12]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-08-31T14:32:30Z
---

## Description

`devaultsecurity` has **no CI**: its only workflow is a dead Hugo→S3 deployer triggering on `main` in
a repo whose default branch is `master`, still carrying the placeholder role ARN
`arn:aws:iam::123456789012:role/MyHugoProject_S3Deployer`. Amplify's build is its only gate and it
runs neither lint, typecheck, nor tests (`01-architecture.md` §6 CI).

Lost Soles gates on PR with a GitHub Actions workflow running `tsc --noEmit`, ESLint and `vitest`,
and **the same commands run in the Amplify build** so a direct push to `main` cannot bypass them.
An app doing geometry math, OAuth token handling and permanent append-only writes is exactly the kind
that needs type checking on the deploy path.

The workflow also carries the boundary tests that later capabilities depend on. §3 of
`01-architecture.md` defines four boundary tests (T1–T4) that prove the adapter architecture holds;
the CI **grep enforcing D-100** — no Strava type outside `src/adapters/strava/` — is one of them
(`contracts/ingestion-contract.md` §5). Those tests do not exist yet. This ticket builds the
workflow so that they slot in as ordinary `vitest` cases when their capabilities land, and adds the
D-100 grep now, while the codebase is empty and it therefore trivially passes — a grep added later,
after a leak, is a grep that has already failed at its job.

Branch protection on `main` makes the gate real: without it, a green-or-red check is advisory.

## Acceptance criteria

- [ ] `.github/workflows/pr.yml` runs on every pull request targeting `main`.
- [ ] The workflow uses `npm ci` (not `npm install`) against the committed `package-lock.json`, and
      pins the Node version from `.nvmrc`.
- [ ] The workflow runs, as separate named steps: `npm run typecheck`, `npm run lint`, `npm test`.
- [ ] The workflow includes the gitleaks job from 0004 (or that job remains in its own workflow and
      is also required — either way both are required checks).
- [ ] The workflow includes the **D-100 boundary grep**: no identifier or type name from the Strava
      adapter appears outside `src/adapters/strava/`. It fails the build on a hit and passes now.
- [ ] `amplify.yml`'s frontend build phase runs the same `npm run typecheck` and `npm run lint`
      commands before `npm run build`, so a push straight to `main` cannot bypass them.
- [ ] Branch protection on `main` requires the PR gate checks to pass before merge, and requires a
      pull request (no direct pushes).
- [ ] A deliberately red PR proves the gate: a type error, a lint error, and a failing test each
      independently block the merge button. All three are verified, then reverted.
- [ ] A deliberate D-100 violation (a Strava type imported into a file outside the adapter directory)
      blocks the merge. Then reverted.
- [ ] The workflow completes in under about three minutes on a typical PR, with npm caching enabled —
      a gate slow enough to be resented is a gate that gets bypassed.
- [ ] No placeholder ARNs, no dead jobs, and no workflow triggering on a branch name that does not
      exist. (The inherited failure mode: verify the trigger branch is `main`, not `master`.)

## Notes

Amplify's clean `npm ci` environment has historically been **stricter than local** in this account —
path aliases that resolved locally did not resolve in CI, and a whole directory was missing from a
commit (`ed8095b`, `8b4270d`, `8d97534`). The PR gate running the same `npm ci` is the cheapest
possible early warning for that class of bug, which is a second reason it mirrors the Amplify
commands rather than approximating them.

The client-bundle secret grep of `.next/static` is a **different** check and belongs to 0017. Keep
them separate: this one gates correctness, that one gates leakage.

PR previews get their own backend stack and their own secret namespace (`01-architecture.md` §6), so
a PR that changes backend definitions is genuinely exercised rather than merely type-checked.

## Operator validation

1. In a desktop browser, open a scratch PR that introduces a type error. The **Checks** section must
   show the typecheck step red, and the green merge button must be replaced by a blocked state. Read
   the failing step's log and confirm it names the file and line.
2. Repeat for a lint error and for a failing test, one at a time, confirming each is separately
   blocking. Close the PR.
3. In a desktop browser, GitHub → Settings → Branches: confirm `main` shows a protection rule with
   the required checks listed by name, and "Require a pull request before merging" ticked.
4. On the laptop, attempt `git push origin main` directly with a trivial commit. It must be
   **rejected** by the remote. This is the check that proves the gate cannot be walked around.
5. In the Amplify console, open the most recent `main` build log and confirm the typecheck and lint
   commands appear in it and succeeded — proving the mirror is real and not just documented.
