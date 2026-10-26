---
id: 239
slug: exclude-tmp-from-typecheck-and-lint
title: tsc and eslint include the gitignored tmp/ smoke scripts, so the audit's typecheck and lint rows fail locally
type: chore
priority: low
status: closed
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-02T15:19:39Z
closed: 2026-10-26T12:45:58Z
---

## Description

**Found running capability 09's drift audit (2026-10-02).** `tmp/` is gitignored
(`.gitignore:66`) and is where sessions put throwaway smoke scripts (`tmp/0198/verify.ts`,
`tmp/0234/smoke.ts`, `tmp/0235/smoke.ts`). But `tsconfig.json` and the ESLint config still include
it. So `tickets.mjs audit`'s `typecheck` and `lint` rows FAIL locally on scripts that are not
in the repo, while CI on a clean checkout is green. With `tmp/` moved aside, both rows passed.

Every audit hits this, and the obvious workaround (deleting the operator's scratch) destroys evidence.

## Acceptance criteria

- [x] `tsconfig.json` excludes `tmp/`, and the ESLint config ignores it.
- [x] With a deliberately ill-typed, lint-failing file in `tmp/`, `npm run typecheck` and
      `npm run lint` both pass.
- [x] Nothing tracked stops being checked: the file count `tsc --listFilesOnly` reports outside
      `tmp/` is unchanged.

## Notes

A near-duplicate of `0250`, filed independently. Closed by `0250`'s change.

## Resolution

**Satisfied by `0250`; no code in this ticket.** `0250` (commit `2d2aac1`) added `"tmp"` to
`tsconfig.json`'s `exclude`, `"tmp/**"` to the ESLint global ignores, and `"tmp/**"` to vitest's
shared exclude. This ticket's three criteria are a subset of `0250`'s. The `0250` agent mapped each
one, and the orchestrator re-checked them on main rather than tick them on trust (below). The
`tmp/` scan in the Strava adapter test, which neither ticket covered, is `0316`.

## Operator validation

None: build configuration with nothing to look at. **Smoke test, 2026-10-26 (orchestrator, main at
`65bb872`):** with an ill-typed `.ts` (`const a: number = "s"`) and a lint-failing `.js`
(`var u = 1`) in `tmp/v0239/`, `npm run typecheck` and `npm run lint` both passed.
`tsc --listFilesOnly -p .` outside `tmp/` and `node_modules` gave 608 files with the pre-`0250`
tsconfig and 608 with the current one.
