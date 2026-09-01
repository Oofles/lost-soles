---
id: 122
slug: dormant-2022-iam-access-key
title: Deactivate the dormant 2022 access key on cli-user, or document why it stays
type: chore
priority: med
status: closed
size: s
capability: 00-preflight-and-repo
depends_on: [2]
blocked_by: []
source: agent
created: 2026-08-30T00:00:00Z
started: 2026-08-31T14:44:14Z
closed: 2026-09-01T03:31:17Z
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

- [x] `get-access-key-last-used` is run against the 2022 key and its `LastUsedDate` recorded.
      This supersedes the CloudTrail window and is the deciding evidence. Get the full id from
      `aws iam list-access-keys --profile devault` — it is deliberately **not written out here**,
      because the pre-commit hook (0004) rejects a full key id in a tracked file and it is right
      to. Identify it by its suffix `…EHYC` and its 2022-12-06 creation date.

      ```
      ID=$(aws iam list-access-keys --profile devault \
            --query "AccessKeyMetadata[?ends_with(AccessKeyId,'EHYC')].AccessKeyId" --output text)
      aws iam get-access-key-last-used --access-key-id "$ID" --profile devault
      ```
- [x] A decision is made and written down, one of:
      - **Deactivate** (`--status Inactive`), soak 24-48h, then delete. Preferred if last-used is
        absent or old.
      - **Keep**, with the consumer named explicitly and a rotation date set. "Might be used by
        something" is not a reason to keep it; naming the something is.
- [x] If deactivated: nothing breaks over the soak, then the key is deleted and
      `aws iam list-access-keys` shows exactly **one** key on `cli-user`.
- [x] The outcome is recorded in `docs/capabilities/00-preflight-and-repo.md`.
- [x] Consider whether `cli-user` should exist at all once Lost Soles deploys — an IAM Identity
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

## Resolution

**The 2022 key is deleted. `cli-user` carries exactly one access key.**

Closed 2026-09-01, two days after the deactivation, which is what the ticket's own criterion
asked for. Nothing about this ticket was hard; the discipline was in not rushing it.

### What was done

| Step | When | Result |
|---|---|---|
| `get-access-key-last-used` on `…EHYC` | 2026-08-30 | `2022-12-06T04:49Z`, s3, us-east-1 |
| Deactivate (`--status Inactive`) | 2026-08-30 | Reversible. `devault` verified working after |
| Soak | 2026-08-30 → 09-01 | ~48h. Nothing broke. Re-verified mid-soak during the 0013 session |
| Re-check last-used **at the moment of delete** | 2026-09-01 | **Still `2022-12-06`** — unchanged |
| `delete-access-key` | 2026-09-01 | Irreversible. Done |
| Verify | 2026-09-01 | One key (`…WPBV`, Active); `sts get-caller-identity` still resolves |

### Decisions and rationale

- **`AccessKeyLastUsed` settled what CloudTrail could not.** The ticket flagged the 90-day
  retention window as making "no events" mean "absence of evidence". IAM's own record showed the
  key was created 2022-12-06T03:03, used once at 04:49 against s3, and never again — **106 minutes
  of life, then 3 years 8 months 25 days of nothing.** That is evidence of absence, and it is why
  no hunt for consumers was needed. One API call replaced a speculative investigation.
- **The soak earned its place, and the re-check is the reason.** Running
  `get-access-key-last-used` again immediately before deleting turned the soak from a superstition
  into a measurement: if anything had been quietly depending on the key, deactivation would have
  produced a failure or a fresh `LastUsedDate`. It produced neither. Without that second call the
  soak would only have proved "the operator did not notice a problem", which is much weaker.
- **`cli-user` stays; IAM Identity Center declined → D-168.** Operator-directed. Short-lived
  credentials are genuinely better, but the ceremony (SSO setup, `aws sso login` before every
  deploy) is permanent and the account has one human, one workstation and a ~$3/mo budget. The
  decision records the three conditions that should reverse it — a second human, CI outside GitHub
  Actions, or the key needing to live off that workstation — and a **rotation date of 2027-08-31**,
  written down precisely because an unwritten rotation date is how the 2022 key happened.
- **Framed as hygiene, not architecture.** The dormant key existed because nobody ever ran
  `list-access-keys`, not because standing keys are unworkable. D-168 keeps the standing key **on
  the condition that it stays singular**: a second key appearing on `cli-user` is itself the alarm.

### Files touched

- `docs/capabilities/00-preflight-and-repo.md` — new **Standing credentials** section with the
  evidence table and the post-delete verification; the close-audit **Verdict** updated to mark its
  one carry-forward closed. Capability `00` now has no open tickets.
- `docs/decisions/DECISIONS.md` — **D-168**.
- This ticket. No code changed — 0122 is account-level, the second and last out-of-repo ticket.

### What went wrong / worth recording

- **Nothing broke, but the ticket was nearly closed a day early.** During the 0013 session on
  08-31 the state looked finished — one Active key, one Inactive, soak holding — and the only thing
  stopping a close was the ticket having written its own delete date down. A criterion with a date
  in it is what made "it looks fine" insufficient. Worth keeping as a pattern for irreversible
  steps.
- **The key id could not be written in the ticket.** 0004's pre-commit hook rejects a full AWS key
  id in a tracked file, and 0122 was one of the two files it caught on the project's first commit.
  Both the ticket and the new capability-doc section therefore identify keys by **suffix only**
  (`…EHYC`, `…WPBV`) and recover the full id at runtime via `--query ends_with(...)`. The guard
  shaped how its own remediation had to be documented, which is the right way round.

## Operator validation

Performed 2026-09-01 by the agent against the live account `286588821906` (profile `devault`),
from the WSL2 workstation shell — this is infrastructure with no UI surface, so there is no screen
or device to name for the work itself.

```
$ aws iam list-access-keys --profile devault
…WPBV   2026-08-31T01:50:32+00:00   Active   cli-user     # exactly one key, and it is the live one

$ aws sts get-caller-identity --profile devault
arn:aws:iam::286588821906:user/cli-user                    # the profile still authenticates
```

**★ Still to be confirmed by the operator, in a browser:** IAM console → Users → `cli-user` →
Security credentials. Exactly **one** access key should be listed, Active, ending `WPBV`, created
2026-08-31. No Inactive key should remain. This is the check the ticket asked for and the console
is the independent view — the CLI reading its own credential's account is the less convincing of
the two.
