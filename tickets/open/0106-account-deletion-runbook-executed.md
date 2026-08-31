---
id: 106
slug: account-deletion-runbook-executed
title: Account-deletion runbook, executed once against a throwaway account
type: chore
priority: high
status: open
size: m
capability: 16-rebuild-drill
depends_on: [17, 44]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Write the account-deletion script (`02-data-model.md` §8.5, `08-security-privacy.md` §6.4) and
**execute it once against a throwaway account**. Gate item A-5 of the D-123 Trigger A checklist
requires it to have been executed once against a test account — *that is not paperwork, it is the
only way to know the S3 prefix delete actually works.*

Order matters, and the two steps most often missed are 5 and 6:

1. **Revoke upstream first** — `POST https://www.strava.com/oauth/deauthorize` with the user's
   access token, so the third party stops being able to send data mid-deletion.
2. **Delete the `SourceAccount` row** (T7 — tokens gone; stop the inflow before the outflow).
3. **Disable, then delete, the Cognito user.** Disable first: it stops sessions immediately while
   the slower deletes run. `globalSignOut` to kill outstanding refresh tokens.
4. **Delete DynamoDB rows by `uid`** — every item under `pk` prefix `U#<uid>#` in T6, the T2/T4
   rows, T3 via GSI1, the T1 row, and any un-TTL'd T8 rows. Partition-key scoping makes this a
   query, not a scan.
5. **Delete `raw/<uid>/` and the user's `entity('identity')` prefix — under the break-glass
   role.** Bucket policy denies `DeleteObject` on `raw/*` to every principal except an explicit
   break-glass role (`01-architecture.md` §3), so this is the one step that requires deliberately
   assuming a role. **That friction is intentional: it is the difference between a bug deleting
   the archive and a person deleting it.** A runbook that quietly grants the deletion Lambda
   `raw/*` delete rights has removed the only protection the archive has.
6. **Purge noncurrent versions.** Versioning is on, so an object "deleted" in step 5 is a delete
   marker over live bytes. **A deletion that leaves the previous versions in place is not a
   deletion.** Enumerate and remove noncurrent versions for that prefix explicitly, and set a
   lifecycle rule to abort incomplete multipart uploads while you are there.
7. **Let the logs age out** under the 30-day CloudWatch retention. Do not hand-scrub log groups;
   the retention *is* the answer and is one of the reasons it is set.
8. **Confirm in writing** what was deleted and what could not be (nothing should be in that second
   category).

**And say the true thing about backups.** There are none beyond S3 versioning and DynamoDB PITR.
PITR holds deleted rows for up to **35 days**, so **a deletion is complete at the end of the PITR
window, not the moment the script exits.** State that to the requester rather than overstating it;
the same window is what would let a wrong-user deletion be undone, which is the correct trade at
this scale.

This is the one operation permitted to delete `ExploredCell` items and `raw/` objects. It must be
gated behind an **explicit typed confirmation**, and it must **never** be a side effect of
disconnecting a source — disconnecting Strava deletes `SourceAccount` and stops ingest and **does
not touch the map** (§6.5), because the explored set came from traces archived in `raw/` that
belong to the user, not to Strava (D-101).

## Acceptance criteria

- [ ] The script exists in the repo, takes a `uid`, and requires the operator to type the uid to
      confirm; a non-matching confirmation aborts with zero side effects.
- [ ] Steps run in the documented order; a test with each step stubbed asserts the ordering,
      including revoke-before-delete and disable-before-delete.
- [ ] Step 5 assumes the break-glass role explicitly. A test asserts the **default** execution
      role cannot delete under `raw/*` (expect AccessDenied) — proving the bucket policy is real.
- [ ] Step 6 enumerates and deletes noncurrent versions and delete markers; after a real run,
      `aws s3api list-object-versions --prefix raw/<uid>/` returns **zero** versions and zero
      delete markers.
- [ ] The lifecycle rule aborting incomplete multipart uploads exists on the bucket.
- [ ] **Executed once against a throwaway Cognito account** that had at least one real ingested
      activity — so raw objects, cells, ledger rows and explored cells all existed before the run
      — and the before/after object and item counts are pasted into
      `docs/capabilities/16-rebuild-drill.md`.
- [ ] The written confirmation produced by the run states explicitly that PITR holds rows for up
      to 35 days and the deletion completes at the end of that window.
- [ ] Disconnecting a source is proven **not** to trigger deletion: a test disconnects Strava and
      asserts `ExploredCell` count, `raw/` object count and `Activity` count are unchanged.

## Notes

The throwaway account must be a genuine second Cognito user with genuine ingested data. Deleting
an empty account proves the script runs; it proves nothing about whether the prefix delete, the
break-glass assumption, or the version purge work.

Note the ordering trap in the D-123 gate: creating that second Cognito account is itself **Trigger
A** (`08-security-privacy.md` §2.4). Create it, run the deletion, delete it, and record the whole
sequence — do not leave it standing. If it is going to stand for more than the length of this
test, the Trigger A gate opens and 0114 applies.

## Operator validation

From the laptop with the AWS console open: before the run, note the throwaway account's raw object
count and `ExploredCell` item count. Run the script. Afterwards check, in the console, that (a)
`raw/<uid>/` shows nothing with "Show versions" **enabled** — not just with it off, which is where
the missed step hides; (b) the Cognito user is gone from the pool; (c) the Strava app's authorised
applications list no longer shows the connection. Then sign in on the phone as the owner and
confirm your own map is completely untouched.
