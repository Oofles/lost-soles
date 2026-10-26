---
id: 304
slug: make-the-user-data-bucket-s-public-access-block-explicit-in
title: Make the user-data bucket's public-access block explicit in IaC
type: chore
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:43Z
started: 2026-10-26T13:42:13Z
---

## Description

The user-data bucket (`users/`, `raw/`, `snapshots/`) blocks all public access only because S3 does that by default. The synthesized template sets no `PublicAccessBlockConfiguration`, so `amplify/explored-set-not-public.test.ts` (0114, C-4) can only assert that the template never weakens it, not that it pins it. Found by the 0114 agent, wave 18.1.

## Acceptance criteria

- [x] The bucket's construct sets `blockPublicAccess: BLOCK_ALL` explicitly; the synthesized template carries all four settings `true`. *(Amended: `defineStorage` has no `blockPublicAccess` option and the L2 `Bucket` is built inside Amplify, so `BLOCK_ALL` is set as its four flags on the L1 `cfnBucket.publicAccessBlockConfiguration`, the same override the 0106 lifecycle rule uses. The template outcome is the one this criterion asks for.)*
- [x] `explored-set-not-public.test.ts` asserts the explicit block, and fails if it is removed.
- [x] The deployed bucket still reports all four settings `true` after deploy (read-only `get-public-access-block`).

## Notes

This changes infra on the bucket that holds `raw/`, the system of record (D-101), which is why 0114 did not do it in passing. Expect a no-op on the live bucket, since the defaults already match.

## Operator validation

Smoke test: `aws s3api get-public-access-block` on the deployed user-data bucket, all four `true`. No perceptual check.

**Result, 2026-10-26, after Amplify build 430 (commit `6930ac7`):** `aws s3api get-public-access-block`
on `amplify-d14fhvl4rp79nn-ma-lostsolesuserdatabucket5-mpiyvettxgde` returns all four flags `True`.
`list-buckets` still shows the same bucket with its original `CreationDate` of 2026-08-31, so it was
updated in place, not replaced.

D-123 trigger checked? C — this narrows the public surface; no trigger fires.

## Resolution

**Files touched**

- `amplify/backend.ts`: right after the 0106 lifecycle rule, sets
  `backend.storage.resources.cfnResources.cfnBucket.publicAccessBlockConfiguration` with all four
  flags `true`, plus a comment explaining why the flags are pinned and not left to S3's default.
- `amplify/explored-set-not-public.test.ts`: the C-4 test used to say "never weakens" and passed
  when the block was missing. It is now "explicitly blocks all public access", and a missing
  `PublicAccessBlockConfiguration` fails it.

**Decisions made**

- **L1 property instead of the L2 `blockPublicAccess` prop.** `defineStorage` has no such option,
  and the `Bucket` construct is created inside Amplify, so the L2 prop cannot be reached.
  `BlockPublicAccess.BLOCK_ALL` is exactly these four flags. This is the same `cfnBucket`
  override as `lifecycleConfiguration` (0106): a property on an existing resource, not a new CDK
  escape hatch, so the escape-hatch count in `backend.ts` does not change. The first criterion is
  amended in place to say so.

**Why this cannot replace the bucket (`raw/` is the system of record, D-101)**

- I diffed the storage stack's synthesized template before and after the change. The only
  difference is the added `PublicAccessBlockConfiguration` block on the one `AWS::S3::Bucket`. The
  logical id, `BucketName` (unset, generated) and every other property are unchanged.
  CloudFormation updates `PublicAccessBlockConfiguration` with no interruption, so the bucket is
  not replaced.
- Live value before deploy, read with `aws s3api get-public-access-block` on
  `amplify-d14fhvl4rp79nn-ma-lostsolesuserdatabucket5-mpiyvettxgde` on 2026-10-26: all four
  flags `true`. The deploy should change nothing on the live bucket.

**Verification**

- With the override commented out, the C-4 test fails with "PublicAccessBlockConfiguration must
  be set, not left to S3's default". With it in place, the test passes.
- All of `amplify.yml`'s guard scripts pass, as do typecheck, lint, `npm run build` and
  `npx vitest run` (273 files, 4516 passed, 1 skipped). `check-secret-storage
  --require-literals` was run with `AWS_APP_ID` and `AWS_BRANCH` set, the way Amplify runs it.

D-123: trigger C is narrowed by this change, not opened. No trigger fires.
