---
id: 43
slug: manual-sync-action
title: Manual Sync action — listSince, then enqueue
type: feature
priority: high
status: open
size: m
capability: 06-ingest-pipeline
depends_on: [34, 42]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-07T04:42:01Z
---

## Description

A server action, reachable from one button in the app shell, that calls the adapter's
`listSince(since)` and enqueues an `IngestJob` per activity it finds. This is the entire ingest
trigger at the first-usable milestone: no webhook, no subscription management, no `hub.challenge`.

This is a **deliberate, scheduled violation of D-013** (`09-roadmap.md` §4.5). There is one thing
to do after a run, it is one tap, and it is paid off by capability `14`. Recorded here so it reads
as debt with a named payoff, not as drift. If the gap between this milestone and `14` grows past a
few weeks, `14` gets promoted ahead of `15`–`17`.

`listSince` is mandatory anyway (D-140) because the nightly reconcile needs it to cover silently
dropped webhooks, so building the manual path first costs nothing that would otherwise be skipped.

`since` comes from the user's last successful ingest watermark, with a generous overlap — the
receipt table makes over-enqueueing free (one conditional write and nothing else), whereas
under-enqueueing silently loses a run.

## Acceptance criteria

- [x] A `syncNow()` server action calls `listSince(watermark)` and enqueues one `IngestJob` per
      returned activity.
- [x] The action is authenticated; it acts on the signed-in user only and cannot be given another
      user id.
- [x] Strava credentials never reach the client — the action reads `SourceAccount` server-side
      (`01-architecture.md` §7).
- [x] The watermark advances only on successful enqueue, and overlaps the previous window by at
      least one hour.
- [x] Pressing Sync twice in a row produces one `Activity` row, one raw object and one receipt per
      activity.
- [x] The button shows a pending state and a plain result line ("3 activities queued" /
      "nothing new"). No styling work beyond the design tokens from 0016.
      *(Markup asserted in `components/sync-button.test.tsx`; whether it READS right on a phone
      after a run is the operator's, and is the one item left in Operator validation below.)*
- [x] Nothing is enqueued when the source account is disconnected; the action returns a
      "reconnect" result instead of failing.

## Notes

Deliberately ugly: no notification, no progress bar, no toast choreography. The post-run moment is
capability `12`. The map simply *is* revealed the next time you look at it (`09-roadmap.md` §2.3).

Rate-limit budget lives in the adapter (0038), not here. This action must not batch-fetch details;
it enqueues ids and lets `process-activity` do the fetching, so a large backfill spreads across
invocations instead of blowing the 2-second-ish action budget.

## Resolution

**Files touched**

| File | What |
|---|---|
| `lib/sources/sync.ts` | New. The sweep's rules, with injected seams. |
| `lib/sources/sync.test.ts` | New, 14 tests, most of them about the watermark under partial failure. |
| `lib/sources/sync-message.ts` + `.test.ts` | New, 11 tests. The one result line. |
| `app/sync-action.ts` | New. `"use server"` — auth, wiring, and where the queue is. |
| `components/sync-button.tsx` + `.test.tsx` | New, 4 tests. One button, one pending state, one sentence. |
| `app/page.tsx` | Renders it. |
| `lib/sources/adapter-credentials.ts` | `oauthCredentialsFor` now takes `{userId, source}` rather than a whole `IngestJob`, so the sweep — which needs credentials *before* it has a job — fits. An `IngestJob` still satisfies it structurally, so `0042`'s call site did not change. |
| `src/adapters/types.ts`, `strava/adapter.ts` + 8 test files | D-208 — `startedAt` moves onto `IngestJob`. |
| `docs/contracts/ingestion-contract.md` | §3 amended. |
| `docs/08-security-privacy.md` | §3's "not secrets" list amended — see the finding below. |
| `docs/decisions/DECISIONS.md` | D-208. |
| `amplify_outputs.example.json` | The `custom` block, so CI and a fresh clone see the real shape. |

**The decision that mattered: D-208, `startedAt` on `IngestJob`.**

`nextListSinceWatermark` is written entirely in terms of activity start dates — its
crash-recovery rule pins the watermark **below the oldest activity that was listed and not
enqueued** — and `IngestJob` carried none. The adapter had put `startedAt` inside `meta`, with the
comment *"THE WATERMARK BOUNDARY — the consumer needs it to work out how far it got"*: the right
intent in a field the contract types as `unknown` precisely so nothing generic reaches into it. So
the one consumer it was placed there for is the one caller forbidden to read it.

Put to the operator with the two alternatives, both rejected for reasons worth keeping: reading
`meta.startedAt` structurally works today and is enforced by nothing — `check-boundaries.mjs`
cannot catch it because `startedAt` is an innocent word — and using `enqueuedAt` as a proxy is
right in the success case and silently wrong in the only case the module exists for. The
exact-key-set guard in `adapter-interface.types.test.ts` stopped the build, which is it working;
it was amended in place with the reasoning rather than deleted, and still refuses `aspectType`.

**The first-sync boundary is 30 days, and it is a decision, not a default.** `readListSinceWatermark`
returns `null` for a never-swept connection and its own comment insists that is "the backfill
boundary decision". The constraint is the read budget: the connected account has years of history,
and enqueueing it is two provider requests per activity against 100 reads per 15 minutes — roughly
eight hours of quota, most of which would reach the DLQ rather than import. Taken with the
operator. **Ticket `0177`** carries the paced backfill, with the pacing, resume and progress a
multi-hour import needs; its Notes say explicitly not to resolve it by raising the constant.

**A bug found while building, not in the criteria.** Accept-then-enqueue is two operations, and a
failure between them leaves a receipt with no message. Every later sweep would then see
`duplicate` from the accept gate, skip, and that activity would be **permanently blocked** — never
imported, never in the DLQ, never anywhere a human looks, on a map that by D-020 cannot re-fog. A
duplicate is now checked rather than trusted: a receipt still `QUEUED` with `attempts` of zero was
accepted and never delivered, and is re-enqueued. One extra read on the duplicate path only, which
the 48-hour overlap makes common and cheap.

**A finding about `amplify_outputs.json`, and it is not a leak.** The queue URL is surfaced through
`backend.addOutput({ custom: … })`, which is the channel `01-architecture.md` §2 prescribes. What
the design does not say is that `components/auth-gate.tsx` is a client component and
`Amplify.configure(outputs)` needs the whole object — so **everything in that file reaches the
browser**, including the `custom` block, and a queue URL contains the AWS account id. Verified by
building with a probe value and grepping `.next/static`.

It is acceptable here, for two reasons that are worth writing down rather than assuming: possessing
the URL grants nothing without `sqs:SendMessage`, which the SSR compute role alone holds; and the
account id is already public by this project's own choice — `CLAUDE.md` states it and the
repository is public. §3 of `08-security-privacy.md` has been amended to say so, because that
paragraph exists exactly to stop a future reader mistaking this for a leak, and it enumerated
fields that all predate the `custom` block. **The general rule it now states: a value that must
stay server-side does not belong in `custom` — it belongs in SSM with an IAM grant.**

**The 48-hour overlap, against a criterion asking for one.** `SWEEP_OVERLAP_SECONDS` is used rather
than the criterion's floor. §2.3's reason is upload lag: `start_date` is when the user RAN, not
when the activity APPEARED, so a run recorded Sunday and uploaded Tuesday sits behind an hour-wide
window. The extra costs one list call. The criterion says "at least one hour" and is satisfied.

**What is deliberately not here.** No toast, no progress bar, no notification — the post-run moment
is capability 12 and a version of it built here is a version capability 12 has to delete. The
button sits on `/` rather than in the layout: cold start lands there and back-from-everywhere
returns there (§1.5), so it is one tap after a run, and in the layout it would render over the
fullscreen map when capability 08 arrives. Its long-term home is the plinth (§2.1), capability 13's.

## Operator validation

**Agent-run against the deployed `main` stack** (account `286588821906`, `us-east-1`,
`AWS_PROFILE=devault`), per D-181. Amplify job 120, commit `0b5f1e2`, SUCCEED.

**A REAL SWEEP RAN, END TO END.** `syncSource` was executed with the *real* wiring — the same
adapter, credential resolver, receipt client, SQS client and watermark store `app/sync-action.ts`
assembles — against the operator's live connected account. That is the button's entire path minus
the HTTP request and the session read.

**1. First press, on a connection with no watermark.**

```
watermark before: null
  enqueued 19718692761 2026-08-13T00:31:20.000Z
  … 8 activities …
  enqueued 20054236676 2026-09-06T01:00:24.000Z
watermark after:  2026-09-04T01:00:24.000Z
OUTCOMES: [{"sourceId":"strava","kind":"queued","queued":8,"alreadyKnown":0}]
LINE: 8 activities queued.
```

The 30-day boundary bounded it to 8 activities out of the 19 in the last 120 days, which is the
decision working. **The watermark landed at exactly `newest confirmed − 48h`** — `2026-09-06T01:00:24Z`
minus two days — which is criterion 4's arithmetic, live.

**2. All eight imported.** CloudWatch, `"outcome":"persisted"` × 8, one per external id, no
retries and no DLQ. The `Activity` table now holds nine rows (the eight, plus the one `0042`'s own
smoke test imported), every one `hasTrace: true`, `status: ACTIVE`, with sane local times —
evening runs filed under the previous local day, which is I-13 again on real data.

**3. Second press — criterion 5, live.**

```
watermark before: 2026-09-04T01:00:24.000Z
watermark after:  2026-09-04T01:00:24.000Z
OUTCOMES: [{"sourceId":"strava","kind":"queued","queued":0,"alreadyKnown":1}]
LINE: Nothing new.
```

The 48-hour overlap re-listed exactly one activity — the 09-06 run, which is newer than the
watermark — the accept gate refused it as a duplicate, nothing was enqueued, and the watermark did
not move. Receipts: **9 DONE, 1 QUEUED** (that last one is `0042`'s deliberate poison message,
still QUEUED with `attempts: 3` because it went to the DLQ; its 24-hour TTL will remove it). One
`Activity` row, one raw object and one receipt per activity, as the criterion asks.

**4. Credentials never reach the client** (criterion 3). The action returns a `SyncSummary` of
counts and one sentence; `oauthCredentialsFor` resolves to two closures over the server-side store,
and no token appears in the value the client receives. The `sync-button.tsx` bundle contains no
credential and cannot: it imports the action, not the store.

**5. The user id cannot be supplied** (criterion 2). `syncNow()` takes no parameter carrying an
identity — it derives `sub` from the verified session via `currentUserId()` and then checks
`isOwner`. There is no argument for a caller to pass the wrong thing into, which is stronger than
validating one.

**★ ONE THING LEFT, AND IT IS GENUINELY THE OPERATOR'S ★**

Everything above is mechanism. What no script can answer is whether the gesture works:

1. Go for a real run and upload it to Strava as normal.
2. Open `soles.devaultsecurity.com` on your Android phone, **over mobile data, not desk wifi** —
   the whole point is that this is the post-run gesture, and a two-second sweep feels different on
   a cold LTE connection.
3. Tap **Sync** on the home screen. Does the pending state appear fast enough that you believe the
   press registered? Does the result line say something you can act on?
4. Tap it again immediately. It should say "Nothing new."
