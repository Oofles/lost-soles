---
id: 334
slug: cognito-removed-defineauth-deleted-iam-only-data-posture-and
title: Cognito removed: defineAuth deleted, IAM-only data, posture and Trigger A checks rewritten
type: feature
priority: med
status: open
size: m
capability: 19-authjs-migration
depends_on: [332, 333]
blocked_by: []
source: agent
created: 2026-11-02T17:18:06Z
---


## Description

Capability `19-authjs-migration`, cutover step 6. Design: `docs/capabilities/19-authjs-migration.md`
§"Architectural impact", §"Data model changes", §"What happens to the named artifacts". Decisions:
**D-472** (IAM-only data), **D-473** (the pool is deleted at cutover), **D-470** (Trigger A
restated). D-175 requires the posture check to be rewritten, never deleted.

**Everything below ships in ONE deploy.** `check-auth-posture.mjs` and `check-d123-trigger-a.mjs` run
in `amplify.yml`'s backend phase and fail closed on a missing pool. If they lag the deletion, the
deploy that deletes the pool fails.

- `amplify/auth/resource.ts` and `defineAuth` are deleted. So is the `cfnUserPool*`/`cfnIdentityPool`
  block in `amplify/backend.ts` (lines ~139–220: admin-only signup, Essentials, token validity,
  revocation).
- `amplify/data/resource.ts`: `defaultAuthorizationMode: "iam"`. Every `allow.owner()` and the field
  rules on `Profile` are replaced with the minimal IAM-only rule the Gen 2 generator accepts.
  `logWorkout`/`setActivityKind` lose their AppSync `allow.authenticated()` exposure (`0331` moved
  their callers). **No principal is granted `appsync:GraphQL`.**
- `amplify/storage/resource.ts`: the `access` block is removed. `versioned` and `keepOnDelete` stay.
- `scripts/check-auth-posture.mjs` is **rewritten** to the design's assertions: no Cognito user or
  identity pool tagged with this app's `amplify:app-id`; the AppSync API's auth modes are exactly
  `AWS_IAM`; `AUTH_ALLOWED_EMAILS` in SSM is non-empty; Google is the only provider. `--self-test`
  proves each fires.
- `scripts/check-d123-trigger-a.mjs` is **rewritten** (D-470): it reads `IDENTITIES` from source and
  `AUTH_ALLOWED_EMAILS` from SSM. It fails on any non-owner entry outside `APPROVED_ACCOUNTS`, and on
  an allowlist and map that disagree. It prints counts and uids, never emails. The build role's
  hand-managed `LostSolesAuthPostureCheckReadOnly` swaps `ListUsersForD123TriggerA` and the Cognito
  describe statements for `ssm:GetParameter` on the one parameter, **before** this deploy (D-426's
  ordering).
- `aws-amplify`, `@aws-amplify/ui-react` and `@aws-amplify/adapter-nextjs` leave `package.json` if
  nothing still imports them.
- `0014`'s criterion 3 gets `— superseded by D-175/D-473 at cutover (0334), YYYY-MM-DD` appended. The
  ticket is closed, so that is a body edit plus `tickets.mjs index`.

## Acceptance criteria

- [ ] **Gate before deploy:** `npx ampx sandbox` synth, or `cdk diff` of the branch stack, shows
      **zero `Replacement` on any `AWS::DynamoDB::Table`** and no change to the storage bucket's
      `DeletionPolicy`/versioning. The diff excerpt is pasted into the Resolution. If any table would
      be replaced, **stop and ask**: that is a design finding, not something to work around.
- [ ] After deploy, `aws cognito-idp list-user-pools` shows no pool tagged `amplify:app-id =
      d14fhvl4rp79nn`. `aws appsync get-graphql-api` shows `AWS_IAM` as the only auth mode.
- [ ] `check-auth-posture.mjs --self-test` and `check-d123-trigger-a.mjs --self-test` pass, and both
      pass live in the Amplify build log.
- [ ] Σ ledger and `Profile.exploredGeneration` for the owner uid equal the values recorded in
      `0332`.
- [ ] `0014` criterion 3 is annotated. `08` §5.1 and §2.4 Trigger A (wording and the "Enforced"
      paragraph) and `01` §1 Auth row and §2 resource-table rows 2–3 are amended to the as-built
      state, citing D-472/D-473/D-470.
- [ ] (operator) Signed in on the desktop browser after the deploy, the map, plinth and `/skills`
      load as before.

## Notes

`amplify_outputs.json` loses its `auth` block, and anything reading it structurally (the CSP builder,
the old posture check) must not assume the block exists. Grep before deploying.

Amplify may refuse to delete a pool that still has users. The pool has one, the owner. If the deploy
stalls on it, delete the user by hand with `admin-delete-user` and record it.

## Operator validation

Agent: the gate diff, the post-deploy AWS reads, the Σ comparison, and both checks green in the
build log. Operator: the one `(operator)` criterion.

D-123 trigger checked? **A** — Trigger A's enforcement is rewritten. D-470 re-affirms D-123.
