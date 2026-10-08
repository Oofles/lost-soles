---
id: 250
slug: typecheck-lint-and-tests-ignore-the-gitignored-tmp-scratch-d
title: Typecheck, lint and tests ignore the gitignored tmp/ scratch directory
type: chore
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-08T15:18:40Z
---

## Description

`tmp/` is the gitignored scratch directory where tickets keep their throwaway probes
(`tmp/0073/smoke.ts`, `tmp/0077/harness.js`, …). `tsconfig.json`'s `include: ["**/*.ts", …]` and
the ESLint config both pick it up, so a probe can fail the build gates for code that never ships.

It has now bitten twice: `0246` "fixed the script, not the lint config", and the `11-skills-panel`
audit (2026-10-08) failed §1 on `typecheck` (`tmp/0242/smoke.ts`, TS2589) and `lint` (1,008
problems, every one in the bundled `tmp/0077/harness.js`). Moving `tmp/` aside made §1 12/12.

## Acceptance criteria

- [ ] `tsconfig.json` excludes `tmp`.
- [ ] The ESLint config ignores `tmp/`.
- [ ] Vitest does not collect tests from `tmp/` (check its include/exclude; add an exclude if a
      `*.test.*` file there would be picked up).
- [ ] With a deliberately broken `.ts` file and a lint-failing `.js` file in `tmp/`,
      `npm run typecheck`, `npm run lint` and `npm test` all pass; with the same files moved into
      `src/`, they fail.

## Notes

Separately, the agent shell defaults to Node 20 (see the WSL setup memory); `unit-tests` failed on
it in the same audit and passed on Node 22. Not this ticket's problem, but worth an `engines` /
`.nvmrc` check if it recurs.

## Operator validation

None: build configuration with nothing to look at. The criterion above is the smoke test.
