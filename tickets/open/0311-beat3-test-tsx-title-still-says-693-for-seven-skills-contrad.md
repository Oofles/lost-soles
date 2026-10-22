---
id: 311
slug: beat3-test-tsx-title-still-says-693-for-seven-skills-contrad
title: beat3.test.tsx title still says 693 for seven skills, contradicting D-192
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
---

## Description

A test title in `lib/level-up/beat3.test.tsx` reads "… (693 for seven skills)". D-192 says the Total Level ceiling is never stated as a number. The assertion itself computes it correctly; only the title is stale. Found by the 0116 agent.

## Acceptance criteria

- [ ] The title states the arithmetic (enabled rows × `maxLevel`) and no number.
- [ ] `grep -rn '693' lib src app components` finds no ceiling literal in a test title or assertion.

## Notes

Trivial; pair it with another small ticket.

## Operator validation

None: a test title.

D-123 trigger checked? none.
