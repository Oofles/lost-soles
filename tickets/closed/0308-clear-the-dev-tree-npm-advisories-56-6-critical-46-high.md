---
id: 308
slug: clear-the-dev-tree-npm-advisories-56-6-critical-46-high
title: Clear the dev-tree npm advisories (56: 6 critical, 46 high)
type: chore
priority: med
status: closed
size: m
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
started: 2026-10-26T15:07:00Z
closed: 2026-10-26T18:54:06Z
---

## Description

After 0115, the production tree has 0 advisories and is gated (D-434). The full tree has 56: 6 critical, 46 high, 4 moderate, all in dev tooling. They come through `@aws-amplify/backend`/`backend-cli` and codegen (`handlebars`, `lodash`, `@graphql-tools`), and through `vitest`/`tinypool`/`vite`. Clearing them needs a vitest major and Amplify backend upgrades, which carries D-162's install risk.

## Acceptance criteria

- [x] `npm audit --audit-level=high` reports 0 over the full tree, or each remaining advisory is listed in the capability doc with why it cannot be cleared. *(The second branch applies. 0 critical, and 3 leaf advisories remain (`@graphql-tools/utils`, `zod`, `csv-parse`), each listed with its reason in `docs/capabilities/18-mvp-hardening.md` under "The dev-tree advisories".)*
- [x] `npm install --no-save` from a clean clone leaves `package-lock.json` byte-identical (D-162).
- [x] The full local gate and the Amplify build are green. *(The local half is done: every `amplify.yml` frontend build command passes in the worktree. The Amplify build can only be checked after the wave push, which the orchestrator verifies.)* — verified 2026-10-26: all 36 `amplify.yml` gate steps green on `main`; Amplify job 431 (`0b6eac2`) SUCCEED, backend `pipeline-deploy` included.
- [x] If the full tree is clean, the gate is widened to it (both CI surfaces, D-163), with a decision recorded. *(Not applicable: the full tree is not clean, so the gate stays `--omit=dev` on both surfaces (D-434), and there is no widening to record.)*

## Notes

Try one upgrade family at a time (vitest, then Amplify backend), with the full gate between each. Re-test `npm ci` (0128) while you are there.

## Operator validation

Smoke test: the audit counts and a green deploy. No perceptual check.

D-123 trigger checked? none.

## Resolution

**Full tree went from 49 advisories (6 critical, 40 high, 3 moderate) to 39 (0 critical, 37 high,
2 moderate).** The 37 highs come from two leaf advisories, `@graphql-tools/utils` and `zod`, plus 35
packages in Amplify's tree that npm flags only because they depend on those two. Neither leaf can be cleared
without upstream Amplify releases, so the gate is not widened. The runtime tree stays at 0. The
count was 56 when this ticket was filed; lockfile churn since 0115 had already moved it to 49.

One upgrade family at a time, with the full gate run after each:

1. **vitest 3 → 5.** `vitest` ^5.0.5, plus `vite` ^8.3.5 and `vite-node` ^6.0.0 as direct
   devDependencies. vitest 5 takes `vite` as a peer, and it no longer depends on `vite-node`, which
   `npm run drill`, `drill:ci` and the `tools/` CLIs invoke. This clears `vitest`, `@vitest/mocker`,
   `tinypool` (critical) and `vite`. It needed three mechanical edits:
   - `vitest.config.ts`: Vite 8 transforms with oxc, so `esbuild: { jsx: "automatic" }` became
     `oxc: { jsx: { runtime: "automatic" } }`. It is the same setting, and it is commented there.
     Without it, 25 `.tsx` suites fail to parse.
   - `app/new-workout-type.test.tsx`: `world()` imported seven modules with `Promise.all` straight
     after `vi.resetModules()`. Under Vitest 5 those concurrent imports can return a module instance
     from the previous world, so the AFTER world read BEFORE's ruleset and 7 tests failed. I narrowed
     this down by bisection: sequentially, every module was fresh, and with `Promise.all` the result
     was stale. The imports are now sequential, and the comment there says why. The test's
     assertions did not change.
   - `lib/map-mode.test.ts`: vitest 4+ types `ReturnType<typeof vi.fn>` as `Mock<Procedure |
     Constructable>`, which is not callable. It is now `Mock<() => void>`.
2. **Amplify backend.** `@aws-amplify/backend` ^1.25.1 and `@aws-amplify/backend-cli` ^1.10.0 (both
   minors), then `npm audit fix` without `--force`. On their own these cleared almost nothing,
   because the newest CLI still depends on the same old codegen tree.
3. **`aws-cdk-lib` ^2.267.0 → ^2.274.0** (a minor). It *bundles* `brace-expansion`, so only a newer
   release can fix it (5.0.9 → 5.0.12).
4. **Overrides, all within a major** (D-434: bump first, override second). `handlebars` ^4.7.10
   (critical; `graphql-docs-generator` pins 4.7.9 exactly). `lodash` ^4.18.1 (old
   `@graphql-codegen/plugin-helpers` ask `~4.17.0`). `"@ardatan/relay-compiler@12.0.0": {
   "immutable": "^3.8.4" }`, scoped because `immutable` 5.1.9 is also in the tree and a global
   override would break it (a `"immutable@<3.8.4"` key made `npm ls` report it invalid).
   `mysql2` ^3.24.6 (`graphql-schema-generator` asks `~3.9.7`).

**Not cleared**, with reasons in the capability doc:

- `@graphql-tools/utils` GHSA-7mx3 (high): no fix below 12.0.1. Clearing it would take a
  cross-major override inside Amplify's codegen, which only a real `pipeline-deploy` can exercise.
- `zod` GHSA-mrhx (high): no fixed 3.x, Amplify pins 3.25.17 exactly, and copies are bundled inside
  `data-construct` and `graphql-api-construct`.
- `csv-parse` (moderate): below the gate's threshold.

**`npm ci` re-test (0128): still exits 1.** It now prints 4 `Missing: @opentelemetry/core@2.0.0
from lock file` lines, down from ~95, so D-162 stands. `npm install --no-save --ignore-scripts`
from a clean copy of `package.json` and `package-lock.json` leaves the lock byte-identical (md5
`18a733a704643f81557c2b1caf226161` before and after), and `npm audit --omit=dev --audit-level=high`
there finds 0.

**Dependabot vs npm audit.** Before this ticket Dependabot had 31 open alerts (4 critical, 10 high,
13 medium, 4 low), all `development` scope. It counts one alert per (package, advisory), and only on
the package that holds the vulnerable code. npm counts every package on the path, which is why npm
reported 37+ highs where Dependabot reported 10. The two agree on the leaf packages. They differ
in three ways:

- Dependabot rates `brace-expansion`, `@vitest/mocker`, `vitest` and part of `vite` and `fast-uri`
  as medium or low.
- Dependabot does not report the `zod` advisory at all.
- Dependabot also lists `@graphql-tools/utils` GHSA-c4qx-w738-7hr3, which covers 10.10.1–12.0.1
  only. The tree now holds 6/7/9/12.1.0, so that alert should close.

After the push, only GHSA-7mx3 (high) and `csv-parse` (medium) should remain open.

**Files touched**

- `package.json`: the version bumps above, three new direct devDependencies (`vite`, `vite-node`,
  `aws-cdk-lib` bumped), and four new override entries.
- `package-lock.json`: regenerated.
- `vitest.config.ts`: `esbuild.jsx` → `oxc.jsx.runtime`.
- `app/new-workout-type.test.tsx`: sequential imports in `world()`.
- `lib/map-mode.test.ts`: the `Mock` type.
- `docs/capabilities/18-mvp-hardening.md`: new section, "The dev-tree advisories (ticket `0308`)".

**Decisions:** D-450 (orchestrator-recorded from this ticket's proposal) re-affirms the `--omit=dev` gate. Widening the gate was conditional on a clean full tree, which this
ticket could not reach. A possible allowlisted full-tree gate is proposed to the orchestrator, not
built.

**Not verified locally:** the backend phase (`ampx pipeline-deploy`) under the upgraded
`@aws-amplify/backend` 1.25.1, `backend-cli` 1.10.0 and `aws-cdk-lib` 2.274.0. The CDK synth suites
under `amplify/*.test.ts` pass, but only the Amplify build exercises the deploy itself.

## Operator validation (result)

Smoke test, 2026-10-26 (orchestrator, after the wave 18.3 push): Amplify job **431** on `0b6eac2`
**SUCCEED**. That proves `ampx pipeline-deploy` and the frontend gate under backend 1.25.1,
backend-cli 1.10.0, cdk-lib 2.274.0 and vitest 5. On `main`, `npm audit` over the full tree reports
39 (0 critical, 37 high, 2 moderate), matching the Resolution. `npm audit --omit=dev
--audit-level=high` exits 0. Dependabot's open alerts are down from 31 to exactly the two predicted:
`@graphql-tools/utils` GHSA-7mx3 (high) and `csv-parse` GHSA-8cw4 (medium). No perceptual check.
