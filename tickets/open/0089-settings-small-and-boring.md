---
id: 89
slug: settings-small-and-boring
title: /settings — connect/disconnect source, sign out, account deletion entry point
type: feature
priority: med
status: open
size: s
capability: 13-home-plinth-and-chronicle
depends_on: [86, 32]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

`/settings` is deliberately small and boring (`06-ui-ux.md` §1.3, roadmap `13`/4). Reached from the
gear in the top-right of the home screen. It contains exactly four things and nothing else:

1. **Connect / disconnect the activity source.** Connect runs the Strava OAuth flow (0032, scope
   `activity:read_all`). Disconnect revokes and clears the token.
2. **Sign out.**
3. **Account deletion entry point** — the front door to the `08-security-privacy.md` §6.4 runbook.
4. **Build info** — version and commit, because "which build is on the phone" is the first question
   of every bug report.

**Disconnecting a source is not deleting an account** (§6.5), and the copy must say so plainly.
Disconnect stops ingest and drops the token; it does not delete your map, your ledger or your raw
archive. Deletion is a separate, deliberate, confirmed act. Conflating the two is how a user
destroys years of data while trying to stop a sync.

Settings is **not** a preferences screen. There is no theme picker, no units toggle beyond what the
locale gives, no notification preferences panel, no map-mode setting (the mode toggle lives on the
map itself and persists there, D-052), and no sound settings because there is no sound. Every
preference is state the user has to maintain, and maintenance is D-013's exact prohibition.

## Acceptance criteria

- [ ] `/settings` is reachable from the home gear and Android back returns to `/`.
- [ ] When no source is connected, the screen offers Connect and running it completes the 0032 OAuth
      flow and returns to `/settings` showing the connected account.
- [ ] Disconnect requires one confirmation, revokes the token with the provider, and removes it from
      `LostSolesSourceAccount`.
- [ ] The disconnect confirmation states in plain words that map, XP and history are retained and
      that this is not account deletion.
- [ ] After disconnect, the map, Total Level and Chronicle are unchanged and still render.
- [ ] Sign out clears the session and lands on the signed-out state; the next launch requires auth.
- [ ] The account-deletion entry is visually distinct from disconnect, requires an explicit typed or
      double confirmation, and links to the §6.4 runbook path rather than silently deleting inline.
- [ ] Build version and commit sha are displayed and match the deployed build.
- [ ] No preference control of any kind exists on the screen — asserted by a test over the rendered
      component tree.

## Notes

Depends on 0086 (for the entry point) and 0032 (the OAuth connect flow).

The deletion runbook itself is executed and proven in `16`/5 against a throwaway account; this ticket
provides only the entry point and the confirmation. Do not implement destructive deletion logic here
ahead of that ticket — a deletion path that has never been executed is not a deletion path.

Deauthorization can also arrive *inbound*, as a Strava `object_type: athlete` webhook with
`updates: {"authorized": "false"}` (`03-integrations.md` §2.3). That path is handled in 0093; this
screen must render the resulting disconnected state correctly when it happens without the user having
touched `/settings` at all.

## Operator validation

On the Android phone: open settings from the gear, and time how long it takes to understand every
option on the screen. If it takes more than a few seconds, it is too big.

Disconnect Strava and read the confirmation text as though you were worried about losing your map —
does it reassure you correctly? Confirm, then return to `/`: your territory and Total Level must be
exactly as they were. Reconnect and confirm ingest resumes on the next Sync.

Then look at the account-deletion entry with fresh eyes and ask whether you could hit it by accident
while trying to disconnect. If the answer is anything but a firm no, redesign the spacing before
closing this ticket.
