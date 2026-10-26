---
id: 309
slug: widen-the-invariant-sweep-s-app-roots-to-amplify-components
title: Widen the invariant sweep's APP_ROOTS to amplify, components and tools
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
started: 2026-10-26T20:04:43Z
---

## Description

The audit's invariant-citation row scans `src|app|lib|scripts` only. The structural tests that cite I-1, I-2, I-3, I-20, I-28 and I-30 under `amplify/`, `components/` and `tools/` run in `npm test` but are invisible to the audit. Every invariant also has a citing test under a scanned root, so the row is complete today (0116), but a citation that exists only outside those roots would read as lost. The 0116 agent tried the one-line edit in `tickets.mjs`; the sandbox refused it as self-modification of `.claude/`.

## Acceptance criteria

- [ ] `APP_ROOTS` includes `amplify`, `components` and `tools`.
- [ ] `tickets.mjs audit 18` still reports all 30 cited and complete.
- [ ] A tickets test covers a citation found only under one of the new roots.

## Notes

An orchestrator-session change, since agents cannot edit `.claude/`.

## Operator validation

None: tooling with no screen. The audit output is the check.

D-123 trigger checked? none.
