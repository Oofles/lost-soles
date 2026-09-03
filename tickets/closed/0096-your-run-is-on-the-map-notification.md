---
id: 96
slug: your-run-is-on-the-map-notification
title: "Your run is on the map" — the one notification, deep-linking to /run/:id
type: feature
priority: med
status: closed
size: m
capability: 14-webhook-and-automatic-sync
depends_on: [78, 86, 91]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-09-03T20:02:27Z
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

**Withdrawn 2026-09-03 — D-185.** Declined. The eleven originals are preserved verbatim in
`## Resolution`; criterion 10 in particular ("with notification permission denied... all work
identically") is the reason this was safe to decline rather than a loss.

- [x] Declined into `tickets/closed/` with a `## Resolution`; capability `14`'s roadmap row 6 is
      struck and its "done when" restated so the automatic path no longer claims a push it will not
      send; and the D-013 constraint on any future notification is carried forward into D-185 rather
      than lost with the ticket.

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

**None, and none is owed — declined rather than delivered.** The original is kept below because it
is the clearest statement of the experience being given up, and because the *third* paragraph of it
now describes the shipped behaviour rather than a fallback test.

> **Go for an actual run**, finish it in Strava, and leave the phone in your pocket. The honest test
> is what happens next with no action from you: the notification should arrive within a minute or
> two of finishing, and its wording should tell you something good happened without telling you what.
>
> Tap it from the lock screen with the app fully closed. You must land on the post-run sequence
> playing from the map — not on home, not on a spinner, not on a static page you then have to tap
> again.
>
> Then repeat with the phone unlocked and the app already open on `/` — confirm you get the plinth
> line and the sequence plays exactly once.
>
> Finally, deny notification permission entirely on a test install and go for another run.
> Everything must still work. If the app feels broken without push, the fallback is not carrying
> its weight.

**What must be validated instead, and where it already is:** the last paragraph above is now the
*only* path, so `0087`'s plinth-line validation and `0078`'s entry matrix carry the whole weight of
"you find out a run landed". Neither needs amending — both already specify the no-push case — but if
the plinth line ever feels weak in real use, that is a `0087` bug and not a reason to revive push.

---

## Resolution

**Declined 2026-09-03. Recorded as D-185.** Found during an operator-requested audit of everything
in the backlog that needs the phone *configured* rather than merely *opened*. Across all 104 open
tickets this was the only one left — the automation class went with D-184 — and it turned out to
argue its own case for being cut.

**The ticket's own words:** *"The plinth is the fallback, not the notification's backup singer.
Everything that works with push must work identically without it, because push is the least reliable
part of this whole chain."* Criterion 10 required proving exactly that, end to end, with push
disabled. A feature whose specification mandates a fully-supported path without it is one the MVP
can ship without.

**What replaces it: nothing, because `0087` already does the job.** The home plinth's
`1 new run — tap to open` line is the same signal on the same tap, one app-open later. For a
notification whose entire licence under D-013 is to *report* rather than *ask*, that is a delay in
finding out, not a lost capability.

**What it saves.** Web push was the last thing in the MVP requiring phone setup: a PWA install, a
notification permission grant, a service worker, VAPID keys, and a delivery path the ticket itself
concedes is "the only part whose behaviour is outside our control". Against the operator's stated
goal — start using the app sooner, with less on the phone — that was the worst remaining ratio.

**What is NOT declined.** Capability `14`'s substance: the webhook Lambda (`0091`), the
`hub.challenge` handshake (`0092`), replay/cost-DoS defence (`0093`), token refresh (`0094`) and the
nightly reconcile (`0095`) all stand. **A run finished on the phone still lands on the map with no
user action** — that is D-013 satisfied, and it never depended on the push. Capability `14`'s
"done when" is restated accordingly: the run appears automatically; you learn about it from the
plinth.

**Carried forward rather than lost with the ticket.** The D-013 constraint on any future
notification: it must report, never ask — no streaks, no "you haven't logged today", no "unclaimed
ground near you". The frontier line's explicit exclusion from notifications (`06-ui-ux.md` §3.2,
beat 5) stands regardless of this decline, and reviving push for it needs a decision record
overturning D-013, not a commit. Recorded in D-185.

**Dependency note.** `0115` (`depends_on: [6, 17, 96]`) is satisfied by this close; its
secrets-and-dependency audit no longer has a VAPID key pair to cover, which is one fewer secret in
the MVP's blast radius.

**Files touched:** `docs/decisions/DECISIONS.md` (D-185), `docs/09-roadmap.md` (capability `14`
row 6 and its "done when"), this ticket.

### The eleven original acceptance criteria, verbatim

```md
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
```
