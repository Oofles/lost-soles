---
id: 20
slug: android-quick-capture-tile
title: Android quick-capture - Tasker/MacroDroid HTTP task on a quick-settings tile
type: feature
priority: high
status: open
size: m
capability: 03-ticket-capture-endpoint
depends_on: [19]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The endpoint, not the UI, is the real product (roadmap §4.1). A Tasker or MacroDroid HTTP task
bound to a **quick-settings tile** captures a thought *without unlocking the phone*: pull down
the shade, tap the tile, dictate one sentence, done. The `/dev/tickets` sheet in capability `17`
requires opening the app, navigating and typing, and will almost certainly remain the slower
path even after it ships.

**D-124 fixes the platform: Android.** Tasker/MacroDroid HTTP tasks, Google Assistant routines,
PWA `share_target`. **Not iOS Shortcuts, not Siri.** Any design that assumes an iOS capture path
is wrong for this user and must be rejected on sight.

Task shape:

1. Tile tap → `Get Voice` (speech-to-text), no screen unlock required.
2. Build the §6.4 JSON body: `title` = the dictated text truncated to 200 chars,
   `body` = the full dictated text if it exceeded 200, `type: "feature"`, `priority: "med"`,
   `idempotencyKey` = a generated UUID (Tasker `%RANDOM`-derived or MacroDroid UUID variable),
   **generated once and reused across retries** (0022 depends on this).
3. `HTTP Request POST` to `https://soles.devaultsecurity.com/api/tickets/capture` with the
   shared auth header 0019 accepts.
4. On 2xx → a brief toast or a single vibration. On non-2xx → hand off to the retry path (0022).

The **exact task export** (`.tsk.xml` for Tasker, `.macro` for MacroDroid) is committed to
`docs/capabilities/03-ticket-capture-endpoint.md` or a file it links to, so the tile is
reproducible after a phone wipe without reverse-engineering it from memory.

## Acceptance criteria

- [ ] A quick-settings tile exists on the operator's phone that runs the capture task.
- [ ] With the phone **locked**, pulling down the shade and tapping the tile starts voice
      capture and completes the POST without an unlock prompt.
- [ ] A dictated sentence appears as a file in `tickets/inbox/` on GitHub **within 5 seconds**.
- [ ] The task generates the `idempotencyKey` once per capture and reuses it on retry; two
      retries of one capture produce exactly one file.
- [ ] A dictation over 200 characters lands with a truncated `title` and the full text in the
      body — nothing is silently dropped.
- [ ] Success and failure are distinguishable without unlocking (distinct toast/vibration).
- [ ] The task export file is committed to the repo and the capability doc names its path.
- [ ] The capability doc contains no reference to iOS Shortcuts or Siri (D-124).

## Notes

Credential on the device is a header value, not the GitHub PAT — the phone must never hold a
GitHub credential (§6.1). If lock-screen tiles are restricted by the device's settings, record
that in the capability doc along with the workaround used; "requires one unlock" is a real
degradation of this ticket's value and should be stated rather than quietly accepted.

Roadmap §4.1: `03` costs seven tickets and buys the entire remaining build a working
idea-capture channel, which is the best return in the plan. This ticket is the one that actually
delivers that.

## Operator validation

**Device: the operator's Android phone. Screen: the quick-settings shade, locked.** At the end of
a real run, without unlocking, pull down the shade, tap the Lost Soles tile, and dictate an idea.
Look for the confirmation vibration. Then, on the desktop, open `tickets/inbox/` on GitHub and
confirm the file is there with the words you actually said. This validation is not complete until
it has been done once *after an actual run*, out of breath, with cold hands — that is the
condition the tile exists for.
