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

- [ ] `tools/account-deletion/seed-throwaway.ts` makes no `cognito-idp` call and does not read
      `auth.*` from `amplify_outputs.json`. A source-grep test pins both.
- [ ] Its precondition is that the uid maps in `IDENTITIES` and is not in `OWNER_USER_IDS`. Both
      refusals are tested, and both exit nonzero with nothing written.
- [ ] `docs/runbooks/account-deletion.md`'s superseded throwaway recipe names the new precondition,
      and says that creating the throwaway identity is Trigger A.

## Notes

Best landed before or with `0334`, which deletes the pool. It is unordered because nothing breaks
until someone runs the seed, and nobody will before a real second-identity need exists.

## Operator validation

None for the operator. Agent: the unit tests, and a dry run with an unmapped uid that is refused.

D-123 trigger checked? **A** (A-5, the deletion path's tooling). D-470 re-affirms D-123 for the Auth.js move. No account is added, and none is created by this ticket.
