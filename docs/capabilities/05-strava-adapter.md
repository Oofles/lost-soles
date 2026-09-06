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

## What the OAuth flow cost, and why  (tickets 0032/0165/0166, 2026-09-04)

The first connect worked on the **third** attempt at deploying it. Both intervening defects were
in the same place and had the same cause, and the capability is worth starting from that fact.

`0032` implements the scope check twice: once on the callback query string before the code is
exchanged (**the ticket's criterion 3**), and once on the exchanged grant (**nobody asked for
this**). The pre-exchange check has been correct throughout and did its job live — the operator
deliberately declined the permission and was refused before a token was ever minted. **Both
defects were in the extra check.**

- `0165` — an absent `scope` in the token response was read as "nothing was granted", so a good
  grant was refused and its credential revoked. *(Diagnosis later refuted; see below.)*
- `0166` — the real one. The callback spells its scope list with **commas**; the token endpoint
  spells it with **spaces** (RFC 6749 §5.1). `parseScopes` split on commas only, so
  `"read activity:read_all"` came back as one scope matching nothing and a full grant read as a
  downgrade.

**One document, one example, one surface.** `03-integrations.md` §2.2 shows a scope list exactly
once — on the callback, comma-separated. The parser was written for the surface the document
happened to illustrate. The document was not wrong; it was partial, which is harder to notice and
is now annotated in place rather than quietly rewritten.

**`0032` shipped 76 green tests and could not complete a single connect.** Every token-response
fixture was built from that example, so the suite proved the code matched the document. This is
the argument for `0038` (checked-in real-response fixtures, the fidelity floor), whose Notes now
carry it. **In this capability a fixture derived from a design doc is not a fixture; it is the
design doc asserted twice.**

**Two things paid for themselves and should be repeated.** The two refusal paths were given
*differently worded* log lines, so "which check fired" was answerable from CloudWatch without ever
reproducing anything — twice. And `0165`, unable to distinguish its two hypotheses without an
authorization code only the operator can produce, shipped a fix correct under both and put
`scopeSource` on the grant to settle it; the first successful connect printed
`scopeSource: "response"`, which refuted `0165`'s own diagnosis in one line and confirmed `0166`'s.
A fix safe under every hypothesis you cannot rule out, carrying the evidence that will rule them
out, beats a lucky guess.

**What the connection actually is**, read back rather than reported:

```
externalOwnerId  "51449053"   (a string)      scopes  activity:read_all, read
status           ACTIVE                        expiresAt  connect + 6.0h, from the response
```

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
   `app/api/tickets/capture/route.ts` already worries about in its CORS comment. Suffix confusion
   is handled correctly by Strava, as the fifth row shows.

   > **RESOLVED 2026-09-06 as an ACCEPTED RISK, ticket `0163`, D-202. Not fixed.** The field is
   > not editable on the current Strava settings page, and the residual exposure was measured
   > rather than estimated. **Re-probed 2026-09-06: unchanged** — the parent and every sibling
   > are still accepted. D-202 carries the re-open trigger; read it before treating this as
   > closed business.

2. **`localhost` needs no second app.** `03-integrations.md` §2.2 and ticket `0032` both said
   *"you cannot have both at once on one app, so register a second throwaway Strava app for local
   dev"*. The probe shows `localhost` and the production host accepted by the **same** app —
   Strava exempts `localhost` from the callback-domain match. §2.2 was amended.
   **Re-confirmed 2026-09-06 (`0163` criterion 3): `localhost:3000/api/auth/strava/callback` and
   bare `localhost/cb` both still 302.** The exemption holds; it is not a side effect of the
   parent domain being wide, since `localhost` is not a subdomain of it. There are two
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

## The read budget, recorded so a change is visibly a budget decision  (ticket 0038, 2026-09-06)

`03-integrations.md` §2.5 does the arithmetic; this is the copy that sits next to the code,
so that a future change which multiplies call volume shows up as a **budget decision** and
not as a performance detail.

**The fact everything else follows from: limits are per-APPLICATION, not per-athlete.** The
quota attaches to the `client_id`. Adding a user does not add quota, it splits it.

| Bucket | 15 min | Daily |
|---|---|---|
| Read (every call we make) | 100 | **1,000** |
| Overall | 200 | 2,000 |

**Steady state — ~6-10 reads/day of 1,000.** Webhook fires → 1 detail + 1 streams = 2.
Reconciliation, 4 sweeps × ~1 page = 4. Under 1% of quota: the steady state is free.

**Backfill — ~1,608 calls, ~2.3 days.** 8 years × ~200 activities ≈ 1,600, plus 8 list
pages. At 70% of the daily budget (700/day) that is 2.3 days, checkpointed and resumable.
The 15-minute ceiling of 100 is the tighter constraint, so the worker paces at ≤90 per 15
minutes — one call every ~10 seconds, deliberately slow and correct.

**Measured against the real account while building `0038`:** 104 activities, not the ~1,600
the estimate assumes. The backfill for THIS account is ~112 calls — a few minutes, not two
days. The 1,600 figure is kept because it is the number the *design* has to survive, and
because `0038`'s pacing primitives are sized for it.

**Live budget headers, observed 2026-09-06** across the whole fixture-capture session
(~54 reads — one activity list, ~53 detail/stream calls hunting a real signal-loss jump):

```
x-ratelimit-limit:      200,2000
x-readratelimit-limit:  100,1000
x-readratelimit-usage:  1,37   ->  1,55     (15min, daily)
```

Two things confirmed rather than assumed: the **default tier** is what is actually in
force (100/1,000 read, not the upgraded 200/2,000), and every call this adapter makes
lands in the **read** bucket — the read and overall usage counters moved in lockstep all
session. 55 of 1,000 for a day that included capturing five fixtures and sweeping 53
activities' streams; the budget is not the constraint at one user, exactly as §2.5 says.

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

