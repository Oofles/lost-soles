---
id: 319
slug: re-check-the-amplify-tree-advisories-graphql-tools-utils-zod
title: Re-check the Amplify-tree advisories (@graphql-tools/utils, zod) on the next backend-cli release
type: chore
priority: low
status: deferred
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-26T16:05:00Z
deferred: 2026-10-26T22:03:09Z
---

## Description

Found by 0308. The two leaf advisories behind the full tree's 37 highs, @graphql-tools/utils GHSA-7mx3 and zod GHSA-mrhx, both wait on an upstream @aws-amplify/backend-cli release (D-450). Re-run npm audit after the next release and clear whatever it fixes.

## Deferred

**Reason:** Waits on an upstream @aws-amplify/backend-cli release past 1.10.0 (D-450); none since 2026-09-10.

**Re-check** — the cheap test that says the wait is over. `tickets.mjs recheck 0319`
runs it and reports the result; nothing un-defers on its own. When it exits 0, read the
output and `tickets.mjs resume 0319`.

```sh
v=$(npm view @aws-amplify/backend-cli version 2>/dev/null); if [ -n "$v" ] && [ "$v" != "1.10.0" ]; then echo "READY: backend-cli $v released (was 1.10.0)"; else echo "WAITING: backend-cli still ${v:-unknown}"; fi
```


## Acceptance criteria

- [ ] `npm audit` is re-run after the next `@aws-amplify/backend-cli` release. Every advisory that the
      release fixes is cleared within a major (D-434), and the 0308 section of `18-mvp-hardening.md`
      is updated with the new counts.
- [ ] D-162 holds: `npm install --no-save` from a clean clone leaves `package-lock.json` byte-identical.
- [ ] The full local gate and the Amplify build are green.

## Notes

Waits on an upstream release, so this is a candidate for `tickets.mjs defer` with a re-check that compares `npm view @aws-amplify/backend-cli version` against 1.10.0.

## Operator validation

Smoke test: the audit counts and a green deploy. No perceptual check.

D-123 trigger checked? none.
