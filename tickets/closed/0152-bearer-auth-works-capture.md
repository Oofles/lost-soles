---
id: 152
slug: bearer-auth-works-capture
title: bearer auth works
type: chore
priority: low
status: closed
size: m
capability: null
depends_on: []
blocked_by: []
source: ui
created: 2026-09-03T01:14:48.907Z
closed: 2026-09-03T01:19:55Z
---

## Description

## Acceptance criteria

None — this capture was closed at triage, not built.

## Notes

Captured 2026-09-03T01:14:48.907Z, closed at triage.

## Operator validation

None — nothing was built, so there is nothing to check.

## Resolution

**Declined at triage, 2026-09-03.** Ticket 0149's operator smoke test, dictated through the real bearer path on 2026-09-03. It is the evidence that the endpoint accepts a verified Cognito ID token end to end, not an idea to build — so it is declined rather than promoted, and declined rather than deleted so the first successful non-browser capture stays findable. The endpoint's own commit is 1927a7e. Retrieve the original with `git log --full-history -- 'tickets/inbox/2026-09-03T0114-bearer-auth-works.md'` and `git show 1927a7e:tickets/inbox/2026-09-03T0114-bearer-auth-works.md` — NOT with `git log --follow`, which on this file reports 0150 as the ancestor and is wrong (see 0153).
