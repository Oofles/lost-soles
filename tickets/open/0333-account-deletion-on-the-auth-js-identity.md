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

- [ ] `tools/account-deletion/deletion.ts` makes no `cognito-idp` call, and its tests pass with no Cognito mock.
- [ ] A dry run against the owner uid without `--delete-owner` is refused with zero side effects
      (D-403), with a test.
- [ ] `08` §6.4 is rewritten step by step, and D-400's Cognito ordering is marked superseded in
      `DECISIONS.md` by a line pointing at D-473, without editing D-400's text.
- [ ] `16-rebuild-drill.md`'s account-deletion section gets a dated note that the Cognito steps it
      records were superseded by `0333`.

## Notes

`0106` ran the runbook once against a throwaway account. Re-running it end to end needs a second
identity, which is Trigger A territory. The dry-run and unit tests are the proof here. A real
second run waits for a real need.

## Operator validation

None for the operator. Agent: the script's test suite, and a dry run printed into the Resolution.

D-123 trigger checked? **A** (A-5, the deletion path) — D-470 re-affirms D-123. No account is
added.
