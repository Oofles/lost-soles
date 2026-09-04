---
id: 33
slug: strava-client-token-storage-and-refresh
title: strava/client.ts - token storage in SourceAccount (T7) and rotating-refresh-token handling
type: feature
priority: high
status: open
size: m
capability: 05-strava-adapter
depends_on: [32]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-04T20:29:09Z
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

- [ ] `SourceAccount` exists as a **CDK** table with `removalPolicy: RETAIN` and is **absent from
      the AppSync schema** — a test asserts no `defineData` model exposes it at any auth level.
- [ ] GSI1 `byExternalOwner` is projected `KEYS_ONLY`; a test asserts a query on the index returns
      no token attribute.
- [ ] Tokens are encrypted at rest with a CMK.
- [ ] A logger redaction test: an object containing `accessToken`/`refreshToken` is logged and the
      emitted line contains neither value.
- [ ] Refresh fires at `expiresAt - 300s`, driven by the stored value, not a constant TTL.
- [ ] A refresh response carrying a **new** `refresh_token` persists it, and the write happens
      **before** the new access token is used for any API call — asserted by ordering, not by
      comment.
- [ ] The persist is a conditional update keyed on the previous refresh token; a test simulating
      two concurrent refreshes asserts exactly one wins and the loser retries against the winner's
      value rather than overwriting it.
- [ ] A crash injected between the token response and the persist leaves the **old** refresh token
      valid and the connection usable — the connection is never orphaned by a mid-refresh failure.
- [ ] A per-connection lock row with a short TTL serializes refreshes; a test asserts a second
      concurrent refresh waits or no-ops rather than issuing a second exchange.
- [ ] Two consecutive 401s across a refresh set `status: NEEDS_REAUTH` and stop further calls for
      that connection; no retry storm.
- [ ] `scopes` is asserted to contain `activity:read_all` on every load; a row without it is
      treated as `NEEDS_REAUTH`.
- [ ] Everything added is under `src/adapters/strava/`; the 0027 T1 grep stays green.

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
