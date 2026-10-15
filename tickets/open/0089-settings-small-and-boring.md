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
started: 2026-10-15T18:28:53Z
---

## Description

`/settings` is deliberately small and boring (`06-ui-ux.md` §1.3, roadmap `13`/4). Reached from the
gear in the top-right of the home screen. It contains exactly four things and nothing else:

1. **Connect / disconnect the activity source.** Connect runs the Strava OAuth flow (0032, scope
   `activity:read_all`). Disconnect revokes and clears the token.
2. **Sign out.**
3. **Account deletion entry point** — the front door to the `08-security-privacy.md` §6.4 runbook.
4. **Build info** — version and commit, because "which build is deployed" is the first question
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

- [x] `/settings` is reachable from the home gear and browser back returns to `/`. *(The gear is
      0086's `<Link href="/settings">`, asserted in `plinth.test.tsx`. Back is the browser's own
      history, since nothing on `/settings` replaces it.)*
- [x] When no source is connected, the screen offers Connect and running it completes the 0032 OAuth
      flow and returns to `/settings` showing the connected account.
- [x] Disconnect requires one confirmation, revokes the token with the provider, and removes it from
      `LostSolesSourceAccount`.
- [x] The disconnect confirmation states in plain words that map, XP and history are retained and
      that this is not account deletion.
- [x] After disconnect, the map, Total Level and Chronicle are unchanged and still render.
- [x] Sign out clears the session and lands on the signed-out state; the next launch requires auth.
- [x] The account-deletion entry is visually distinct from disconnect, requires an explicit typed or
      double confirmation, and links to the §6.4 runbook path rather than silently deleting inline.
- [x] Build version and commit sha are displayed and match the deployed build.
- [x] No preference control of any kind exists on the screen — asserted by a test over the rendered
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

In the desktop browser: open settings from the gear, and time how long it takes to understand every
option on the screen. If it takes more than a few seconds, it is too big.

Disconnect Strava and read the confirmation text as though you were worried about losing your map —
does it reassure you correctly? Confirm, then return to `/`: your territory and Total Level must be
exactly as they were. Reconnect and confirm ingest resumes on the next Sync.

Then look at the account-deletion entry with fresh eyes and ask whether you could hit it by accident
while trying to disconnect. If the answer is anything but a firm no, redesign the spacing before
closing this ticket.

## Resolution

### What was built

| | |
|---|---|
| `app/settings/page.tsx` | Rewritten around exactly four things: the source card (0032's connect, refusal and reconnect, unchanged), sign out, the deletion entry, and a build line. The non-owner branch now offers sign out and build info only. |
| `app/settings/settings-controls.tsx` (new, client) | `DisconnectControl` (one confirmation, which carries the reassurance), `SignOutButton` + `signOutAndLeave`, and `DeletionEntry` (typed phrase, then a runbook link). Each takes its stage as a prop so every stage can be rendered statically, because the repo has no DOM test environment. |
| `app/settings/styles.ts` (new) | The shared button style. A plain module, because a non-component export of a `"use client"` module reaches a server component as a client reference, not as the object. |
| `lib/build-info.ts` (new) | `buildInfo()`: version, sha and short sha. Prints `dev` / `unknown` outside a Next build rather than inventing a value. |
| `next.config.ts` | Inlines `LOST_SOLES_BUILD_VERSION` (from `package.json`) and `LOST_SOLES_BUILD_SHA` (Amplify's `AWS_COMMIT_ID`, accepted only if it looks like a sha, with `git rev-parse HEAD` as the fallback). Same build-time pattern as 0053's home coordinate. |
| `app/tokens.css` | Adds `--destructive: var(--oxblood)` and `--on-destructive: var(--parch-50)`, the semantic pair for §8.2's "destructive confirm in /settings. Only." It is theme-invariant: a filled oxblood button with parchment text reads in both themes. Stale comments about a theme override in `/settings` are corrected. |
| `docs/runbooks/account-deletion.md` (new) | The stub runbook. It cites `08-security-privacy.md` §6.4, summarises the eight steps, and says plainly that it is **not yet executable** and that ticket **`0106` owns filling it in** (operator decision on this ticket). |
| `docs/06-ui-ux.md` | §1.3's `/settings` row and §8's theme sentence are amended to match this ticket. See "Drift" below. |
| Tests | `app/settings/page.test.tsx` (extended), `app/settings/settings-controls.test.tsx`, `app/api/auth/[source]/disconnect/retains-everything.test.ts`, `lib/build-info.test.ts`. |

### How each criterion is proven

- **Connect (2).** This is 0032's flow, untouched. `oauth-routes.test.ts` proves that the callback lands on `/settings?connect=connected`, and `page.test.tsx` proves the connected state names the account and the scopes.
- **Disconnect (3, 4).** The trigger is a plain button. The POST form exists only inside the confirmation, so the one confirmation is structural. `retains-everything.test.ts` drives the **real** route and the **real** store with only DynamoDB, SSM, the session and `fetch` faked. It shows the token the row held being sent to the provider's revoke endpoint, then a single `UpdateCommand` that `REMOVE`s both tokens.
- **Nothing else changes (5).** The same test asserts that every DynamoDB command addresses `LostSolesSourceAccount` and that none is a delete. It also pins the route's import list, so nothing that can reach the map, the ledger or the chronicle can creep in. The home screen and `/chronicle` do not read `SourceAccount` at all (only `sync-action.ts` does, on click), so they render the same whatever the connection state.
- **Inbound deauthorization (Notes).** A `DISCONNECTED` row with no outcome parameter (0093's webhook path) renders as "Not connected (disconnected)" with Connect offered. Tested.
- **Sign out (6).** `signOut()` from `aws-amplify/auth`, then a full navigation to `/`, where the Authenticator is the signed-out state and the middleware gates every other route. The order (sign out, then leave) and the no-navigate-on-failure behaviour are tested.
- **Deletion entry (7).** It sits below sign out under its own "Delete account" heading, after a 3rem gap and a rule. Its trigger is a quiet button. The confirmation demands the typed phrase `delete my account`, says the deletion cannot be undone, and points back at Disconnect. The confirm button is disabled until the phrase matches, and it is the only use of `--destructive` on the screen. Confirming deletes nothing: it shows "Nothing has been deleted" and links to the runbook's GitHub URL. Tests prove the link target exists in the repo, that it cites §6.4 and 0106, and that `DeletionEntry` contains no `fetch`, form action or server action.
- **Build info (8).** Proven locally: the built `.next/server/app/settings/page.js` contains the worktree's HEAD sha. The deployed match is a post-deploy smoke check.
- **No preference control (9).** A test runs over every stage of every control: the page connected, disconnected and needing reauth, plus the confirming and acknowledged stages. It rejects select, textarea, checkbox, radio, range, colour, number, date and time inputs, switch/checkbox/slider-type roles, `aria-pressed`, `aria-checked`, and the words theme, units, notification, sound and preferences. It also asserts there is exactly one text input (the deletion phrase), and a planted checkbox proves the rule fires.

### Decisions

- **The deletion entry links to a stable runbook path, `docs/runbooks/account-deletion.md`, which ticket `0106` fills.** This was the operator's answer to the question this ticket raised. It is proposed for the register as a new D-xxx.
- **No theme override.** `06` §8 promised a manual theme override in `/settings`. This ticket's criterion 9 forbids it, and the ticket is the later, operator-sourced word, so the doc was amended. Proposed for the register as well.

### Drift

`06` §1.3 listed "reduced-motion/battery, units" for `/settings`, and §8 promised a theme override there. Both contradict this ticket's "exactly four things" and D-013. Both doc passages are amended in place, citing `0089`.

**Decisions recorded at merge (orchestrator):** D-325 (the deletion entry links to the stub runbook `0106` fills, operator) and D-326 (no preference control, theme included). `0106` has a note that it owns `docs/runbooks/account-deletion.md`.
