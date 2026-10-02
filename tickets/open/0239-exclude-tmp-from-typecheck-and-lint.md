---
id: 239
slug: exclude-tmp-from-typecheck-and-lint
title: tsc and eslint include the gitignored tmp/ smoke scripts, so the audit's typecheck and lint rows fail locally
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-02T15:19:39Z
---

## Description

**Found running capability 09's drift audit (2026-10-02).** `tmp/` is gitignored
(`.gitignore:66`) and is where sessions put throwaway smoke scripts (`tmp/0198/verify.ts`,
`tmp/0234/smoke.ts`, `tmp/0235/smoke.ts`). But `tsconfig.json` and the ESLint config still include
it. So `tickets.mjs audit`'s `typecheck` and `lint` rows FAIL locally on scripts that are not
in the repo, while CI on a clean checkout is green. With `tmp/` moved aside, both rows passed.

Every audit hits this, and the obvious workaround (deleting the operator's scratch) destroys evidence.

## Acceptance criteria

- [ ] `tsconfig.json` excludes `tmp/`, and the ESLint config ignores it.
- [ ] With a deliberately ill-typed, lint-failing file in `tmp/`, `npm run typecheck` and
      `npm run lint` both pass.
- [ ] Nothing tracked stops being checked: the file count `tsc --listFilesOnly` reports outside
      `tmp/` is unchanged.

## Notes

TODO

## Operator validation

TODO
