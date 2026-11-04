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
started: 2026-11-04T01:31:37Z
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

- [x] **Gate before deploy:** `npx ampx sandbox` synth, or `cdk diff` of the branch stack, shows
      **zero `Replacement` on any `AWS::DynamoDB::Table`** and no change to the storage bucket's
      `DeletionPolicy`/versioning. The diff excerpt is pasted into the Resolution. If any table would
      be replaced, **stop and ask**: that is a design finding, not something to work around.
      *(Done as a local synth of the branch assembly diffed against the deployed templates, not a
      sandbox: a sandbox deploys. The baseline synth of the unchanged tree matched the deployed
      templates exactly, so the diff is trustworthy. Every table and bucket is byte-identical.)*
- [ ] After deploy, `aws cognito-idp list-user-pools` shows no pool tagged `amplify:app-id =
      d14fhvl4rp79nn`. `aws appsync get-graphql-api` shows `AWS_IAM` as the only auth mode.
- [ ] `check-auth-posture.mjs --self-test` and `check-d123-trigger-a.mjs --self-test` pass, and both
      pass live in the Amplify build log. *(Both self-tests pass locally, and the live Trigger A check
      passes against production now. The live posture check passes only after this deploy: run
      against today's account it fails exactly the three assertions the deploy fixes. The build-log
      half is the orchestrator's, post-deploy.)*
- [ ] Σ ledger and `Profile.exploredGeneration` for the owner uid equal the values recorded in
      `0332`.
- [x] `0014` criterion 3 is annotated. `08` §5.1 and §2.4 Trigger A (wording and the "Enforced"
      paragraph) and `01` §1 Auth row and §2 resource-table rows 2–3 are amended to the as-built
      state, citing D-472/D-473/D-470. *(The doc half is done. `0014` is another ticket's file, which
      a wave agent may not edit (WAVES.md §3); the orchestrator appends `— superseded by
      D-175/D-473 at cutover (0334), <date>` to its criterion 3 and runs `tickets.mjs index`. Done by the orchestrator at the wave 19 merge, 2026-11-03.)*
- [ ] (operator) Signed in on the desktop browser after the deploy, the map, plinth and `/skills`
      load as before.

## Notes


**Blocked 2026-11-03 on 0339:** 0339 joins core's SSO (D-478) and rewrites middleware and the auth posture first; 0334 removes Cognito from what that leaves

`amplify_outputs.json` loses its `auth` block, and anything reading it structurally (the CSP builder,
the old posture check) must not assume the block exists. Grep before deploying.

Amplify may refuse to delete a pool that still has users. The pool has one, the owner. If the deploy
stalls on it, delete the user by hand with `admin-delete-user` and record it.

**2026-11-02, from `0331` (D-475):** remove the Lambdas' AppSync-event branch
(`amplify/functions/caller.ts`), and with it AppSync's resolver data-source
`lambda:InvokeFunction` grant on `log-workout` and `set-activity-kind`. After this ticket the SSR
compute role is the only invoker.

## Operator validation

Agent: the gate diff, the post-deploy AWS reads, the Σ comparison, and both checks green in the
build log. Operator: the one `(operator)` criterion.

D-123 trigger checked? **A** — Trigger A's enforcement is rewritten. D-470 re-affirms D-123.

## Resolution

**What shipped.** Cognito is gone from the app, and the data API answers nobody. One deploy carries
all of it, because the two deploy-gate checks would otherwise fail closed on a missing pool.

- **`defineAuth` deleted.** `amplify/auth/resource.ts` is removed, `auth` leaves `defineBackend`, and the
  `cfnUserPool`/`cfnUserPoolClient`/`cfnIdentityPool` L1 block (admin-only signup, Essentials, token
  validity, revocation) is gone from `amplify/backend.ts`. The pool has `DeletionProtection: INACTIVE`
  (read 2026-11-03), so CloudFormation deletes it with its one user. No hand `admin-delete-user` should be
  needed.
- **Data is IAM-only** (`amplify/data/resource.ts`). `defaultAuthorizationMode: "iam"`. Every model's
  `allow.owner()` and `Profile`'s five field rules are replaced by one rule,
  `allow.authenticated("identityPool").to(["read"])`, the minimal IAM rule Gen 2 accepts on a model (it
  refuses a model with no rule). `logWorkout` and `setActivityKind` are **deleted** with their four custom
  types: since `0331` nothing calls them. Their removal takes AppSync's Lambda data sources (the whole
  `FunctionDirectiveStack`) and with them AppSync's `lambda:InvokeFunction` on both Lambdas (D-475). The
  Lambdas keep `resourceGroupName: "data"`, so they are updated in place, not recreated.
- **Finding: the transformer grants `appsync:GraphQL` for any IAM model rule.** It emits a managed policy,
  `AuthRolePolicy01`, attached to the identity pool's authenticated role. With no `defineAuth` that role's
  name is the literal `"undefined"` (`ctx.synthParameters.authenticatedUserRoleName`), so the deploy would
  have failed on a role that does not exist (checked: `iam get-role --role-name undefined` is
  `NoSuchEntity`). `amplify/backend.ts` removes the policy before synth, matched by CloudFormation type
  because the data construct bundles its own aws-cdk-lib. That is also what makes "no principal is granted
  `appsync:GraphQL`" true. It is a new escape-hatch use, added to `01` §2 as item 8 (D-467). Proposed as
  D-480 (proposed as D-NEW-a, recorded at merge).
- **Storage:** the `access` block is removed; `versioned` and `keepOnDelete` stay. Removing it also drops
  Amplify's `/amplify/resource_reference/…/LOST_SOLES_USER_DATA_BUCKET_NAME` SSM parameter, which nothing
  reads (grepped).
- **`amplify/functions/caller.ts`:** the AppSync-event branch is removed (D-475). An event in AppSync's old
  shape has no top-level `userId`, so it reads as no user and the handlers refuse it; `caller.test.ts`
  pins that, with the owner's sub in `identity.sub`.
- **`scripts/check-auth-posture.mjs` rewritten** (D-175). It asserts: no Cognito user pool and no identity
  pool tagged `amplify:app-id=d14fhvl4rp79nn` (`ListUserPools`/`ListIdentityPools` plus
  `ListTagsForResource` per pool, so another app's pools pass); the data API, chosen by its `amplify:*` tags
  and `$AWS_BRANCH`, never by `amplify_outputs.json`, has auth modes exactly `["AWS_IAM"]`;
  `AUTH_ALLOWED_EMAILS` holds at least one address (counted, never printed); and Google is the only Auth.js
  provider, from a source scan: every `next-auth/providers/*` import is `google`, `lib/auth/config.ts`'s
  `providers` array is exactly `[Google(…)]`, and no other file sets `providers`. Every failure path exits
  1. The self-test has 16 cases, including an empty state that fires all five, plus the provider scan run
  over this repo. `amplify.yml` now runs `--self-test` before the live check, and `gate.yml` runs the
  self-test.
- **`scripts/check-d123-trigger-a.mjs` rewritten** (D-470, D-479). It reads `OWNER_USER_IDS` and
  `IDENTITIES` from `lib/auth/owner-ids.ts` (comments stripped; one unparseable entry makes the whole map
  unreadable, which fails closed) and the live allowlist from
  `/amplify/shared/d14fhvl4rp79nn/AUTH_ALLOWED_EMAILS`, parsed exactly as `config.ts` does. It fires on:
  an entry mapping to a uid that is neither an owner nor admitted by a D-123-naming decision in
  `APPROVED_ACCOUNTS` (now `{ uid, decision }`); an allowlisted email with no map entry; a mapped email
  off the allowlist; a non-lower-case key; no entry on the owner uid; and an empty map, allowlist or owner
  list. Two addresses on the owner uid pass (D-479). Output and every failure string hold counts and uids
  only. The self-test proves that: every fixture address contains `@` and a case fails if any failure
  string does. 22 cases.
- **Tests.** `amplify/data-iam-only.test.ts` (new) synthesizes the whole assembly and reads every template:
  no `AWS::Cognito::*`; one GraphQL API with `AuthenticationType: AWS_IAM` and no additional provider or
  user pool; no IAM statement granting `appsync:GraphQL`, `appsync:*` or `*`; no `"undefined"` anywhere;
  no AppSync `AWS_LAMBDA` data source; no `cognito-identity.amazonaws.com` condition. The SDL tests in
  `log-workout-mutation`, `set-activity-kind-mutation`, `profile-model`, `xp-ledger-tables` and
  `source-account-store` are moved to the new shape. The I-20 "measured work only" guard now lives in
  `app/api/log/route.test.ts`, which already pins that the route drops every field the mutation never had.
- **`amplify_outputs.example.json`** loses its `auth` block, and its `data.default_authorization_type` is
  now `AWS_IAM`, matching what the deploy writes. Grepped before this: nothing reads `auth` structurally
  (the CSP stopped in `0332`, and `lib/security-headers.test.ts` still proves it would ignore one).
- **Package removal:** `aws-amplify`, `@aws-amplify/ui-react` and `@aws-amplify/adapter-nextjs` already
  left `package.json` in `0332`. Nothing to do.
- **Docs, as built:** `08` §5.1 opens with an as-built note (no Cognito, the allowlist and map as the two
  lines, IAM-only data, the rewritten gate) and keeps the Cognito design below it for its reasoning. `08`
  §2.4 Trigger A's "Fires when" and "Enforced" are rewritten. A-1's mechanism clause no longer says
  "owner auth" for the `defineData` models, because no client reaches them. `01` §1's Auth and data rows,
  §2 rows 2–4 and 22–23, the post-table note, and escape-hatch item 8 are updated.
  `19-authjs-migration.md` gains an as-built note: the two findings, and the build role's new grants.
  `lib/auth/owner-ids.ts` says the uid is the deleted pool's `sub`, frozen.

**Gate diff (criterion 1).** A local synth of the branch assembly (`amplify-backend-type: branch`, name
`main`, namespace `d14fhvl4rp79nn`; no deploy), diffed resource by resource against
`aws cloudformation get-template` for all 18 deployed stacks. **Calibration:** the unchanged tree's synth
differs from what is deployed only by `AWS::CDK::Metadata`, so the comparison is apples to apples. After
the change, every table and bucket's properties and `DeletionPolicy`/`UpdateReplacePolicy` are identical:

```
Custom::AmplifyDynamoDBTable   ActivityTable / ProfileTable / SkillStateTable / XpLedgerEntryTable /
                               LandmarkTable / DeploySmokeTestTable          props identical, policy identical (Delete)
AWS::DynamoDB::Table           ExploredCellTable / IngestReceiptTable / SourceAccountTable
                                                                             props identical, policy identical (Retain)
AWS::DynamoDB::Table           CaptureGuardTable / OAuthStateTable           props identical, policy identical (Delete)
AWS::S3::Bucket                lostSolesUserDataBucket5F583CC2               props identical, policy identical (Retain),
                                                                             versioning {"Status": "Enabled"}
```

Every structural change in the diff (`-` removed, `~` modified in place):

```
root:     - auth179371D7 AWS::CloudFormation::Stack           (the user pool, client, identity pool, 2 roles)
data:     - amplifyDataFunctionDirectiveStack… Stack           (AppSync's two Lambda data sources + roles)
          ~ amplifyDataGraphQLAPI42A6FA33 AWS::AppSync::GraphQLApi
              AuthenticationType: AMAZON_COGNITO_USER_POOLS -> AWS_IAM
              AdditionalAuthenticationProviders: [{AWS_IAM}] -> (none)
              UserPoolConfig: {…UserPoolId…} -> (none)
          ~ logworkoutlambda / setactivitykindlambda: Code only  (caller.ts)
per model (Activity, Profile, SkillState, XpLedgerEntry, Landmark, DeploySmokeTest):
          - <Model>OwnerDataResolverFn… AppSync::FunctionConfiguration, - <Model>ownerResolver AppSync::Resolver
          ~ resolver mapping templates (the auth checks)
storage:  - LOSTSOLESUSERDATABUCKETNAMEParameter AWS::SSM::Parameter
          - …storageAccess… AWS::IAM::Policy                  (users/${cognito-identity…:sub}/* on the auth role)
```

The `GraphQLApi`'s three changed properties are all "update requires: no interruption" in CloudFormation,
so the API, its id and so every model table's name (`<Model>-<apiId>-NONE`) are kept. The nested model
stacks keep their logical ids, so they update in place. The diff against the deployed templates also shows
two pre-existing differences this ticket did not cause (absent from a synth-vs-synth diff of before and
after): `AlarmName` on `IngestDlqNotEmpty` and `ReconcileSweepRecovering`, `AlarmName`/`AlarmDescription`
on `WebhookOwnerFlood`, and `Description` on `ArchiveDeletionRole`. Recorded, not chased.

**Decisions made here.** The `AuthRolePolicy01` removal (D-480, proposed as D-NEW-a). Deleting the mutations is D-481. Deleting the two mutations
rather than giving them an IAM rule: the ticket asked that they lose their exposure, and the only way to
keep them would be to keep a resolver nobody may call. `DeploySmokeTest` stays, because removing a model
deletes its table. All six models are read-only, including the three that allowed writes, because nothing
may call them and read-only is the safer default if a grant ever appears.

**Why.** D-472: AppSync stopped being client-facing in `0331`, so its user-pool auth was a door to a room
nobody uses, and the pool behind it is D-473's to delete. D-175 requires the posture check to follow
the posture, not be deleted. D-470 moves Trigger A from "a second Cognito user" to "a second identity on
the allowlist or the map".

