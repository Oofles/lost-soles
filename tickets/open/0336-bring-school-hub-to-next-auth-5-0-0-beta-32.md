---
id: 336
slug: bring-school-hub-to-next-auth-5-0-0-beta-32
title: Bring school-hub to next-auth 5.0.0-beta.32
type: chore
priority: high
status: open
size: s
capability: 19-authjs-migration
depends_on: [330]
blocked_by: []
source: agent
created: 2026-11-02T19:12:18Z
---


## Description

Capability `19-authjs-migration`. Decision **D-474** (Lost Soles pins next-auth `5.0.0-beta.32`).
**D-471** puts every session `school-hub` mints inside Lost Soles' trust boundary: both apps share
`AUTH_SECRET` and a `.devaultsecurity.com` cookie. D-470 re-affirms D-123.

`school-hub` runs `next-auth 5.0.0-beta.25`. That version carries critical advisories, two of them
on exactly what Lost Soles relies on: GHSA-8fpg-xm3f-6cx3 (existence-based auth checks can fail
open) and GHSA-7rqj-j65f-68wh (an email-normaliser homoglyph `@` bypass, while email is Lost Soles'
identity key). Also GHSA-x445-f3h2-j279, GHSA-xmf8-cvqr-rfgj and GHSA-5jpx-9hw9-2fx4. `0330` found
these when Lost Soles' deploy audit gate refused beta.25.

**This work happens in the `school-hub` repository**, not this one. This ticket tracks it because
Lost Soles' cutover (`0332`) should not make Google the only way in while a sibling app that can mint
its sessions is on a fail-open version.

## Acceptance criteria

- [ ] `school-hub`'s `package.json` pins `next-auth` to exactly `5.0.0-beta.32`, and its
      `npm audit --omit=dev` reports no high or critical advisory for `next-auth` or `@auth/core`.
- [ ] `school-hub` is deployed on beta.32: its Amplify app `d1at27fw1o7tr4` `main` build succeeded
      after the upgrade commit.
- [ ] `school-hub`'s `lib/auth/config.ts` is unchanged, or, if the upgrade forced a change, Lost
      Soles' copy and its sha256 pin (`lib/auth/config.test.ts`) are updated in the same session,
      and the header names the new source commit.
- [ ] (operator) Signing in to `school-hub` still works on the desktop browser after the upgrade.

## Notes

The work is in another repo, so the operator decides who does it. A session opened in
`/home/vivicat/school-hub` can do it.

`0330` confirmed that sessions minted by `@auth/core`'s `encode` decrypt in Lost Soles on beta.32.
The JWE format is shared through `AUTH_SECRET` and the cookie name. So the two apps interoperate
across the version gap meanwhile, and the gap is a security exposure, not a compatibility break.

## Operator validation

Agent: the `npm audit` output and the Amplify job status, recorded here. Operator: one sign-in to
`school-hub`.

D-123 trigger checked? **A** (the trust boundary of Lost Soles' identity) — D-470 re-affirms D-123.
No account is added.
