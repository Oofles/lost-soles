---
id: 318
slug: widen-the-npm-audit-gate-to-the-full-tree-with-a-reviewed-ad
title: Widen the npm audit gate to the full tree with a reviewed advisory allowlist
type: chore
priority: low
status: closed
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-26T16:05:00Z
started: 2026-10-26T22:03:10Z
closed: 2026-10-27T01:51:43Z
---

## Description

Found by 0308. The full tree cannot reach 0 high without upstream Amplify releases (D-450), so the gate stays --omit=dev and a new dev-tree critical goes unnoticed between Dependabot alerts. An allowlist of the 2-3 known Amplify-tree GHSAs would let the full tree be gated now. That is a design choice and needs a decision before it is built.

## Acceptance criteria

- [x] A decision is recorded: either gate the full tree with an allowlist (format, owner, and an
      expiry or re-check rule per entry), or keep D-450's `--omit=dev` gate as is.
      *The operator chose the allowlist (2026-10-26); proposed to the orchestrator as D-459 for
      recording in DECISIONS.md, which a wave agent may not edit.*
- [x] If the full tree is gated: both CI surfaces (`gate.yml` and `amplify.yml`, D-163) fail on any
      high not on the allowlist, and a test proves an unlisted advisory turns the gate red.
- [x] The allowlist names only the advisories in `18-mvp-hardening.md`'s 0308 section, each with
      its reason. *The two highs only; `csv-parse` GHSA-8cw4-87c7-c6xx is moderate, below the
      gate, so it needs no entry.*

## Notes

Run this after `0319` if an upstream release is close: a clean tree removes the need for an allowlist.

## Operator validation

None: CI tooling. The smoke test is the gate failing on a planted unlisted advisory, and a green build without one.

**Result, 2026-10-26.** Planted red: `npx vitest run scripts/check-npm-audit.test.mjs` includes "turns
red on an unlisted high advisory", and the suite passed on `main` in the gate. Green on both CI
surfaces for `35adb32`:
- GitHub Actions `gate` run 40432438791 printed `check-npm-audit: self-test passed (8 cases)` and
  `full tree OK … (admitted: @graphql-tools/utils GHSA-7mx3-vvmw-hjmv, zod GHSA-mrhx-c7xc-m3w5)`.
- Amplify job 436 succeeded with both lines in its build phase.
- Locally, the orchestrator ran the self-test and the live check on `main`: both exit 0.

D-123 trigger checked? none.

## Resolution

**Decision (operator, 2026-10-26, proposed as D-459): gate the full tree with a reviewed
allowlist.** Amends D-450 (the gate is no longer only `--omit=dev`) and D-434's gate wording;
D-163's two-surface rule holds, both surfaces run the same check.

Files touched:
- `scripts/check-npm-audit.mjs` (new): runs `npm audit --json` over the full tree (or `--input
  <file>`), collects advisories from the `via` OBJECTS only, keyed by (leaf package, GHSA id) at
  the highest severity reported. Parent entries, whose `via` holds package names, are paths and
  contribute nothing: the 37 highs are two advisories. Fails on: an unlisted high/critical; a
  listed advisory re-rated above the severity its entry admits; a stale entry whose advisory is no
  longer in the audit at any severity; a malformed allowlist (missing field, non-GHSA id, below-gate
  severity, duplicate); and an unreadable audit (npm `error` document, non-v2 shape, unparseable
  output), fail-closed per D-176. `--self-test` plants each failure against the fixture.
- `scripts/npm-audit-allowlist.json` (new): two entries, `@graphql-tools/utils`
  GHSA-7mx3-vvmw-hjmv and `zod` GHSA-mrhx-c7xc-m3w5, each with `package`, `advisory`, `severity`
  (`high`), `owner` (`operator`), `reason` (from 18-mvp-hardening.md's 0308 section) and `recheck`
  (reviewed when `0319` resumes, i.e. on an `@aws-amplify/backend-cli` release past 1.10.0).
- `scripts/fixtures/npm-audit-full-tree.json` (new): a trimmed real `npm audit --json` capture
  (the two allowlisted leaves, moderate `csv-parse`, two parent entries, real metadata).
- `scripts/check-npm-audit.test.mjs` (new): 11 tests, no registry access. An unlisted high or
  critical turns the gate red; an allowlisted GHSA on a different package is not admitted;
  moderates pass; re-rating, stale entries, malformed allowlists and npm error documents fail.
- `amplify.yml`, `.github/workflows/gate.yml`: `check-npm-audit.mjs --self-test` then the live
  check, right after the runtime audit line on both surfaces.
- `docs/08-security-privacy.md` §7.5 and `docs/capabilities/18-mvp-hardening.md` (0308 section):
  as-built notes; the "gate is not widened" paragraph is marked superseded.

Choices made:
- **Stale entries FAIL, not warn.** It was cheap (the advisory set is already in hand), and a
  warning in a green build log is read by nobody. When `0319` lands an Amplify release that clears
  an advisory, the build goes red until the entry is removed, which is exactly the re-check.
- **The `--omit=dev --audit-level=high` line stays.** The allowlist exists for the dev tree; if
  either allowlisted advisory ever reached the runtime tree, the full-tree check alone would admit
  it. Keeping the runtime line keeps the runtime tree at zero exceptions, for one extra audit call.
- **Matched on (package, GHSA), not GHSA alone**, so a listed advisory id turning up on another
  package is a new finding. **Severity is capped per entry**, so a re-rating to critical is
  re-reviewed rather than silently admitted.
- Threshold stays `high` (D-434's "high/critical only"); moderates are ignored as before.

Verification: every amplify.yml frontend build-phase command (guards, `npm run typecheck`, `npm run
lint`, `npm test`, `npm run build`, post-build checks) exits 0 in the worktree; `npx vitest run`
276 files / 4537 tests passed; `node scripts/check-npm-audit.mjs` against the live registry passes,
admitting exactly the two entries.

