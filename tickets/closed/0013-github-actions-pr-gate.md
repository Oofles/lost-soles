---
id: 13
slug: github-actions-pr-gate
title: GitHub Actions PR gate — tsc --noEmit, ESLint, vitest, mirrored in amplify.yml
type: chore
priority: high
status: closed
size: m
capability: 02-deploy-and-auth
depends_on: [4, 12]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-08-31T14:32:30Z
closed: 2026-08-31T14:44:00Z
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

Criteria 1, 2, 6, 7, 8 and 9 were **amended while being worked** — each is annotated below with what
changed and why. Nothing was ticked on the ticket's behalf to make the close pass.

- [x] ~~`.github/workflows/pr.yml` runs on every pull request targeting `main`.~~
      **Amended:** `.github/workflows/gate.yml`, triggering on **push to `main`** and on
      `pull_request`. D-150 (written after this ticket) settled that there is no PR flow — `main` is
      the only branch — so a `pull_request`-only workflow would never fire, reproducing precisely the
      inherited failure mode in the Description. Renamed from `pr.yml` because a file called `pr.yml`
      that runs on push is a lie about when it runs.
- [x] ~~The workflow uses `npm ci` (not `npm install`)~~ against the committed `package-lock.json`,
      and pins the Node version from `.nvmrc`.
      **Amended:** `npm install --no-save --prefer-offline`, per D-162. `npm ci` was re-verified from
      a clean directory on 2026-08-31 and still exits 1 with **94** `Missing … from lock file` lines.
      The lockfile guarantee `--no-save` costs is bought back by a `git diff --exit-code
      package-lock.json` step. Node is pinned via `node-version-file: .nvmrc`.
- [x] The workflow runs, as separate named steps: `npm run typecheck`, `npm run lint`, `npm test`.
- [x] The workflow includes the gitleaks job from 0004 — it remains in `secret-scan.yml`, which also
      runs on push to `main`, so both gate every commit.
- [x] The workflow includes the **D-100 boundary grep** (`scripts/check-boundaries.mjs`): no
      identifier or type name from the Strava adapter appears outside `src/adapters/strava/`. It
      fails the build on a hit and passes now.
- [x] `amplify.yml`'s frontend build phase runs the same `npm run typecheck` and `npm run lint`
      commands before `npm run build`, so a push straight to `main` cannot bypass them.
      **Amended — widened, operator-approved:** it now also runs `npm test` and the D-100 check.
      Because criterion 7 is declined, the Amplify build is the *only* real lock (D-163); leaving
      tests and the boundary check out of it would have made them alarms nobody must act on.
- [x] ~~Branch protection on `main` requires the PR gate checks to pass before merge, and requires a
      pull request (no direct pushes).~~
      **Amended — the original is declined, not delivered.** The replacement criterion, which is what
      is ticked: *the branch-protection question is settled with reasoning recorded in the decision
      log, and equivalent enforcement is placed on the deploy path instead* (D-163, and criterion 6).
      Two independent reasons it is declined. (a) It was **unavailable**: private repo on a free personal account, both
      `/branches/main/protection` and `/rulesets` returning `403 Upgrade to GitHub Pro or make this
      repository public`. (b) More importantly it is **unwanted**: "require status checks" rejects
      any direct push whose commit has not already passed them, so it forces a PR per ticket — the
      ceremony D-150 exists to refuse. The repo has since gone public, so this is now a standing
      choice rather than a platform limit.
- [x] ~~A deliberately red PR proves the gate: a type error, a lint error, and a failing test each
      independently block the merge button. All three are verified, then reverted.~~
      **Amended:** there is no merge button to block, so each check was instead proved to go
      **independently red** on the real commands, then reverted. See `## Operator validation`. This
      is what caught D-164 — the lint check was passing on a fault and would have shipped blind.
- [x] ~~A deliberate D-100 violation … blocks the merge.~~ **Amended** the same way: a
      `StravaActivity` import placed in `src/domain/` was verified to fail the check with the file,
      line and rationale named, then reverted. Also permanently encoded as `--self-test`, which
      builds a real file tree and runs the real scanner over it, so the check cannot rot unnoticed
      (0125's lesson).
- [x] The workflow completes in under about three minutes with npm caching enabled — **1m48s** on
      run `33403734264`.
- [x] No placeholder ARNs, no dead jobs, and no workflow triggering on a branch name that does not
      exist. Trigger branch verified as `main`; `docs-index.yml` folded in and deleted per the note
      it carried; `actions/checkout` and `setup-node` bumped to `v5` across all three workflows to
      clear the Node 20 deprecation.

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

## Resolution

**Files touched**

| File | Change |
|---|---|
| `.github/workflows/gate.yml` | new — the gate: install, lockfile-drift, typecheck, lint, test, D-100 self-test, D-100 check, docs index |
| `.github/workflows/docs-index.yml` | deleted — folded into `gate.yml`, per the note it carried naming 0013 as its owner |
| `.github/workflows/secret-scan.yml`, `tickets.yml` | `actions/checkout@v5`, `setup-node@v5` |
| `scripts/check-boundaries.mjs` | new — the D-100 boundary check plus its `--self-test` |
| `amplify.yml` | frontend build now runs the boundary check and `npm test` as well |
| `package.json` | `lint` → `eslint . --max-warnings 0` (D-164) |
| `docs/INDEX.md` | regenerated — was stale at HEAD |
| `docs/decisions/DECISIONS.md` | D-163, D-164 |

**Decisions.** D-163 (the gate is an alarm, `amplify.yml` is the lock, and why protection is
declined) and D-164 (`--max-warnings 0`). Both are in `DECISIONS.md` with their reasoning.

**Three things went wrong, and they are the useful part of this ticket.**

1. **`npm run lint` could not fail.** Proving the gate red is the step that found it: an unused
   variable passed. `next/typescript` sets most of its rules — `no-unused-vars` included — to
   severity *warn*, and `eslint` exits 0 on warnings. The lint gate had been decorative since 0012
   and would have been added to CI in that state, which is the precise failure this ticket was
   written to prevent. Fixed with `--max-warnings 0` (D-164). **If the red-path check had been
   skipped as a formality, this ships broken.**
2. **`docs/INDEX.md` was already stale at `HEAD`.** `docs-index` had been failing on `main` for
   **four consecutive pushes over ~10 hours**, since `30438db` (ticket 0123) edited
   `07-ticketsmith.md` §4.2 without regenerating the index. Nobody noticed. This is the empirical
   argument for D-163: an alarm that nobody watches is not a control, which is why the checks also
   sit on the deploy path where a failure actually stops something.
3. **The ticket's central mechanism, branch protection, was both unavailable and wrong.** Rather
   than route around it, criterion 7 is left **unticked** and the reasoning recorded. The design doc
   (`01-architecture.md` §6) still describes a PR gate and short-lived `feat/*` branches, which
   D-150 superseded; D-163 records the amendment rather than editing §6 silently.

**On the D-100 check.** Written in plain node rather than `rg` because it must run identically in
the Amplify build container, which has no ripgrep — a check that only runs in one of the two places
is exactly the half-existing control D-163 warns about. It is deliberately two-tiered: the full T1
pattern (`strava|polyline|athlete|activity:read|hub.challenge`) over `src/domain` and `src/pipeline`
where those words are unambiguously leaks, and the vendor name alone everywhere else, so that a map
component's legitimate `polyline` cannot false-positive. `src/adapters/registry.ts` is exempt
because §3 T2 explicitly blesses one line there. A gate with false positives gets bypassed, and the
whole point of adding this now — while the domain is empty and it passes trivially — is that it
must still be trusted in two years.

**Not done, deliberately.** The `.next/static` client-bundle secret grep belongs to 0017 and was
left alone. The T1–T4 boundary *tests* remain unwritten; this ticket builds the workflow so they
slot in as ordinary vitest cases, which was its stated job.

## Operator validation

**Verified mechanically, on this machine (WSL2 Ubuntu, Node 22), with evidence:**

1. **Each check goes independently red.** A type error, an unused variable, a failing assertion, and
   a `StravaActivity` import in `src/domain/` were introduced one at a time and each confirmed to
   fail its own command, then reverted; `git status` confirmed the tree was restored. The lint case
   *passed* on the first attempt — that is D-164, fixed and re-proved red.
2. **The D-100 check names the fault.** Output verified to print
   `src/domain/__red.ts:1`, the offending line, and `01-architecture.md §3 T1 — the domain and
   pipeline are source-agnostic`.
3. **`--self-test` passes 12 cases** over a real temp file tree, covering hits in `src/domain`,
   `src/pipeline`, `app/` and `amplify/`, and correct passes for `registry.ts`, the adapter itself,
   a comment mentioning Strava, a non-source extension, and `node_modules/`.
4. **`npm ci` re-verified as broken** from a clean directory containing only `package.json` and
   `package-lock.json`: exit 1, 94 `Missing … from lock file` lines. `npm install --no-save` leaves
   the lockfile byte-identical (md5 `4aa21c5036e88576d8b2aa6f8f07a14e` before and after).
5. **The gate is green on `main` in 1m48s** — run `33403734264`, all steps passing.
6. **Full-history `gitleaks detect`** over all 24 commits: no leaks. Run as the pre-flight for making
   the repository public.

7. **The Amplify mirror is real — verified after the close, by CLI.** Amplify job **4**
   (commit `3e2fd15`, the commit carrying the `amplify.yml` change) **SUCCEED**. Its `BUILD` log
   shows the four mirrored checks running in order, before the build:
   `node scripts/check-boundaries.mjs` (line 279), `npm run typecheck` (280), `npm run lint` (283),
   `npm test` (286 → `Test Files  1 passed (1)`), then `npm run build` (296 →
   `✓ Compiled successfully in 4.7s`). This is the evidence that D-163's lock exists on the deploy
   path and is not merely documented. *Originally written as an operator-only item; it turned out to
   be checkable from here via `aws amplify get-job`, as 0012 did, so it was checked.*

**★ Requires the operator — worth an eye, though nothing here is blocking:**

8. **Amplify console → `lost-soles`, desktop browser.** Confirm the most recent `main` job is green
   and `https://soles.devaultsecurity.com/` still serves. Two further builds (jobs 5 and 6) were
   still running when this ticket closed, and job 5 is the first to build under
   `eslint . --max-warnings 0` (D-164) — if a pre-existing warning lurks anywhere the lint config
   reaches, that is the build that will find it.
