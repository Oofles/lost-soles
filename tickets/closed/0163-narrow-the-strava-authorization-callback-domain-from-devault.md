---
id: 163
slug: narrow-the-strava-authorization-callback-domain-from-devault
title: Narrow the Strava Authorization Callback Domain from devaultsecurity.com to the app subdomain
type: chore
priority: med
status: closed
size: s
capability: 05-strava-adapter
depends_on: []
blocked_by: []
source: agent
created: 2026-09-04T17:40:35Z
closed: 2026-09-06T15:21:36Z
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

**CLOSED AS AN ACCEPTED RISK, NOT AS A FIX** — operator decision, 2026-09-06, recorded as
**D-202** with a re-open trigger. Criteria 1, 2 and 4 are amended rather than ticked; the
ticket asked for a change that cannot be made and then verified. Nothing here was ticked on
the operator's behalf.

- [x] ~~**(operator)** The Strava app's Authorization Callback Domain is
      `soles.devaultsecurity.com`.~~
      **AMENDED — UNBUILDABLE. There is no such field on the settings page.** The operator
      confirmed, logged in, that `https://www.strava.com/settings/api` for client id `276053`
      shows no Authorization Callback Domain control. This ticket's premise — *"the fix is one
      field on one settings page"* — is false for the current Strava UI. Rewritten as: *the
      exposure is measured, and either narrowed or accepted with a trigger.*
- [x] ~~The probe is re-run and `other.devaultsecurity.com` and the bare parent now return
      **400**~~
      **AMENDED — re-run, and they still return 302.** That is the honest result and it is
      recorded rather than worked around. Full table in Operator validation.
- [x] `localhost` is re-probed and the result — accepted or refused — is recorded in
      `docs/capabilities/05-strava-adapter.md`, replacing the value `0032` recorded.
      — still **302 accepted**, on both `localhost:3000/api/auth/strava/callback` and bare
      `localhost/cb`. The exemption is genuine and not a side effect of the parent domain
      being wide: `localhost` is not a subdomain of `devaultsecurity.com`.
- [x] ~~**(operator)** A real connect still completes end to end after the change.~~
      **AMENDED — vacuous, because nothing changed.** No configuration was altered, so there
      is nothing that could have broken a connect. The existing connection is `ACTIVE` with
      `activity:read_all` and was exercised against the live API throughout `0038` and `0172`.
      Asking the operator to re-connect to prove a no-op would be a chore, not a check.
- [x] `docs/capabilities/05-strava-adapter.md` records the new domain, and
      `03-integrations.md` §2.2 agrees with it.
      — both record the domain as the **bare parent**, the acceptance, and a pointer to
      D-202's trigger. §2.2 keeps *"set it to the app's subdomain"* as the instruction for a
      NEW app and states plainly that the live one does not follow it, so the intended and
      actual states are reconciled rather than contradictory.

## Notes

> **BASELINE RE-PROBED 2026-09-06 by the agent, before any change. The finding is still
> live, and `localhost` is still exempt.** Re-run verbatim; it needs no credentials beyond
> the `client_id`, which `01-architecture.md` §7 records as semi-public by design.
>
> ```sh
> CID=$(aws ssm get-parameter --name /amplify/shared/d14fhvl4rp79nn/STRAVA_CLIENT_ID \
>        --with-decryption --profile devault --region us-east-1 \
>        --query 'Parameter.Value' --output text)
> for uri in \
>   "https://soles.devaultsecurity.com/api/auth/strava/callback" \
>   "https://other.devaultsecurity.com/cb" \
>   "https://devaultsecurity.com/cb" \
>   "https://notsoles.devaultsecurity.com.evil.example/cb" \
>   "https://attacker.example/cb" \
>   "http://localhost:3000/api/auth/strava/callback" ; do
>   printf "%-56s %s\n" "$uri" "$(curl -s -o /dev/null -w '%{http_code}' -G \
>     https://www.strava.com/oauth/authorize \
>     --data-urlencode "client_id=$CID" --data-urlencode "redirect_uri=$uri" \
>     --data-urlencode "response_type=code" --data-urlencode "scope=activity:read_all")"
> done
> ```
>
> | redirect_uri | before (2026-09-06) | required after |
> |---|---|---|
> | `soles.devaultsecurity.com/api/auth/strava/callback` | **302 accepted** | 302 accepted |
> | `other.devaultsecurity.com/cb` | **302 accepted** ← the finding | **400 refused** |
> | `devaultsecurity.com/cb` | **302 accepted** ← the finding | **400 refused** |
> | `notsoles.devaultsecurity.com.evil.example/cb` | 400 refused | 400 refused |
> | `attacker.example/cb` | 400 refused | 400 refused |
> | `localhost:3000/api/auth/strava/callback` | **302 accepted** | expected to stay 302 |
>
> **`--with-decryption` is required and its absence fails silently in the worst way.**
> Without it, SSM returns the *ciphertext* rather than the client id, every probe answers
> 400 because the client id is invalid, and the table reads as though the domain were
> already narrowed — a completely clean-looking result that means nothing. That happened on
> the first run of this probe today. Always sanity-check that at least one row is 302
> before believing any row that is 400.


The probe needs no credentials beyond the `client_id`, which `01-architecture.md` §7 already
records as semi-public by design — it appears in every authorize URL. It is therefore safe to
re-run at any time and cheap enough to be the verification rather than a screenshot of a settings
page.

## Resolution

**Closed as an accepted risk. The exposure this ticket describes is real, still live, and
staying.** Operator decision, 2026-09-06, recorded as **D-202** with a re-open trigger.

**Files touched:** `docs/decisions/DECISIONS.md` (**D-202**),
`docs/capabilities/05-strava-adapter.md`, `docs/03-integrations.md` §2.2, `docs/INDEX.md`.
No code changed, as the ticket predicted — though not for the reason it predicted.

**The ticket's premise turned out to be false.** It says *"The fix is not code. It is
`https://www.strava.com/settings/api` → Authorization Callback Domain → …"*. The operator,
logged in, found **no such field** on that page for client id `276053`. Strava's settings UI
no longer exposes it for this app. So the ticket asked for a one-field edit that does not
exist, and the choice collapsed to: leave it, or recreate the app.

**Two things went wrong on the way here and both are worth recording**, because each produced
a confident wrong answer:

1. **The first probe read the SSM parameter without `--with-decryption`** and got the
   ciphertext. Every redirect URI then answered `400` — because the `client_id` was garbage,
   not because the domain was narrow — and the table looked *exactly* like a successful fix.
   A clean-looking all-400 result is the failure signature here, so the procedure recorded in
   the Notes now says to sanity-check that at least one row is `302` before believing any row
   that is `400`.
2. **The operator initially browsed to `soles.devaultsecurity.com/settings/api`** — the app's
   own host — and got a 404, which is correct behaviour from Lost Soles and says nothing
   about Strava. The settings page is on `www.strava.com`. Worth noting only because both the
   ticket and the session summary wrote the URL correctly and it was still easy to misread.

**Why accepting is defensible, and why it is conditional.** I measured the residual exposure
instead of estimating it. Reaching the codes needs an attacker to *receive* a redirect at some
`*.devaultsecurity.com` host, which needs content control on a live sibling or a DNS record
for a new one — and the operator owns the zone. All six live siblings (`www`, `github`,
`linkedin`, `mastodon`, `twitter`, `ctf`) refuse anonymous writes, every one has its bucket
present in the account so nothing is claimable, and Strava handles suffix confusion correctly
so the exposure is exactly the sibling set. Add `0032`'s start route building `redirect_uri`
from `APP_ORIGIN` and never from the request, plus the `LostSolesOAuthState` check, and the
residual path is a hand-built authorize URL the operator personally follows to a host the
attacker would already have had to compromise.

**That reasoning is entirely contingent on the table, which is why D-202 is written as a
trigger and not as a dismissal.** The most likely way it goes stale is mundane: a new host
under `*.devaultsecurity.com` serving content the operator does not fully control — a page
builder, a CI preview domain, a hosted status page. `app/api/tickets/capture/route.ts`'s CORS
comment already worries about *"the day something else lands on `*.devaultsecurity.com`"*, and
the finding of this session is that **that day has already come**: six siblings exist. They
are simply all the operator's own static sites today.

**A note for whoever reopens this.** If the app is ever recreated for any reason, register it
with `soles.devaultsecurity.com` — at that point the correct configuration is free, and
"it was free" is sufficient reason. `03-integrations.md` §2.2 keeps that as the standing
instruction for a new app.

## Operator validation

**Split exactly as D-181 requires.** The operator did the one thing no script here can — log
into Strava and read the settings page. Everything else was the agent's, and was run.

**By the operator (2026-09-06):** confirmed the app's Client ID is `276053`, and that
`https://www.strava.com/settings/api` presents **no Authorization Callback Domain field** for
it. That single observation is what turned this ticket from a fix into a risk decision.

**By the agent — the probe, re-run after the operator's check.** Needs no credential beyond
the `client_id` (`01-architecture.md` §7: semi-public by design):

| redirect_uri | 2026-09-04 (`0032`) | 2026-09-06 (now) |
|---|---|---|
| `soles.devaultsecurity.com/api/auth/strava/callback` | 302 accepted | **302 accepted** |
| `other.devaultsecurity.com/cb` | 302 accepted | **302 accepted** — unchanged |
| `devaultsecurity.com/cb` | 302 accepted | **302 accepted** — unchanged |
| `notsoles.devaultsecurity.com.evil.example/cb` | 400 refused | **400 refused** |
| `attacker.example/cb` | 400 refused | **400 refused** |
| `localhost:3000/api/auth/strava/callback` | 302 accepted | **302 accepted** |
| `localhost/cb` | not probed | **302 accepted** |

**By the agent — the measurement the acceptance rests on.** DNS across the parent zone, and
an unauthenticated write attempt against every sibling bucket:

| Host | DNS | Anonymous `PUT` |
|---|---|---|
| `www` · `github` · `linkedin` · `mastodon` · `twitter` · `ctf` | resolves, S3-hosted | **403 on all six** |
| `soles` | CloudFront `d3pljri7vz7pa4` | n/a — the app itself |
| `other`, and an arbitrary made-up name | **no record** | unusable without the zone |

No dangling record and no attacker-writable sibling: every subdomain's bucket exists in
account `286588821906`.

**Not verified, deliberately:** that a fresh end-to-end connect still works. Nothing was
changed, so there is nothing that could have broken — and the live connection was exercised
against the Strava API repeatedly during `0038` and `0172` (~56 reads) and is `ACTIVE` with
`activity:read_all`.

