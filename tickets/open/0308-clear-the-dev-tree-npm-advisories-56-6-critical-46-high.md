---
id: 308
slug: clear-the-dev-tree-npm-advisories-56-6-critical-46-high
title: Clear the dev-tree npm advisories (56: 6 critical, 46 high)
type: chore
priority: med
status: open
size: m
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
---

## Description

After 0115, the production tree has 0 advisories and is gated (D-434). The full tree has 56: 6 critical, 46 high, 4 moderate, all in dev tooling. They come through `@aws-amplify/backend`/`backend-cli` and codegen (`handlebars`, `lodash`, `@graphql-tools`), and through `vitest`/`tinypool`/`vite`. Clearing them needs a vitest major and Amplify backend upgrades, which carries D-162's install risk.

## Acceptance criteria

- [ ] `npm audit --audit-level=high` reports 0 over the full tree, or each remaining advisory is listed in the capability doc with why it cannot be cleared.
- [ ] `npm install --no-save` from a clean clone leaves `package-lock.json` byte-identical (D-162).
- [ ] The full local gate and the Amplify build are green.
- [ ] If the full tree is clean, the gate is widened to it (both CI surfaces, D-163), with a decision recorded.

## Notes

Try one upgrade family at a time (vitest, then Amplify backend), with the full gate between each. Re-test `npm ci` (0128) while you are there.

## Operator validation

Smoke test: the audit counts and a green deploy. No perceptual check.

D-123 trigger checked? none.
