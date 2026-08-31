---
id: 122
slug: dormant-2022-iam-access-key
title: Deactivate the dormant 2022 access key on cli-user, or document why it stays
type: chore
priority: med
status: open
size: s
capability: 00-preflight-and-repo
depends_on: [2]
blocked_by: []
source: agent
created: 2026-08-30T00:00:00Z
---

## Description

Found while executing 0002 on 2026-08-30. **Not part of O-005** — a separate finding, filed rather
than fixed because acting on it was outside 0002's scope (D-152).

`cli-user` in account `286588821906` carries **two active access keys**:

| Key | Created | Status | Notes |
|---|---|---|---|
| `AKIAUFOQ…WPBV` | 2026-08-31 | Active | The new key. In `~/.aws/credentials`, profile `devault`. Keep. |
| `AKIAUFOQ…EHYC` | 2022-12-06 | **Active** | Unaccounted for. Not the O-005 key, not the profile key. |

The 2022 key is **~3 years 9 months old** and shows **zero CloudTrail events in the 90-day
lookback window**. A long-lived credential that nothing appears to use is the cheapest possible
security win: no rotation plan, no consumer to migrate, nothing to coordinate. It is also the exact
shape of credential that gets forgotten and then found by someone else.

Two caveats that stop this from being an obvious delete:

- **CloudTrail's default retention is 90 days.** "No events in 90 days" is not "never used" — a
  quarterly job, an annual renewal script, or a rarely-run deploy would not appear. This is absence
  of evidence.
- IAM's own `AccessKeyLastUsed` covers a longer window than CloudTrail's event history and should
  be checked before deciding — it is one call and it settles the question properly.

AWS's own guidance is that a key unused for 90 days should be removed, and this one predates the
account's current architecture entirely.

## Acceptance criteria

- [ ] `get-access-key-last-used` is run against the 2022 key and its `LastUsedDate` recorded.
      This supersedes the CloudTrail window and is the deciding evidence. Get the full id from
      `aws iam list-access-keys --profile devault` — it is deliberately **not written out here**,
      because the pre-commit hook (0004) rejects a full key id in a tracked file and it is right
      to. Identify it by its suffix `…EHYC` and its 2022-12-06 creation date.

      ```
      ID=$(aws iam list-access-keys --profile devault \
            --query "AccessKeyMetadata[?ends_with(AccessKeyId,'EHYC')].AccessKeyId" --output text)
      aws iam get-access-key-last-used --access-key-id "$ID" --profile devault
      ```
- [ ] A decision is made and written down, one of:
      - **Deactivate** (`--status Inactive`), soak 24-48h, then delete. Preferred if last-used is
        absent or old.
      - **Keep**, with the consumer named explicitly and a rotation date set. "Might be used by
        something" is not a reason to keep it; naming the something is.
- [ ] If deactivated: nothing breaks over the soak, then the key is deleted and
      `aws iam list-access-keys` shows exactly **one** key on `cli-user`.
- [ ] The outcome is recorded in `docs/capabilities/00-preflight-and-repo.md`.
- [ ] Consider whether `cli-user` should exist at all once Lost Soles deploys — an IAM Identity
      Center session would remove the standing-key question permanently rather than answering it
      once. Record the decision either way.

## Notes

In scope for Lost Soles despite being an account-level concern: this is the account the app will
deploy into, and a forgotten standing credential there is a risk to it. 0002 was described as the
only out-of-repo ticket; this is the second, for the same reason and no more.

Deactivate before delete. Deactivation is reversible in one click; deletion is not, and the
reversal path for a wrongly-deleted key is "create a new one and update every consumer you did not
know existed".

## Operator validation

In the IAM console → Users → `cli-user` → Security credentials, confirm the key list matches the
decision recorded above. If the decision was to remove it, exactly one key is listed and its ID
ends `WPBV`.
