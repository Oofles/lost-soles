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
started: 2026-09-02T20:14:20Z
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
- [x] A dictation over 200 characters lands with a truncated `title` and the full text in the
      body — nothing is silently dropped.
- [ ] Success and failure are distinguishable without unlocking (distinct toast/vibration).
- [ ] ~~The task export file is committed to the repo~~ **The build is specified in
      `docs/capabilities/03-capture-tile.md`, and the export is committed once the phone has
      produced it** — and the capability doc names its path.
      **Amended 2026-09-02, with the operator.** The `.macro` / `.tsk.xml` formats encode actions
      as numeric codes. An export hand-written by an agent with no device to import it on would
      import cleanly and then misbehave, and that failure surfaces at mile six on the one note that
      mattered — strictly worse than no export, because it looks like a working artifact. The
      criterion's actual purpose is *"reproducible after a phone wipe without reverse-engineering
      it from memory"*, and a precise action-by-action spec plus a runnable reference
      implementation serves that today; the real export serves it better and lands as soon as there
      is a device to produce one.
- [x] The capability doc contains no reference to iOS Shortcuts or Siri (D-124).

## Notes


**Blocked 2026-09-02 on 0149:** 0020 step 3 assumes a shared auth header that 0019 never built; the endpoint is cookie-only and unreachable from Tasker until 0149 lands

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

---

## Progress — 2026-09-02 (not closed)

Two of eight criteria are met. **The other six need the phone**, and none of them is mine to tick:
the tile existing, the locked-shade behaviour, the five-second round trip, the retry producing one
file, the distinguishable buzz, and the export. That was true of this ticket the day it was written
— six of its eight criteria name a device — and the honest close is a later session once the
operator reports.

### What was built

- **`tools/capture/capture.sh`** — a runnable reference implementation of the task: dictation in,
  idempotency key generated once, 200-character split, `REFRESH_TOKEN_AUTH` exchange, the capture
  POST, and an exit code per outcome. It is the definition the macro transcribes rather than the
  macro being the only copy of the logic, and it is the diagnostic for "is it the phone or the
  endpoint?".
- **`tools/capture/capture.test.mjs`** — 15 tests over the three things that can silently corrupt a
  note: the title/body split, the JSON escaping, and the single generation of the idempotency key.
- **`docs/capabilities/03-capture-tile.md`** — the action-by-action phone build, MacroDroid first
  with Tasker equivalents, including the vibration table for criterion 6 and an explicit place to
  record the answer to the lock-screen question.

### Decisions taken with the operator

**MacroDroid over Tasker.** A first-class Quick Settings Tile trigger and a Voice Input action,
where Tasker needs extra plumbing for the same two things. Tasker equivalents are documented per
step, so the choice is a recommendation rather than a lock-in.

**The export is not hand-written.** See the amended criterion 7. The short version: an untested
export is worse than none, because it looks like a working artifact.

### Verified end to end against the live services

Both failure paths, through the real script:

- A dead refresh token → `NotAuthorizedException`, exit **3**, the "re-pair the phone" message, and
  **no capture attempted**. This is the path `0022` must treat as fatal-until-re-paired rather than
  retrying forever.
- A **real** refresh token from the sandbox pool → the token exchange **succeeds** (so the script's
  refresh leg and its `IdToken` extraction are proven, not just the failure branch), and the capture
  POST then gets **404**, exit **4**. That also re-proves `0149`'s wrong-pool rejection through a
  second, independent client.

The 201 path cannot be reached without a production refresh token, which needs a production sign-in
the agent must not hold. It is the same step `0149` is already waiting on, and doing it once
satisfies both.

### ★ What the operator needs to do ★

1. Install **MacroDroid** and build the macro from `docs/capabilities/03-capture-tile.md`.
2. Pair it with a refresh token, per `0149`'s procedure. It now lasts a year (`0151`), so this is
   a one-time step.
3. **The real test, and it is the one the ticket exists for:** at the end of an actual run, out of
   breath, without unlocking — pull down the shade, tap the tile, dictate an idea. Look for the
   confirmation vibration. Then, on the desktop, confirm the file is in `tickets/inbox/` with the
   words you actually said.
4. Report whether the locked-screen path worked, or whether an unlock was required. **If an unlock
   is required, say so** — it is a real degradation and belongs in the capability doc, not quietly
   accepted.
5. Export the macro and commit it to `tools/capture/`.
