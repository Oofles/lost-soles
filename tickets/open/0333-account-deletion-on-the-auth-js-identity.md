---
id: 333
slug: account-deletion-on-the-auth-js-identity
title: Account deletion on the Auth.js identity
type: feature
priority: med
status: open
size: s
capability: 19-authjs-migration
depends_on: [332]
blocked_by: []
source: agent
created: 2026-11-02T17:18:06Z
started: 2026-11-03T18:16:17Z
---


## Description

Capability `19-authjs-migration`. Design: `docs/capabilities/19-authjs-migration.md` §"What happens to
the named artifacts". Decisions: **D-473**, **D-470**. Supersedes the Cognito half of **D-400**.
**D-403** stands.

Account deletion (`tools/account-deletion/`, `08` §6.4, ticket `0106`) disables the Cognito user, signs it out globally, deletes
the data, and deletes the Cognito user last (D-400). After cutover there is no Cognito user. The
identity is an email in `AUTH_ALLOWED_EMAILS` (SSM) plus an `IDENTITIES` entry (source).

- Step 3 becomes: **remove the email from `AUTH_ALLOWED_EMAILS` in SSM, then redeploy.** The next
  request from any session for that email is signed out, because `authorized` re-checks the
  allowlist on every request. That is the new disable and global sign-out.
- The last step becomes: **remove the `IDENTITIES` entry** in a commit. It is last for D-400's
  reason: a failed run must stay resumable against an identity that still maps.
- `--delete-owner` and the typed uid stay exactly as D-403 has them.
- The script's Cognito calls are removed. It prints the two manual steps, because one is an SSM write
  plus a deploy and the other is a commit, and neither belongs inside a delete script.

## Acceptance criteria

- [x] `tools/account-deletion/deletion.ts` makes no `cognito-idp` call, and its tests pass with no Cognito mock.
- [x] A dry run against the owner uid without `--delete-owner` is refused with zero side effects
      (D-403), with a test.
- [ ] `08` §6.4 is rewritten step by step, and D-400's Cognito ordering is marked superseded in
      `DECISIONS.md` by a line pointing at D-473, without editing D-400's text.
      *Half done (agent, wave): §6.4 is rewritten (steps 3 and 6c). The `DECISIONS.md` line is not
      added, because WAVES.md §3 forbids agents to edit it; the exact line is in the wave report for
      the orchestrator to apply at merge.*
- [x] `16-rebuild-drill.md`'s account-deletion section gets a dated note that the Cognito steps it
      records were superseded by `0333`.

## Notes

`0106` ran the runbook once against a throwaway account. Re-running it end to end needs a second
identity, which is Trigger A territory. The dry-run and unit tests are the proof here. A real
second run waits for a real need.

## Operator validation

None for the operator. Agent: the script's test suite, and a dry run printed into the Resolution.

D-123 trigger checked? **A** (A-5, the deletion path) — D-470 re-affirms D-123. No account is
added.

## Resolution

**Files touched**

- `tools/account-deletion/deletion.ts` — every Cognito call removed (`list-users` preflight,
  `admin-disable-user`, `admin-user-global-sign-out`, `admin-delete-user`) and `userPoolId` dropped
  from `DeletionEnv`. New: `identityEmails` (the emails `IDENTITIES` maps to the uid, never printed),
  `ALLOWLIST_PARAMETER` (`/amplify/shared/d14fhvl4rp79nn/AUTH_ALLOWED_EMAILS`, the name
  `scripts/write-authjs-env.mjs` reads), `signOutStep`/`unmapStep` (the two printed manual steps),
  `SignOutNotConfirmed`. `DeletionResult.cognitoUsername` became `mappedEmails` (a count) plus
  `manualStepsLeft`; the confirmation gains a *Still to do, by hand* section.
- `tools/account-deletion/delete-account.ts` — reads only `storage` from `amplify_outputs.json`
  (no `auth.user_pool_id`, which `0334` removes), passes the `IDENTITIES` emails for the uid.
- `tools/account-deletion/deletion.test.ts` — the fake CLI's Cognito cases are deleted, so any
  `cognito-idp` call now throws "unexpected"; new tests: the owner dry run (zero side effects, no
  AWS call, no prompt), step-3 ordering and wording, a step-3 answer other than `done`, an unmapped
  uid with and without `--resume`, and a source grep for `cognito-idp`/`client-cognito`/pool ids.
- `docs/08-security-privacy.md` §6.4 — step 3 rewritten, step 6c added; §6.1's retention table
  gains an identity row (the Cognito row is left for `0334`).
- `docs/runbooks/account-deletion.md` — the how-to follows §6.4; the throwaway-account recipe is
  marked superseded (it creates a Cognito user).
- `docs/capabilities/16-rebuild-drill.md` — dated note that `0106`'s Cognito steps are superseded.

**How it runs now.** Order is unchanged except for who does steps 3 and 3c:
1 revoke → 2 `SourceAccount` → **3 printed, the run waits for `done`** → 4 DynamoDB → 5 S3 →
6 versions → 6b lifecycle check → **3c printed** → 7 → 8. The run waits at step 3 because §6.4's
reason for step 3 sitting before the data deletes ("sessions stop now, while the slower deletes
run") only holds if the deletes wait for the gate. Anything other than `done` aborts after step 2,
which is idempotent to re-run. The `IDENTITIES` entry is last for D-400's reason, so a failed run
re-runs as-is against a uid that still maps; `--resume` now means "IDENTITIES no longer maps it".
`--delete-owner` and the typed uid are untouched (D-403).

**Decisions.** None new beyond the superseding line proposed for `DECISIONS.md` (orchestrator).
Emails are never printed by the script (in keeping with D-426's counts-and-uids rule): the steps
name the uid, and the operator finds the line by it. D-476's `ls-uid` cookie and IndexedDB stores
are noted in §6.4 as out of scope, as instructed.

**Dry runs, live, read-only, 2026-11-03, `AWS_PROFILE=devault`, from the worktree:**

```
$ delete-account.ts -- --user 5488e4b8-d081-7014-748e-edd1937f8083 < /dev/null
5488e4b8-d081-7014-748e-edd1937f8083 is in OWNER_USER_IDS. Deleting the owner needs --delete-owner as well as the typed uid. Nothing was changed.
exit=3

$ delete-account.ts -- --user 00000000-0000-4000-8000-000000000333 < /dev/null
ABORTED: IDENTITIES maps no email to 00000000-0000-4000-8000-000000000333. (A re-run after its entry was removed takes --resume.)
exit=1

$ delete-account.ts -- --user 00000000-0000-4000-8000-000000000333 --resume < /dev/null
uid 00000000-0000-4000-8000-000000000333, unmapped in IDENTITIES (resume)
before: {"tables":{"SourceAccount":0,"ExploredCell":0,"Activity":0,"XpLedgerEntry":0,"SkillState":0,"Landmark":0,"Profile":0,"IngestReceipt":0,"OAuthState":0},"prefixes":[... all 0 ...]}
guard: {"caller":"arn:aws:iam::286588821906:user/cli-user","callerDecisions":{"s3:DeleteObject":"explicitDeny","s3:DeleteObjectVersion":"explicitDeny"},"breakGlassDecisions":{"s3:DeleteObject":"allowed","s3:DeleteObjectVersion":"allowed"}}
Type the uid to delete 00000000-0000-4000-8000-000000000333 and everything it owns:
```

The third run is the whole read-only preflight against live AWS with no Cognito pool consulted:
inventory, IAM simulation against the live bucket policy, then the prompt; stdin was closed, so
nothing was written. (It exited 0 rather than 3 there: `readline.question` on a closed stdin never
settles, so the process just drains. That is `0106`'s behaviour, unchanged here, and harmless:
nothing after the prompt runs.)

**Not done here.** `tools/account-deletion/seed-throwaway.ts` still calls `cognito-idp list-users`
to check its throwaway exists. It is not the deletion script and seeds only a throwaway Cognito
account, which no longer signs in to anything; it is left for `0334`, which removes the pool.

