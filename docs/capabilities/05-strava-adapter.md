# 05-strava-adapter

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`05-strava-adapter\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (7)

- `0032` — Strava OAuth connect flow with activity:read_all - and a callback that refuses the lesser scope
- `0033` — strava/client.ts - token storage in SourceAccount (T7) and rotating-refresh-token handling
- `0034` — strava listSince(since) - the mandatory reconciliation sweep and the manual-sync producer
- `0035` — Fetch the full latlng stream - never summary_polyline, and never send resolution/series_type
- `0036` — strava/normalize.ts - pure, no network, no clock, streams JSON to { activity, trace }
- `0037` — Activity-kind mapping on sport_type, indoor/no-GPS handling, and trace sanitation
- `0038` — Checked-in real-response fixtures, the fidelity floor, and rate-limit backoff

## Design notes

No separate DESIGN session was held for this capability. Its seven tickets were written during
the original backlog pass and each carries its own design citations, so notes accumulate here per
ticket as they did for `02-deploy-and-auth` rather than arriving in one block. If a later ticket
finds the design contradictory rather than merely thin, that is the trigger for the DESIGN session
`WORKFLOW.md` prescribes — as `04` did.

## The Strava app registration  (ticket 0032, 2026-09-04)

**Authorization Callback Domain: `devaultsecurity.com`** — a bare domain, no scheme, no path, no
port, which is the only form that field accepts.

**Established by probe, not by reading the settings page.** The authorize endpoint answers
`302 -> https://www.strava.com/login` for a `redirect_uri` it will honour and `400` for one it
refuses, so the app's configuration is directly observable with nothing but the `client_id`
(`01-architecture.md` §7 records that id as semi-public by design — it appears in every authorize
URL). Re-runnable at any time, and cheap enough to be the verification rather than a screenshot:

```
soles.devaultsecurity.com/cb                   302   accepted
other.devaultsecurity.com/cb                   302   accepted
devaultsecurity.com/cb                         302   accepted
localhost:3000/cb                              302   accepted
notsoles.devaultsecurity.com.evil.example/cb   400   refused
attacker.example/cb                            400   refused
```

**Two findings came out of that, and both correct a written claim.**

1. **The domain is the bare parent, not the app's subdomain.** Strava matches the configured
   domain *or any subdomain of it*, so every `*.devaultsecurity.com` host is currently a
   legitimate destination for this app's authorization codes — the exact future
   `app/api/tickets/capture/route.ts` already worries about in its CORS comment. Narrowing it to
   `soles.devaultsecurity.com` is ticket **`0163`**; it is a settings-page edit and no code
   changes. Suffix confusion is handled correctly by Strava, as the fifth row shows.

2. **`localhost` needs no second app.** `03-integrations.md` §2.2 and ticket `0032` both said
   *"you cannot have both at once on one app, so register a second throwaway Strava app for local
   dev"*. The probe shows `localhost` and the production host accepted by the **same** app —
   Strava exempts `localhost` from the callback-domain match. §2.2 was amended. There are two
   further `STRAVA_CLIENT_ID` values in SSM under the sandbox paths
   (`lostsoles/root-sandbox-…`, `lostsoles/vivicat-sandbox-…`); whatever they were created for,
   this constraint is not it.

**Credentials** live at `/amplify/shared/d14fhvl4rp79nn/STRAVA_CLIENT_ID` and
`…/STRAVA_CLIENT_SECRET` (ticket `0017`), read at cold start by
`lib/sources/oauth-credentials.ts`. The SSR compute role is granted `ssm:GetParameter` on **those
two ARNs by name** — not on the path prefix, which also holds `GITHUB_TICKETS_PAT` and would have
quietly widened the compute role's reach to a token that acts as the operator on the repository.

## The two connection tables  (ticket 0032, 2026-09-04)

`LostSolesSourceAccount` (T7) and `LostSolesOAuthState`, both CDK, both in the `SourceConnections`
stack, both **absent from AppSync at any auth level** (I-20, I-28, I-29).

**Both names are literals stated twice** — in `amplify/backend.ts` and in the `lib/sources/*`
module that reads them — because the SSR compute is not a `defineFunction` Lambda and has no
CloudFormation output to be handed a generated name through. A test asserts each pair agrees. This
is the same trade-off `LostSolesCaptureGuard` records, **with one extra cost worth knowing before
you hit it**: `LostSolesSourceAccount` is `RETAIN`, so a stack teardown leaves the table behind
still holding its account-unique name, and recreating the stack then fails with a name collision
until the orphan is adopted or deleted by hand. That is the correct trade — `DESTROY` would make a
teardown silently delete the one thing in this system that cannot be rebuilt
(`02-data-model.md` §1.1, §8, I-2) — but it will look like a defect the first time it happens.

**No point-in-time recovery on T7, deliberately.** §1.1 lists its tokens as *not rebuildable, and
must not be*; recovery is re-authorisation. PITR is a continuous second copy of live credentials,
restorable by anyone who can restore a table, and it would make the drill's §8.3 claim untrue.

The `byExternalOwner` GSI (`KEYS_ONLY`) and the CMK are **not** here — they are ticket `0033`'s,
alongside the rotation handling they exist to serve.

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

