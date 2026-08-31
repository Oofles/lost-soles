---
id: 96
slug: your-run-is-on-the-map-notification
title: "Your run is on the map" — the one notification, deep-linking to /run/:id
type: feature
priority: med
status: open
size: m
capability: 14-webhook-and-automatic-sync
depends_on: [78, 86, 91]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The last piece of the automatic path: when ingest completes, tell the user once, and take them
straight to the reward.

**This is the only notification the app will ever send**, and the constraint is D-013. A
notification that *reports* something that already happened is fine. A notification that *asks* for
something — go for a run, keep your streak, you have not logged today, come back — is upkeep with a
push permission, and it is precisely what made the user abandon Habitica. This one reports.

Behaviour:

- Fires after `process-activity` has completed projection and scoring for a new activity — **not on
  webhook receipt**. The notification promises the run is on the map; it must be true when it
  arrives.
- Copy: *"your run is on the map"*. No numbers in the notification, no "you gained 1,143 XP", no
  level-up spoiler. The tally is the reward and the notification must not spend it.
- Tapping deep-links to `/run/:activityId` and **auto-plays from beat 1** (0078's entry matrix).
- **One per activity, ever.** A backfill of 300 activities sends **one** notification, matching
  0084's single aggregate reveal — never a queue of 300.
- If the user opens the app before tapping, the notification is dismissed and the plinth's
  `1 new run — tap to open` line (0087) carries the same job. The two must never both be pending in a
  way that produces two sequences.
- No badge count on the app icon. No repeat, no re-notify, no reminder if it goes untapped — an
  ignored notification costs nothing and is never mentioned again.
- Notification permission is requested **in context**, after the first successful import, never on
  first launch. Denying it is a fully supported state: the plinth line is the fallback and the app is
  complete without push.

**The plinth is the fallback, not the notification's backup singer.** Everything that works with push
must work identically without it, because push is the least reliable part of this whole chain and it
is the only part whose behaviour is outside our control.

## Acceptance criteria

- [ ] A notification is delivered only after projection and scoring complete for the activity, and
      tapping it lands on a `/run/:id` whose ledger and territory are already correct.
- [ ] The copy contains no XP figure, no level, no cell count, and no milestone name.
- [ ] Tapping deep-links to `/run/:activityId` and auto-plays from beat 1, including from a cold
      process start.
- [ ] Exactly one notification is sent per activity; a re-delivered webhook or a sweep-recovered
      duplicate sends none.
- [ ] A backfill of ≥50 activities sends exactly **one** notification.
- [ ] Opening the app without tapping dismisses the notification, and the resulting sequence plays
      exactly once — not once from the plinth and again from the notification.
- [ ] No app-icon badge is set at any point.
- [ ] An untapped notification is never repeated, re-sent or escalated; a test asserts no retry
      scheduler exists on this path.
- [ ] Permission is requested only after a first successful import, never at launch.
- [ ] With notification permission denied, ingest, the plinth line, the sequence and the end state all
      work identically — asserted by an end-to-end run of the whole flow with push disabled.
- [ ] No notification exists anywhere in the codebase whose copy asks the user to do anything; a
      repository test asserts the notification catalogue has exactly one entry.

## Notes

Depends on 0078 (the deep-link target), 0086 (the plinth fallback) and 0091 (the webhook that starts
the chain).

The frontier line is explicitly excluded from notifications (`06-ui-ux.md` §3.2, beat 5: *"never
appears as a notification"*). If a future ticket proposes "unclaimed ground near you" as a push, it
needs a decision record overturning D-013, not a commit.

Ordering matters more than it looks: notifying on webhook receipt would be a second earlier and would
sometimes be a lie, landing the user on a `/run/:id` with no territory and no tally. The 2-second ack
(0091) buys latency; this ticket must not spend it on a promise the pipeline has not kept yet.

## Operator validation

**Go for an actual run**, finish it in Strava, and leave the phone in your pocket. The honest test is
what happens next with no action from you: the notification should arrive within a minute or two of
finishing, and its wording should tell you something good happened without telling you what.

Tap it from the lock screen with the app fully closed. You must land on the post-run sequence playing
from the map — not on home, not on a spinner, not on a static page you then have to tap again.

Then repeat with the phone unlocked and the app already open on `/` — confirm you get the plinth line
and the sequence plays exactly once.

Finally, deny notification permission entirely on a test install and go for another run. Everything
must still work. If the app feels broken without push, the fallback is not carrying its weight.
