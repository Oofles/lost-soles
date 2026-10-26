---
id: 319
slug: re-check-the-amplify-tree-advisories-graphql-tools-utils-zod
title: Re-check the Amplify-tree advisories (@graphql-tools/utils, zod) on the next backend-cli release
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-26T16:05:00Z
---

## Description

Found by 0308. The two leaf advisories behind the full tree's 37 highs, @graphql-tools/utils GHSA-7mx3 and zod GHSA-mrhx, both wait on an upstream @aws-amplify/backend-cli release (D-450). Re-run npm audit after the next release and clear whatever it fixes.

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
