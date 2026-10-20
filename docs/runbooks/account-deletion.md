# Runbook — deleting an account

**Status: executable.** Written and tested in ticket **`0106`**, and executed once against a throwaway
account — the before/after counts are in [`../capabilities/16-rebuild-drill.md`](../capabilities/16-rebuild-drill.md)
§*Account deletion, executed*. This path is linked from `/settings` (D-325); do not move it.

Normative source: **`docs/08-security-privacy.md` §6.4** *Account deletion — the runbook*, with
`docs/02-data-model.md` §8.5. Where this file says *how*, those say *why*.

**This cannot be undone.** After step 6 there is no rebuild, because bedrock (`raw/`) is gone.

---

## What it is not

**Disconnecting a source is not deleting an account** (§6.5). Disconnect, on `/settings`, revokes the
source token and stops ingest. It does not touch the map, the XP ledger or the raw archive — a test
counts `ExploredCell`, `raw/` and `Activity` either side of a disconnect and asserts they do not move
(`app/api/auth/[source]/disconnect/disconnect-is-not-deletion.test.ts`). If you only want to stop a
sync, disconnect. Do not use this runbook for that.

## Before you start

- **Laptop, `AWS_PROFILE=devault`** (CLAUDE.md). Run as the operator — the script assumes the
  break-glass role itself, for step 5 only. It refuses to run *as* that role.
- **The user's Cognito `sub`.** Everything is keyed by it: `raw/<sub>/`, `users/<sub>/`,
  `snapshots/skillstate/<sub>/`, `U#<sub>#…`. Find it with
  `aws cognito-idp list-users --user-pool-id <pool> --filter 'email = "<email>"'` (`Attributes[sub]`).
- **The identity-pool id, only if `users/<region>:<uuid>/` prefixes exist.** That is the
  `entity('identity')` prefix (`amplify/storage/resource.ts`), a different string from the sub, and it
  cannot be derived from the sub. Nothing writes there today, and the script checks: if any such
  prefix exists it stops and asks for `--identity-id`.
- **Is this the owner?** If the sub is in `OWNER_USER_IDS` the script **refuses**, before any AWS
  call, unless `--delete-owner` is also passed. With the flag it runs the same preflight and asks for
  the same typed uid — the flag is in addition to the confirmation, never instead of it.

## Run it

```sh
npx vite-node --config vitest.config.ts tools/account-deletion/delete-account.ts -- --user <sub>
#   add --delete-owner only if <sub> is the owner's
```

1. **Preflight, read-only.** Resolves the Cognito user; counts every row and every S3 version the
   user owns (the *before*); and proves the archive guard against the **live** bucket policy with an
   IAM policy simulation: the operator's own principal must get `explicitDeny` for
   `s3:DeleteObject` and `s3:DeleteObjectVersion` on `raw/<sub>/…`, and `LostSolesArchiveDeletion`
   must get `allowed`. If the operator could delete under `raw/*`, the archive is unprotected and the
   script stops here.
2. **Type the uid.** Anything else exits `3` having changed nothing. (So does an owner sub without
   `--delete-owner`, before step 1 of the preflight.)
3. **The S3 probe.** A delete of a version that cannot exist, under a key that cannot exist, with the
   operator's credentials. S3 must answer `AccessDenied`. It changes nothing either way.
4. Then the steps below, in order. Any failure aborts the run where it stands; see *If it fails*.

| # | Step | How |
|---|---|---|
| 1 | **Revoke upstream** | Each connectable source's own `revoke` — the same call `/settings`' disconnect makes (`tools/account-deletion/revoke.ts`). For Strava that is `POST /oauth/revoke` with client credentials, the current form of the legacy `/oauth/deauthorize`; a 401 means the token is already dead and counts as done. **No token (no row, `DISCONNECTED`, `NEEDS_REAUTH`) is a recorded no-op, not a failure** (D-348). A revoke failure aborts before anything is deleted. |
| 2 | **Delete `SourceAccount`** | Every `U#<sub>` / `SRC#*` row. Tokens gone. |
| 3 | **Disable, then global sign-out** | `AdminDisableUser`, `AdminUserGlobalSignOut`. Sessions stop now, while the slow deletes run. |
| 4 | **DynamoDB rows by uid** | `ExploredCell` (`begins_with(pk, "U#<sub>#")` — cells and aggregates), `Activity`, `XpLedgerEntry`, `SkillState`, `Landmark`, `Profile` (D-307), `IngestReceipt`, `OAuthState`. As the operator: every writer holds `UpdateItem` only. |
| 5 | **S3 current objects** | `raw/<sub>/` **under `LostSolesArchiveDeletion`** (assumed by the script, one hour); `users/<sub>/`, `snapshots/skillstate/<sub>/` (D-259) and any `users/<identityId>/` as the operator. This writes delete markers. Kind overrides and `.duplicate-of.json` markers (D-284) are under `raw/<sub>/` and go with it. |
| 6 | **Purge every version** | Every noncurrent version **and every delete marker** under each prefix, by `VersionId` — `raw/` again under the role. Enumeration is always the operator's: the role cannot list. Then the multipart-abort lifecycle rule is checked (it is infrastructure, `amplify/backend.ts`; the script does not set it). |
| — | **Delete the Cognito user** | `AdminDeleteUser`, after the data. `02` §8.5 orders it last and sign-out fails on a deleted user; keeping it until the end also means a failed run still has a (disabled) user to resume against. |
| 7 | **Logs** | Nothing. CloudWatch lines that mention the user expire under the 30-day retention. Do not hand-scrub log groups; the retention *is* the answer. |
| 8 | **Confirm in writing** | Printed and saved to `tmp/account-deletion/<sub>-<time>.md`: before/after counts, what could not be deleted (should be *Nothing.*), the guard evidence, and the PITR statement below. Send it to the requester. |

## Backups — say the true thing

There are no backups beyond S3 versioning (purged in step 6) and DynamoDB point-in-time recovery.
**PITR holds deleted rows for up to 35 days, so a deletion is complete at the end of the PITR window,
not the moment the script exits.** Say that to the requester rather than overstating it; the same
window is what would let a wrong-user deletion be undone, which is the correct trade at this scale.

As deployed (checked 2026-10-20), PITR is **enabled on `LostSolesExploredCell` only**; the other
tables have it off, so their rows are gone when the script exits. The confirmation reads each table's
PITR status live and states the window and its end date accordingly.

Also outside the script: operator one-off backups under `backup/` (e.g. `backup/0198/t6-before.json`,
a dump of T6 taken for ticket `0198`, when the owner was the only user). For any user who was present
when such a backup was taken, find and delete it by hand, and say so in the confirmation.

## If it fails

The run aborts at the failing step and prints why. Everything before that step is done, nothing after
it is. Fix the cause and **run it again** — every step is idempotent. If the Cognito user is already
gone (only possible if the very last destructive step succeeded), add `--resume`.

## A second account is Trigger A

Creating a second Cognito account — including a throwaway for testing this runbook — is **D-123
Trigger A** (`08` §2.4). For a test: **create → seed → run → delete, in one sitting**, and record the
whole sequence. An account left standing longer than the test opens the Trigger A gate, and `0114`
applies.

### Testing this runbook against a throwaway account

```sh
# 1. Create (Trigger A starts now). Self-signup is off, so the operator creates it.
aws cognito-idp admin-create-user --user-pool-id <pool> --username <throwaway-email> \
    --user-attributes Name=email,Value=<throwaway-email> Name=email_verified,Value=true --message-action SUPPRESS
# sub = the `sub` attribute in the response

# 2. Seed one genuinely ingested run (synthetic fixture geometry, real worker). Dry run first.
npx vite-node --config vitest.config.ts tools/account-deletion/seed-throwaway.ts -- --user <sub>
npx vite-node --config vitest.config.ts tools/account-deletion/seed-throwaway.ts -- --user <sub> --confirm
#    wait for the receipt to reach DONE; the preflight's before-counts must show raw objects,
#    ExploredCell rows, ledger rows and an Activity before you type the uid.

# 3. Run the deletion (above). 4. Paste the confirmation's tables into 16-rebuild-drill.md.
```
