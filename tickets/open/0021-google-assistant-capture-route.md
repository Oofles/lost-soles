---
id: 21
slug: google-assistant-capture-route
title: Google Assistant routine as a second capture path
type: feature
priority: low
status: open
size: s
capability: 03-ticket-capture-endpoint
depends_on: [20]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

A Google Assistant routine ("Hey Google, capture a ticket") that reaches the **same** endpoint as
the tile, for the case where the phone is in a pocket or an armband and the shade is not
reachable. Android-native per D-124.

Simplest working shape: the routine invokes the existing Tasker/MacroDroid task from 0020 (via
an Assistant-triggered macro or an app-shortcut trigger) so there is exactly **one** HTTP client,
one body builder and one idempotency-key generator. Do not write a second POST implementation.

**This ticket is explicitly droppable.** The roadmap marks it optional: *"drop it if the Tasker
tile is enough."* If, after living with 0020 for a week, the tile covers every real capture, close
this as declined with a `## Resolution` explaining why rather than building a second path that
duplicates the first and rots.

## Acceptance criteria

- [ ] A named Assistant routine exists on the operator's phone that triggers the 0020 task.
- [ ] The routine reaches the same `/api/tickets/capture` endpoint through the same task — a
      grep of the phone config shows exactly one HTTP request definition, not two.
- [ ] A voice-triggered capture produces exactly one file in `tickets/inbox/`.
- [ ] The routine's setup steps are documented in the capability doc alongside the tile's.
- [ ] If declined instead of built, the ticket is closed with a `## Resolution` recording the
      decision and the ticket is moved to `closed/`, not deleted.

## Notes

D-124 permits Assistant routines explicitly. The failure mode to watch for is Assistant mangling
dictation before it reaches the task (it applies its own punctuation and command-word stripping),
which is a reason the tile's raw `Get Voice` may stay preferable.

Low priority and `s` because it is a thin wrapper over work 0020 already did. If it turns out to
need its own request path, that is a signal to reconsider building it at all.

## Operator validation

**Device: the operator's Android phone, screen off, phone in a running belt.** Say the routine
phrase and dictate an idea without touching the phone. Confirm on the desktop that exactly one
file appeared in `tickets/inbox/` and that the text is not mangled by Assistant's own command
parsing. Compare the captured text word-for-word against what you said.
