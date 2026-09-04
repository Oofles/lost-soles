---
id: 33
slug: strava-client-token-storage-and-refresh
title: strava/client.ts - token storage in SourceAccount (T7) and rotating-refresh-token handling
type: feature
priority: high
status: closed
size: m
capability: 05-strava-adapter
depends_on: [32]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-04T20:29:09Z
closed: 2026-09-04T21:12:57Z
---

## Description

The authenticated HTTP client, and the token lifecycle around it. `03-integrations.md` §2.2 calls
refresh **"the single most common integration bug"**; this ticket exists to get it right once.

**Storage — `SourceAccount` (T7), `02-data-model.md`.** A **CDK table, not in AppSync at any auth
level, ever**. `pk = U#<uid>`, `sk = SRC#strava`. Attributes: `externalOwnerId` (always a string),
`accessToken` / `refreshToken` (encrypted at rest with a CMK, **never logged, never projected into
any index**), `expiresAt` (epoch seconds), `scopes` (must contain `activity:read_all`, never
`activity:read`), `connectedAt`, `lastSuccessfulSyncAt`, `listSinceWatermark`, and `status`
(`ACTIVE | NEEDS_REAUTH | DISCONNECTED`). GSI1 `byExternalOwner`
(`gsi1pk = <sourceId>#<externalOwnerId>`) is projected **KEYS_ONLY** so the webhook Lambda can
resolve `owner_id` → `userId` and **cannot read a credential even with a valid IAM grant**.

**The refresh rules, each of which is a real bug if skipped:**

- Access tokens expire **6 hours** after creation. Use the returned `expires_at`, never a
  hardcoded TTL.
- **Refresh tokens rotate.** Strava's own docs: *"The refresh token may or may not be the same
  refresh token used to make the request."* Any refresh response may carry a **new**
  `refresh_token`, and the moment it does the old one is dead.
- **Therefore: persist the new refresh token transactionally, before using the new access token
  for anything.** A crash between "refreshed" and "wrote the new refresh token" **orphans the
  connection permanently** and forces the operator back through OAuth. Write it with a DynamoDB
  **conditional update keyed on the previous token value**, so two concurrent refreshes cannot
  both win.
- Refresh **proactively at `expires_at - 300s`**, not reactively on 401. A 401 mid-consume costs a
  retry you did not need.
- **Serialize refreshes per connection** with a short-lived lock row. Two Lambdas refreshing the
  same connection at once is the realistic way to lose the rotation race.
- Refresh tokens are **long-lived mutable state** — they do not go in environment variables.
- A 401 that survives one refresh sets `status: NEEDS_REAUTH` and the UI shows "reconnect",
  rather than retry-storming.

## Acceptance criteria

- [x] `SourceAccount` exists as a **CDK** table with `removalPolicy: RETAIN` and is **absent from
      the AppSync schema** — a test asserts no `defineData` model exposes it at any auth level.
- [x] GSI1 `byExternalOwner` is projected `KEYS_ONLY`; a test asserts a query on the index returns
      no token attribute.
- [x] Tokens are encrypted at rest with a CMK.
- [x] A logger redaction test: an object containing `accessToken`/`refreshToken` is logged and the
      emitted line contains neither value.
- [x] Refresh fires at `expiresAt - 300s`, driven by the stored value, not a constant TTL.
- [x] A refresh response carrying a **new** `refresh_token` persists it, and the write happens
      **before** the new access token is used for any API call — asserted by ordering, not by
      comment.
- [x] The persist is a conditional update keyed on the previous refresh token; a test simulating
      two concurrent refreshes asserts exactly one wins and the loser retries against the winner's
      value rather than overwriting it.
- [x] ~~A crash injected between the token response and the persist leaves the **old** refresh token
      valid and the connection usable — the connection is never orphaned by a mid-refresh failure.~~
      **AMENDED 2026-09-04, before the work started.** A crash injected between the token response
      and the persist leaves the stored state **no worse than it was**: the row still holds the old
      refresh token, `status` stays `ACTIVE`, nothing is blanked, and the next attempt re-uses it.
      *Reason:* the original wording claims a guarantee no code on this side can make. If the
      provider kills the old refresh token the instant it issues the new one, that token is dead
      before our process could have written anything, and no ordering fixes it. What is ours to
      control is that we never make it worse — see the Resolution.
- [x] ~~A per-connection lock row with a short TTL serializes refreshes;~~ **AMENDED** — a
      per-connection **lease held on the connection's own row**, expired by comparison against the
      clock, serializes refreshes; a test asserts a second concurrent refresh waits or no-ops
      rather than issuing a second exchange. *Reason:* a lock row with a DynamoDB TTL requires
      `timeToLiveAttribute` on T7, and T7's own declaration says it must not have one — a
      credential that vanishes on a schedule is a connection that dies silently. DynamoDB's TTL
      sweep is also up to 48 hours late, which is useless for a 15-second lock.
- [x] Two consecutive 401s across a refresh set `status: NEEDS_REAUTH` and stop further calls for
      that connection; no retry storm.
- [x] `scopes` is asserted to contain `activity:read_all` on every load; a row without it is
      treated as `NEEDS_REAUTH`.
- [x] ~~Everything added is under `src/adapters/strava/`;~~ **AMENDED**, the same amendment ticket
      `0032` made to its criterion 9: everything **vendor-specific** is under
      `src/adapters/strava/`; the 0027 T1 grep stays green. *Reason:* the table and its key are
      CDK (`amplify/backend.ts`), the storage and rotation logic is source-agnostic by design
      (`lib/sources/`), and redaction belongs to the logger. Putting any of them in the adapter
      would put a vendor's name on generic code, which is the thing D-100 forbids.

## Notes

The conditional-update-on-previous-value pattern is the whole trick: it makes the rotation race
resolvable without a distributed lock being strictly required, and it makes the failure mode
"one refresh loses and retries" instead of "the connection is dead and only re-authorization
fixes it".

Token refresh is not a read-bucket call for rate-limit purposes, but count it anyway — roughly
4/day at a 6h TTL (`03-integrations.md` §2.5).

Tokens are the one thing in the system that is **not rebuildable and must not be**
(`02-data-model.md` §8): the rebuild drill does not restore T7, and recovery is re-authorisation,
by design.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

**Device: the operator's Android phone, on the app's connect/settings screen.** Connect Strava,
then leave the app alone for more than 6 hours and open it again — a Sync must succeed without any
re-authorization prompt. That is the proactive refresh working. Then, in the AWS console, look at
the `SourceAccount` row and confirm `expiresAt` has moved forward and the refresh token value has
changed at least once. Finally, hand-corrupt the stored refresh token and confirm the settings
screen shows a clear "reconnect Strava" state rather than spinning.

## Resolution

**Files touched.**

| File | What |
|---|---|
| `amplify/backend.ts` | the CMK, `encryption: CUSTOMER_MANAGED`, and GSI1 `byExternalOwner` KEYS_ONLY |
| `lib/sources/source-account-store.ts` | `loadCredentials`, `acquireRefreshLease`, `releaseRefreshLease`, `rotateTokens`, `markNeedsReauth`, `resolveUserByExternalOwner`, and `gsi1pk` on connect |
| `lib/sources/token-refresh.ts` | **new** — the orchestration. Source-agnostic; names no provider, scope, host or TTL |
| `src/adapters/errors.ts` | **new** — `OAuthProviderError` (with `credentialIsDead`), `SourceNeedsReauthError`, `SourceNotConnectedError` |
| `src/adapters/strava/client.ts` | **new** — the authenticated client and the 401 policy |
| `src/adapters/strava/oauth.ts` | `refreshTokens`; `StravaOAuthError` now extends the shared class |
| `src/adapters/types.ts` | `OAuthRefresh`, and `refreshTokens` on `OAuthConnector` |
| `lib/log.ts` | redaction by key NAME |

Tests: `token-refresh.test.ts` (25) and `client.test.ts` (8) are new; `log.test.ts`,
`source-account-store.test.ts` and `oauth.test.ts` gained cases. **605 passing.**

**The decisions, and why.**

**1. The lease lives on the row, not in a lock row.** The ticket said "lock row with a short TTL".
Building that means putting `timeToLiveAttribute` on T7 — and T7's declaration in
`amplify/backend.ts` argues, in as many words, that it must not have one. Adding a row-deleting
mechanism to the one table the rebuild drill cannot restore, in order to expire a fifteen-second
lock, is a large permanent risk bought with a small convenience. DynamoDB's TTL sweep is lazy by up
to 48 hours anyway, so it could not have expired the lock even if it were safe. A `refreshLeaseUntil`
attribute compared against the clock does the job with no such mechanism.

**2. The lease is not the safety property, and it was important not to treat it as one.** The
condition on `rotateTokens` is. A lease can expire while its holder is mid-exchange, so the
concurrency test deliberately grants it to BOTH refreshers and asserts correctness anyway: two
exchanges happen, exactly one write applies, the loser is refused and reads the winner's value. The
lease makes the race rare; the condition makes it survivable.

**3. `knownStale` is a value, not a `force: boolean`.** A boolean says "refresh regardless", which
under concurrency means a second refresher discards a token the first just obtained and refreshes
again — a retry storm assembled from two correct-looking parts. Passing the token that failed asks
the precise question instead: does the row still hold it?

**4. `NEEDS_REAUTH` keeps the tokens; `DISCONNECTED` deletes them.** The two look similar and are
opposite. Disconnect removes a credential because the user asked. `NEEDS_REAUTH` is a *diagnosis*,
possibly a wrong one — the refresh token may be fine and the failure misjudged — so deleting it
would convert a recoverable mistake into the unrecoverable one this whole ticket exists to prevent.
`markNeedsReauth` is also conditional on the row not being `DISCONNECTED`, so a refresh in flight
when the operator taps Disconnect cannot resurrect the connection as "broken, please fix".

**5. 400 and 401 mean dead; everything else means transient.** That branch lives on
`OAuthProviderError.credentialIsDead` so it is decided once. Marking `NEEDS_REAUTH` on a 503 would
send the operator through a full OAuth flow on a phone to repair a five-minute outage.

**6. Redaction by key name, because no pattern can work.** A Strava access token is forty hex
characters — so is a commit id. Any regex loose enough to catch one catches every opaque identifier
this app logs deliberately. The field NAME is the reliable signal, so `scrubKeys` walks the value
before serialisation and blanks anything under a credential-shaped key. It also renders `Set`s as
arrays, because `JSON.stringify(new Set([...]))` is `{}` — which had been silently swallowing
`scopes`, the exact field ticket `0166` needed to see.

**What went wrong, and what it cost.**

**The first deploy failed, and not on anything it was meant to catch.** Amplify job 92 died in
`check-design-tokens.mjs`, whose pattern is `/#[0-9a-f]{3,8}\b/i` — and every DynamoDB composite
key here is `<prefix>#<value>`, so `acme#134815` and `U#abc` are syntactically valid hex colours.
So is the production GSI1 key `strava#51449053`. I had run three of the four gates locally and not
that one. Fixed in this ticket's own fixtures by interpolating the id; the gate itself is filed as
**`0167`**, because the webhook ticket resolves `owner_id` through exactly that key and will hit it
again.

**The CDK change shipped as TWO deploys, deliberately.** Combining a GSI addition with an
`SSESpecification` change in one CloudFormation update is not reliably supported, and this is the
table holding the one thing that cannot be rebuilt. The index went out in `742085e` (job 93), the
CMK in `39841fc` (job 94). Both succeeded. Recorded so the next person is not puzzled by
two commits touching the same block.

**A smoke test put the live row into `NEEDS_REAUTH` and I had to repair it.** Checking the
load-time scope refusal against the real row worked exactly as designed — which is to say it wrote
the state. Restored to `ACTIVE` with the tokens, scopes and `gsi1pk` intact, and re-verified. The
mechanism is proven; the carelessness was mine, and running a state-writing check against the one
live credential row deserved more thought than it got.

**The one thing the live run could NOT prove.** Strava returned an identical access token, refresh
token and `expires_at` — because the stored access token still had 4.3 hours of life, and Strava
does not mint a new one until the current is near expiry. So the full path executed and persisted
(`refreshedAt` was written, the lease released), but **an actual rotation was not observed live**.
Rotation is covered by unit tests only. Waiting for it would mean holding the session until roughly
`01:00Z`; it will be observed for free the first time the proactive refresh fires on its own, and
`03-integrations.md` §2.2 should be annotated then, exactly as `0165` annotated step 3.

**`gsi1pk` on the pre-existing row.** The one connected account was written by `0032`, before the
index existed, so it carried no `gsi1pk` and was invisible to `byExternalOwner`. Backfilled by
script during the smoke test rather than left for a reconnect.

## Operator validation

**None required. Everything here was reachable with AWS credentials and is recorded below as smoke
tests (D-181).** This capability has no screen of its own, and the settings screen already renders
`NEEDS_REAUTH` as "not connected, offering Connect" — asserted in `app/settings/page.test.tsx` since
ticket `0032`. Nothing in this ticket changes a pixel.

**1. The infrastructure, read back from the deployed table.**

```
$ aws dynamodb describe-table --table-name LostSolesSourceAccount
GlobalSecondaryIndexes: [{ Index: byExternalOwner, Projection: KEYS_ONLY,
                           Status: ACTIVE, Keys: [gsi1pk HASH] }]
SSEDescription:         { Status: ENABLED, SSEType: KMS,
                          KMSMasterKeyArn: ...key/f00bda48-737a-4c1e-b9e3-f3a9c9656246 }

$ aws kms describe-key / get-key-rotation-status
Manager: CUSTOMER   State: Enabled   KeyRotationEnabled: true   RotationPeriodInDays: 365
Alias:   alias/lost-soles-source-account
```

Criteria 1, 2 and 3. The IAM half was checked too: `LostSolesAmplifyComputeRole` carries
`kms:Decrypt / Encrypt / ReEncrypt* / GenerateDataKey* / DescribeKey` on that key ARN alone, added
automatically by `grantReadWriteData` as the code comment claims — worth confirming rather than
trusting, because without it every read fails with an AccessDenied naming DynamoDB and not the key.

**2. The KEYS_ONLY guarantee, against the live index** (criterion 2's "a query returns no token
attribute" — run through the store's own `resolveUserByExternalOwner`):

```
backfilled gsi1pk on the row 0032 wrote (it predates the index)
resolveUserByExternalOwner -> 5488e4b8-d081-7014-748e-edd1937f8083
attributes returned by the index: gsi1pk, pk, sk
carries a token attribute: false
cross-source lookup ("fitbit", same id) -> null
```

Three attributes come back and none of them is a credential. The webhook could hold a valid `Query`
grant on this index and still be unable to read a token, because there is no token there to read.

**3. The two conditional writes, against real DynamoDB.** The unit tests fake a table that honours
these; this is the check that the real one does — the only part of that fake that could quietly be
wrong. The rotation was attempted with a deliberately WRONG previous value, so the only correct
outcome is a refusal and no write:

```
1. THE ROTATION CONDITION
   won                        false      (conditional check refused it)
   tokens untouched           true
   expiresAt untouched        true
2. THE LEASE
   first acquire              true
   second acquire             false      (serialized)
   lease stored / released    true / true
3. THE SCOPE CHECK ON LOAD
   required scope present     true
   a scope the row lacks      needs-reauth
   row now says               NEEDS_REAUTH   <- the load WROTE this
```

Criteria 7, 9 and 11, live. Step 3's write was then reversed — see the Resolution.

**4. A real refresh against Strava, through the real code path**, forced with `knownStale` rather
than by waiting for the window:

```
BEFORE   status ACTIVE   expiresAt 2026-09-05T01:28:16Z   (15,470s of life)
AFTER    status ACTIVE   expiresAt 2026-09-05T01:28:16Z   refreshedAt 2026-09-04T21:10:27Z
         returned token IS the persisted one   true
         scopes preserved  activity:read_all,read
         gsi1pk preserved  strava#51449053
         no lease left behind  true
LIVE API CALL   GET /athlete -> 200   athlete id 51449053
```

The exchange, the conditional persist and the release all executed, and the token that came back is
the one in the row. **The refresh token did not rotate**, because Strava returns the existing
credential while it still has hours to run — so live rotation stays unproven, as the Resolution
says plainly.

**5. Gates.** `npm test` 605 passed / 1 skipped; `tsc --noEmit`, `eslint --max-warnings 0`,
`check-boundaries.mjs` and `check-design-tokens.mjs` all clean; `npm run build` clean. Amplify jobs
93 and 94 both SUCCEED, which runs the same five in the container that actually deploys.
