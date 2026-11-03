---
id: 337
slug: seed-throwaway-still-calls-cognito
title: seed-throwaway.ts still calls cognito-idp list-users against the pool 0334 deletes
type: chore
priority: low
status: open
size: s
capability: 19-authjs-migration
depends_on: []
blocked_by: []
source: agent
created: 2026-11-03T18:26:02Z
started: 2026-11-03T18:50:51Z
---

## Description

Found by `0333`'s agent. `tools/account-deletion/seed-throwaway.ts:71` checks that its throwaway account exists with `aws cognito-idp list-users --user-pool-id <pool>`, reading the pool id from `amplify_outputs.json`. `0334` deletes the pool and the `auth` block, so after `0334` this script fails on its precondition, or fails to parse its config.

After the cutover (D-473), an identity is an `AUTH_ALLOWED_EMAILS` entry plus an `IDENTITIES` entry (D-471). The seed tool's precondition becomes "the uid maps in `IDENTITIES` and is not in `OWNER_USER_IDS`". Seeding a throwaway identity at all needs a second allowlisted email, which is **Trigger A** (`08` §2.4). This ticket only removes the Cognito dependency. It does not create a second identity, and running the seed for real still waits for a real need (`0333` Notes).

## Acceptance criteria

- [x] `tools/account-deletion/seed-throwaway.ts` makes no `cognito-idp` call and does not read
      `auth.*` from `amplify_outputs.json`. A source-grep test pins both.
- [x] Its precondition is that the uid maps in `IDENTITIES` and is not in `OWNER_USER_IDS`. Both
      refusals are tested, and both exit nonzero with nothing written.
- [x] `docs/runbooks/account-deletion.md`'s superseded throwaway recipe names the new precondition,
      and says that creating the throwaway identity is Trigger A.

## Notes

Best landed before or with `0334`, which deletes the pool. It is unordered because nothing breaks
until someone runs the seed, and nobody will before a real second-identity need exists.

## Operator validation

None for the operator. Agent: the unit tests, and a dry run with an unmapped uid that is refused.

D-123 trigger checked? **A** (A-5, the deletion path's tooling). D-470 re-affirms D-123 for the Auth.js move. No account is added, and none is created by this ticket.

## Resolution

**What changed.** `seed-throwaway.ts` no longer shells out to `aws cognito-idp list-users` and no
longer reads `auth.user_pool_id` from `amplify_outputs.json`, so it survives `0334` deleting the pool
and the `auth` block. Its identity precondition is now `seedRefusal(uid, IDENTITIES, OWNER_USER_IDS)`:
refuse the owner, refuse a uid `IDENTITIES` maps no email to, else proceed (D-471, D-473). The check
was moved to the top of the script, ahead of reading `amplify_outputs.json` and constructing any AWS
client, so a refusal cannot write anything. The fresh-account check (no `raw/` archive, no `Activity`)
is unchanged.

**Files.**
- `tools/account-deletion/deletion.ts`: two exported pure helpers, `emailsMappedTo(uid, identities)`
  (the `IDENTITIES` reverse lookup `delete-account.ts` had inline) and `seedRefusal`. They take the
  map as a parameter, so `deletion.ts` still imports nothing from `lib/auth`.
- `tools/account-deletion/delete-account.ts`: uses `emailsMappedTo` in place of its inline filter.
  Behaviour is the same.
- `tools/account-deletion/seed-throwaway.ts`: Cognito call and `auth` read removed. Precondition is
  `seedRefusal`, run first. Header comment updated (uid, not Cognito sub).
- `tools/account-deletion/seed-throwaway.test.ts` (new): `seedRefusal`'s three outcomes; a check that
  the real `IDENTITIES` maps only owner uids (a second entry is Trigger A); a source-grep pinning no
  `cognito-idp`/`list-users`/`user_pool_id` and no `auth.`/`auth?.`/`auth:` in the script; and the
  real script run as a `vite-node` subprocess with no AWS credentials reachable, once with the owner's
  uid and once with an unmapped uid, both with `--confirm`. Each exits 2 with the refusal on stderr and
  none of the plan or write lines on stdout.
- `docs/runbooks/account-deletion.md`: the superseded throwaway section names the new precondition
  and says that creating the throwaway identity (an `AUTH_ALLOWED_EMAILS` email plus an `IDENTITIES`
  entry) is D-123 Trigger A.

**Decisions.** None new. The owner refusal is checked before the mapping check, because the owner is
mapped and its refusal is the more specific message. Neither path writes anything.

**Not done, by design.** No identity, allowlist entry or Cognito user was created. Running the seed
for real still waits for a real second-identity need, which is Trigger A (`0333` Notes).

## Operator validation

None for the operator. Agent, on the desktop (WSL), `AWS_PROFILE=devault`:
- `npx vite-node --config vitest.config.ts tools/account-deletion/seed-throwaway.ts -- --user 00000000-0000-4000-8000-000000000337`
  printed `refusing: IDENTITIES (lib/auth/owner-ids.ts) maps no email to … Trigger A …`, exit 2.
- The same with the owner's uid printed `refusing: that uid is in OWNER_USER_IDS …`, exit 2.
- `npx vitest run tools/account-deletion`: 28 passed, including both subprocess refusals.
