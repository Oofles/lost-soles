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

- [ ] The bucket's construct sets `blockPublicAccess: BLOCK_ALL` explicitly; the synthesized template carries all four settings `true`.
- [ ] `explored-set-not-public.test.ts` asserts the explicit block, and fails if it is removed.
- [ ] The deployed bucket still reports all four settings `true` after deploy (read-only `get-public-access-block`).

## Notes

This changes infra on the bucket that holds `raw/`, the system of record (D-101), which is why 0114 did not do it in passing. Expect a no-op on the live bucket, since the defaults already match.

## Operator validation

Smoke test: `aws s3api get-public-access-block` on the deployed user-data bucket, all four `true`. No perceptual check.

D-123 trigger checked? C — this narrows the public surface; no trigger fires.
