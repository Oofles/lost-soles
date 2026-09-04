---
id: 163
slug: narrow-the-strava-authorization-callback-domain-from-devault
title: Narrow the Strava Authorization Callback Domain from devaultsecurity.com to the app subdomain
type: chore
priority: med
status: open
size: s
capability: 05-strava-adapter
depends_on: []
blocked_by: []
source: agent
created: 2026-09-04T17:40:35Z
---

## Description

Found while closing `0032`, by probing the live authorize endpoint rather than by reading a
settings page. The Strava app's **Authorization Callback Domain is the bare parent domain**,
`devaultsecurity.com`, not the app's own subdomain.

The probe, run with the production `client_id` and no credentials of any kind — Strava answers
`302 -> /login` for a redirect URI it will honour and `400` for one it refuses:

```
soles.devaultsecurity.com/cb              302   accepted
other.devaultsecurity.com/cb              302   accepted   <- the finding
devaultsecurity.com/cb                    302   accepted   <- the finding
notsoles.devaultsecurity.com.evil.example/cb  400   refused (suffix confusion is handled)
attacker.example/cb                       400   refused
```

**Why it matters.** Strava matches the configured domain OR ANY SUBDOMAIN of it. So today any
host under `*.devaultsecurity.com` is a legitimate destination for this app's authorization
codes. That is precisely the future the capture endpoint's CORS lock already names in its own
comment — *"the day something else lands on `*.devaultsecurity.com`"* — and `08-security-privacy.md`
§5.1's shared-parent-domain reasoning is the same shape.

**Why the exposure is real but narrow.** An attacker still needs the operator to complete an
authorize flow against a crafted `redirect_uri`, and `0032`'s start route builds the redirect URI
from `APP_ORIGIN` and never from the request, so the app itself cannot be induced to emit one.
The residual path is a hand-built authorize URL the operator follows. Low likelihood, but the fix
is one field on one settings page and it removes the class.

**The fix is not code.** It is `https://www.strava.com/settings/api` → Authorization Callback
Domain → `soles.devaultsecurity.com`. Nothing in `src/adapters/strava/` changes.

**Note the second finding, which cuts the other way.** `localhost` was ALSO accepted by this same
app during the probe. `03-integrations.md` §2.2 and `0032` both stated *"you cannot have both at
once on one app, so register a second throwaway Strava app for local dev"*. That is not what the
live service does — Strava exempts `localhost` from the callback-domain match. The docs were
amended when `0032` closed. Narrowing the domain must NOT be assumed to break local development,
and this ticket should re-probe `localhost` afterwards to confirm the exemption still holds.

## Acceptance criteria

- [ ] The Strava app's Authorization Callback Domain is `soles.devaultsecurity.com`.
- [ ] The probe is re-run and `other.devaultsecurity.com` and the bare parent now return **400**,
      while `soles.devaultsecurity.com` still returns 302.
- [ ] `localhost` is re-probed and the result — accepted or refused — is recorded in
      `docs/capabilities/05-strava-adapter.md`, replacing the value `0032` recorded.
- [ ] A real connect still completes end to end after the change.
- [ ] `docs/capabilities/05-strava-adapter.md` records the new domain, and
      `03-integrations.md` §2.2 agrees with it.

## Notes

The probe needs no credentials beyond the `client_id`, which `01-architecture.md` §7 already
records as semi-public by design — it appears in every authorize URL. It is therefore safe to
re-run at any time and cheap enough to be the verification rather than a screenshot of a settings
page.

## Operator validation

**The settings-page edit is the operator's** — it needs a Strava login, which no script here has.
Everything after it is a smoke test: re-run the probe from `0032`'s Operator validation section
with the four redirect URIs and record the four status codes.
