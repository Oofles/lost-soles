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
started: 2026-10-26T03:02:11Z
---

## Description

`tmp/` is the gitignored scratch directory where tickets keep their throwaway probes
(`tmp/0073/smoke.ts`, `tmp/0077/harness.js`, …). `tsconfig.json`'s `include: ["**/*.ts", …]` and
the ESLint config both pick it up, so a probe can fail the build gates for code that never ships.

It has now bitten twice: `0246` "fixed the script, not the lint config", and the `11-skills-panel`
audit (2026-10-08) failed §1 on `typecheck` (`tmp/0242/smoke.ts`, TS2589) and `lint` (1,008
problems, every one in the bundled `tmp/0077/harness.js`). Moving `tmp/` aside made §1 12/12.

## Acceptance criteria

- [x] `tsconfig.json` excludes `tmp`.
- [x] The ESLint config ignores `tmp/`.
- [x] Vitest does not collect tests from `tmp/` (check its include/exclude; add an exclude if a
      `*.test.*` file there would be picked up).
- [x] With a deliberately broken `.ts` file and a lint-failing `.js` file in `tmp/`,
      `npm run typecheck`, `npm run lint` and `npm test` all pass; with the same files moved into
      `src/`, they fail.

## Notes

Separately, the agent shell defaults to Node 20 (see the WSL setup memory); `unit-tests` failed on
it in the same audit and passed on Node 22. Not this ticket's problem, but worth an `engines` /
`.nvmrc` check if it recurs.

## Resolution

Three one-line config edits, no code:

- `tsconfig.json`: `"tmp"` added to `exclude`. An `exclude` entry only filters what `include`
  globs pick up, so a tracked file that imports something in `tmp/` would still pull it in. That
  is the right behaviour (a tracked import of scratch is a real bug), and nothing tracked does it.
- `eslint.config.mjs`: `"tmp/**"` added to the global `ignores` block, next to `scripts/**`, with
  a comment citing this ticket.
- `vitest.config.ts`: `"tmp/**"` added to the shared `EXCLUDE` constant. Vitest *would* have
  collected a `tmp/**/*.test.ts`: the `INCLUDE` globs are `**/*.test.*` and nothing excluded `tmp/`.
  Both projects (`node`, `edge`) use `EXCLUDE`, so one edit covers both.

Proof, run in this worktree with Node 22. The probes were `tmp/0250/broken.ts` (TS2322),
`tmp/0250/lintfail.js` (unused var, which fails under `--max-warnings 0`) and
`tmp/0250/fail.test.ts` (`expect(1).toBe(2)`):

- Before the edit: `typecheck` failed on TS2322, `lint` failed with 1 warning, and vitest
  collected and failed the tmp test.
- After the edit, with the probes still in `tmp/`: `npm run typecheck`, `npm run lint` and the
  full `npx vitest run` (268 files) all exit 0.
- With the same three files copied into `src/zz0250/`: `typecheck` fails (TS2322), `lint` exits 1
  and vitest fails the test. The copy was then removed.
- `tsc --listFilesOnly` (node_modules filtered out) lists the same 600 files before and after,
  diffed line by line. So nothing tracked stopped being typechecked.

No decisions were needed. The Node 20 note in `## Notes` is out of scope and was left alone.

## Operator validation

Nothing to look at. The before, after and moved-into-`src/` runs above are the smoke test. CI
runs on a clean checkout, which has no `tmp/`, so the deploy changes nothing.
