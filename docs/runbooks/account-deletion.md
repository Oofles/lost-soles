# Runbook — deleting an account

**Status: NOT YET EXECUTABLE.** This file is a stub. Ticket `0089` created it so the account-deletion
entry on `/settings` has a stable path to link to. Ticket **`0106`** (capability `16`) owns filling
it in: it writes the deletion script, executes it once against a throwaway account, and replaces
this stub with the steps as run. Until `0106` closes, **there is no deletion path. Do not improvise
one.** A deletion path that has never been executed is not a deletion path.

Normative source: **`docs/08-security-privacy.md` §6.4** *Account deletion — the runbook*, with
`docs/02-data-model.md` §8.5.

---

## What deleting means, in short

The design lives in §6.4, and that section is authoritative. In order, because the order matters:

1. Revoke upstream first, at the activity source.
2. Delete the `SourceAccount` row.
3. Disable the Cognito user, `AdminUserGlobalSignOut`, then delete it (sign-out fails on a
   deleted user).
4. Delete every owner-scoped DynamoDB row by `uid` (D-307 lists the tables).
5. Delete `raw/<uid>/` and the identity prefix, under the break-glass role.
6. Purge noncurrent S3 versions for those prefixes, and set a lifecycle rule to abort incomplete
   multipart uploads.
7. Let the logs age out under the 30-day retention.
8. Confirm in writing what was deleted.

**This cannot be undone.** DynamoDB PITR retains deleted rows for up to 35 days, so a deletion is
complete only at the end of that window.

## What it is not

**Disconnecting a source is not deleting an account** (§6.5). Disconnect, on `/settings`, revokes
the source token and stops ingest. It does not touch the map, the XP ledger or the raw archive. If
you only want to stop a sync, disconnect. Do not use this runbook for that.
