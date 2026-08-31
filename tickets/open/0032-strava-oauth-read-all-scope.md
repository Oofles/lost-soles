---
id: 32
slug: strava-oauth-read-all-scope
title: Strava OAuth connect flow with activity:read_all - and a callback that refuses the lesser scope
type: feature
priority: high
status: open
size: m
capability: 05-strava-adapter
depends_on: [14, 26]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The OAuth handshake that connects the operator's Strava account, living entirely under
`src/adapters/strava/`.

**Scope is `activity:read_all`. Not `activity:read`.** (D-121 mitigation 3.) With only
`activity:read`, Strava **truncates traces at the boundary of any privacy zone** the user has
configured — typically home and work. The start and end of nearly every run is silently missing.
On a fog-of-war map that is a **permanent unexplored donut exactly where the user lives**, on a
map that by D-020 never re-fogs. There is no repair short of re-ingesting from another source.
`activity:read_all` is also the only scope that returns "Only You" activities at all, and it is
required to receive webhook events for them.

**Authorize:**

```
https://www.strava.com/oauth/authorize
  ?client_id=<id>
  &redirect_uri=https://soles.devaultsecurity.com/api/auth/strava/callback
  &response_type=code
  &scope=activity:read_all
  &state=<CSRF nonce, stored server-side with a short TTL>
  &approval_prompt=auto
```

The redirect URI's **host must match the "Authorization Callback Domain"** in the Strava app
settings — that field is a **bare domain: no scheme, no path, no port**. `localhost` is accepted
only as a separate value, and **you cannot have both at once on one app**, so register a second
throwaway Strava app for local dev rather than flipping the production one.

**Callback:** verify `state`, then **verify the returned `scope` string actually contains
`activity:read_all`**. Users can decline individual scopes on the consent screen and Strava will
happily hand you a token with less than you asked for. If `read_all` is missing, **do not store
the token**: show a dedicated error explaining that without it the map will have a hole around
home, and offer re-authorization with `approval_prompt=force`.

**Exchange:** `POST https://www.strava.com/oauth/token` with `client_id`, `client_secret`,
`code`, `grant_type=authorization_code`. The response carries `expires_at`, `refresh_token`,
`access_token`, `athlete.id` and `scope`.

**Revocation:** `POST https://www.strava.com/oauth/revoke` with HTTP Basic auth using the client
credentials (recommended since 2026-06-01; the legacy `POST /oauth/deauthorize` with the access
token still exists).

## Acceptance criteria

- [ ] The authorize URL requests `scope=activity:read_all`; a grep of `src/adapters/strava/`
      finds no occurrence of the bare string `activity:read` that is not part of
      `activity:read_all`.
- [ ] `state` is generated server-side, stored with a short TTL, single-use, and a callback with a
      missing, unknown, expired or already-consumed `state` is rejected without a token exchange.
- [ ] A callback whose returned `scope` lacks `activity:read_all` **stores nothing** and renders a
      dedicated error naming the consequence ("the map will have a permanent hole around home")
      with a re-authorize button using `approval_prompt=force`.
- [ ] A successful connect stores `externalOwnerId` (`athlete.id`) **as a string**, `scopes`
      containing `activity:read_all`, `expiresAt` from the response's `expires_at`, and
      `status: ACTIVE`.
- [ ] `expiresAt` is taken from the response, never from a hardcoded TTL constant.
- [ ] `client_secret` never reaches the browser; the bundle-leak test from 0017 covers it.
- [ ] A disconnect action calls `POST /oauth/revoke` with Basic auth and sets the account row
      `DISCONNECTED` with **tokens deleted**.
- [ ] The Strava app's Authorization Callback Domain is recorded in the capability doc as a bare
      domain, with a note that a second dev app exists for `localhost`.
- [ ] Every file added by this ticket is under `src/adapters/strava/`; the 0027 T1 grep stays
      green.

## Notes

The scope check on the **callback** is the one people skip, because the authorize URL asking for
`read_all` feels like enough. It is not — the consent screen lets the user untick it, and the
resulting connection looks healthy while quietly returning truncated traces. Failing loudly at
connect time is far cheaper than discovering a donut around home after fifty runs, because by
D-020 that donut is permanent.

Token storage and refresh are 0033; this ticket only writes the initial row.

## Operator validation

**Device: the operator's Android phone, Chrome, on the app's settings/connect screen.** Tap
"Connect Strava". On the Strava consent screen, **deliberately untick the "all your activities"
permission** and approve. The app must refuse the connection and show the hole-around-home
explanation, not a success state. Then reconnect with the permission ticked and confirm the
screen shows connected with the `read_all` scope named. Look specifically at whether the failure
message is understandable while standing outside after a run — this error is the only defence
against a permanent map defect.
