---
id: 318
slug: widen-the-npm-audit-gate-to-the-full-tree-with-a-reviewed-ad
title: Widen the npm audit gate to the full tree with a reviewed advisory allowlist
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-26T16:05:00Z
---

## Description

Found by 0308. The full tree cannot reach 0 high without upstream Amplify releases (D-450), so the gate stays --omit=dev and a new dev-tree critical goes unnoticed between Dependabot alerts. An allowlist of the 2-3 known Amplify-tree GHSAs would let the full tree be gated now. That is a design choice and needs a decision before it is built.

## Acceptance criteria

- [ ] A decision is recorded: either gate the full tree with an allowlist (format, owner, and an
      expiry or re-check rule per entry), or keep D-450's `--omit=dev` gate as is.
- [ ] If the full tree is gated: both CI surfaces (`gate.yml` and `amplify.yml`, D-163) fail on any
      high not on the allowlist, and a test proves an unlisted advisory turns the gate red.
- [ ] The allowlist names only the advisories in `18-mvp-hardening.md`'s 0308 section, each with
      its reason.

## Notes

Run this after `0319` if an upstream release is close: a clean tree removes the need for an allowlist.

## Operator validation

None: CI tooling. The smoke test is the gate failing on a planted unlisted advisory, and a green build without one.

D-123 trigger checked? none.
