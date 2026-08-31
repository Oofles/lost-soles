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
started: 2026-08-31T14:44:14Z
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

## Progress — 2026-08-30

**Evidence obtained, and it is decisive.** `get-access-key-last-used` on the 2022 key:

```
LastUsedDate: 2022-12-06T04:49:00+00:00
ServiceName:  s3
Region:       us-east-1
```

Created 2022-12-06T03:03:45. **Last used one hour and 46 minutes later, and never again** — 3 years,
8 months, 25 days dormant. This supersedes the 90-day CloudTrail window entirely and removes the
"absence of evidence" caveat: IAM's own record shows a key that was created, used once, and
abandoned.

**Decision: deactivate, then delete.** Deactivated 2026-08-30 (`--status Inactive`). The live
`devault` profile was verified working immediately after, and `cli-user` now shows one Active key
and one Inactive.

**Remaining: elapsed time, not work.** Delete after a 24-48h soak with nothing broken — due on or
after **2026-09-01**. Recorded as D-157.

## Progress — 2026-08-31

Re-verified during the 0013 session, as the pre-flight for making the repository public:
`list-access-keys` on `cli-user` shows `…WPBV` **Active** (created 2026-08-31) and `…EHYC`
**Inactive** (created 2022-12-06). The soak is holding and nothing has broken.

**Not closed: the delete is due on or after 2026-09-01** and today is 2026-08-31. Blocked on elapsed
time rather than work. Deletion is irreversible and the ticket's own criterion sets the date, so it
was not brought forward.

Noted while deciding whether to publish the repo: this ticket describes the weakness *and* its
remediation, so publishing it discloses a fixed problem, not a live one. That is a reasonable thing
to have in public. The two remaining criteria — whether `cli-user` should exist at all once Lost
Soles deploys, and the IAM Identity Center question — are untouched and still open.
