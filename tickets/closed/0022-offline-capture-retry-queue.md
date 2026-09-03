---
id: 22
slug: offline-capture-retry-queue
title: Capture-queue semantics for offline - retry lives in the Android task, not the app
type: feature
priority: med
status: closed
size: s
capability: 03-ticket-capture-endpoint
depends_on: [19, 20]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-09-03T19:48:32Z
---

## Description

Connectivity is flaky outdoors and **the capture must never fail in a way the user notices**
(`07-ticketsmith.md` §5.3). At this stage there is no app UI to hold a queue, so the queue lives
in the Android task's own retry, not in the app.

Task-side behaviour:

1. On a network failure or a 5xx, persist the built body (including its **already-generated**
   `idempotencyKey`) to a local variable/file in the Tasker/MacroDroid profile.
2. Retry with exponential backoff — 30s, 2m, 8m, 30m, 2h — triggered by a connectivity-change
   profile as well as by the timer, so a capture made in a dead zone flushes the moment signal
   returns rather than waiting out the backoff.
3. On 2xx, drop the local copy.
4. On a 4xx that is not 429 (i.e. the request is malformed and will never succeed), stop
   retrying and surface a persistent notification. A silent infinite retry is worse than a
   visible failure.
5. A **pending count** is visible on the tile or as a persistent notification whenever the local
   queue is non-empty. That badge is the only sync UI; there is no manual sync button.

Duplicate protection is entirely 0019's idempotency key with its 24-hour TTL: each capture
carries a client-generated UUID so a retried flush cannot create two files. **The key must be
generated once at capture time and reused for every retry of that capture** — regenerating it per
attempt defeats the whole mechanism.

## Acceptance criteria

**Withdrawn 2026-09-03 — D-184.** Declined with `0020`, on which every criterion below depends:
all eight describe behaviour of an Android task that will not be built. Preserved verbatim in
`## Resolution`.

- [x] Closed as declined into `tickets/closed/` with a `## Resolution`, and the one durable finding
      in this ticket — that the 24-hour idempotency TTL bounds any client-side retry queue — carried
      forward to capability `17`, which inherits the problem.

## Notes

The 24-hour idempotency TTL from 0019 bounds this: a capture that has been retrying for more
than a day may duplicate if it finally succeeds after the key expires. That is acceptable — a
capture stuck for 24 hours is a bug worth noticing — but note it in the capability doc rather
than pretending the guarantee is unconditional.

When the in-app UI ships (capability `17`), §5.3's IndexedDB + background-sync queue supersedes
this for the app path. The tile keeps its own queue regardless; they do not share state, and both
are safe because both send an idempotency key to the same endpoint.

## Operator validation

**None, and none is owed — declined rather than delivered.** The airplane-mode exercise below tests
a queue that does not exist. Kept as the specification of what a future queue must survive:

> **Device: the operator's Android phone. Screen: the quick-settings shade and the notification
> shade.** Put the phone in airplane mode, capture two ideas via the tile, and confirm a "2 pending"
> indication appears. Walk out of airplane mode. Within a few seconds the indicator should clear.
> On the desktop, confirm `tickets/inbox/` gained exactly two files and no duplicates. Repeat once
> with a real dead-zone stretch on a run, since airplane mode is a cleaner failure than actual bad
> signal.

---

## Resolution

**Declined 2026-09-03. Recorded as D-184.** This ticket has no independent existence: it is the
retry behaviour of `0020`'s task, it `depends_on: [19, 20]`, and every one of its eight criteria
describes something happening inside an Android automation app. With `0020` declined there is no
task to hold a queue, and a queue with no client is not a smaller version of this ticket — it is
nothing.

**The server side it relied on is unaffected and still correct.** `0019`'s idempotency key with its
24-hour TTL is built, tested and live; any future client that generates a key once and reuses it
across retries gets exactly-once semantics from the endpoint for free. Nothing about this decline
weakens that guarantee — it removes the only client that was going to use it.

**The one finding worth carrying forward.** This ticket's `## Notes` identified a real bound that
outlives it: *a capture retrying for more than 24 hours may duplicate once the idempotency key
expires.* That applies verbatim to capability `17`'s IndexedDB + background-sync queue (§5.3), which
now inherits the offline problem outright rather than superseding a tile queue that already solved
it. **`17` must not assume the exactly-once guarantee is unconditional.** Recorded here rather than
lost with the ticket; it belongs in `17`'s capability doc when that work is scoped.

**Files touched:** this ticket only. See `0020`'s `## Resolution` and D-184 for the decision, the
roadmap correction and the retained artifacts.

### The eight original acceptance criteria, verbatim

```md
- [ ] A capture made with the phone in airplane mode is queued locally and does **not** report
      success to the operator.
- [ ] Re-enabling connectivity flushes the queue within one connectivity-change trigger, without
      waiting for the next backoff tick.
- [ ] The flushed capture produces exactly **one** file in `tickets/inbox/`, verified after at
      least three retry attempts of the same capture.
- [ ] Two distinct captures made offline both flush and produce two distinct files, in capture
      order.
- [ ] A capture rejected with 400 stops retrying and raises a persistent notification naming the
      failure.
- [ ] A 429 is retried (it is transient), a 400 is not.
- [ ] A pending count is visible somewhere on the phone while the queue is non-empty and clears
      when it drains.
- [ ] Retry state survives a phone reboot with the queue non-empty.
```
