---
id: 130
slug: sandbox-environment-and-a-throwaway-agent-account-for-troubl
title: Sandbox environment and a throwaway agent account for troubleshooting
type: chore
priority: low
status: open
size: s
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T15:31:47Z
---

## Description

TODO

## Acceptance criteria

- [ ] TODO

## Notes

TODO

## Operator validation

TODO

## Description

Raised by the operator during ticket 0014: they asked for an authentication method for the agent, to
assist with development and troubleshooting.

**It must not be a second account in the production pool.** `08-security-privacy.md` §2.4 Trigger A
fires the moment a second production account exists: it makes D-123's stated premise ("map shown only
to the owner") **false, not merely weaker**, and demands a seven-item gate of which four are build
items — owner-scoped access tests, a fidelity field on the user record, a consent screen, and a delete
path executed once against a test account. 0014's own Notes are explicit that this is bigger than the
auth work by an order of magnitude.

**The sandbox is the right home.** 0014's Notes: *"Each environment (sandbox, PR preview, production)
gets its own user pool. The owner account created here is the production one; sandbox accounts are
throwaway."* A sandbox account gives a real signed-in browser session with zero production blast
radius, no effect on D-123, and nothing to revoke later.

A sandbox stack already exists — `amplify-lostsoles-root-sandbox-bcc61467ba`, user pool
`us-east-1_ortrz27yR`, stood up 2026-08-31T03:42Z, presumably during 0012. It is **not** currently in
the fixed posture: it was created with `allowAdminCreateUserOnly: false` like production was, and no
sandbox deploy has run since 0014's fix, so it still carries both holes. That is tolerable for a
throwaway environment but should not be assumed away — see the criteria.

Note also that the agent already holds AWS admin CLI access to this account, which covers most
troubleshooting. What it lacks is a *browser session as a signed-in user*. That is the whole gap this
ticket closes; it is genuinely small.

## Acceptance criteria

- [ ] `npx ampx sandbox` deploys cleanly and its `amplify_outputs.json` is confirmed to point at the
      sandbox pool, not production. Local development targets the sandbox by default.
- [ ] The sandbox pool carries the **same** posture as production — `check-auth-posture.mjs` passes
      against it. A sandbox with self-signup open is a real public registration endpoint on the real
      internet, even if the data behind it is throwaway.
- [ ] A throwaway agent account exists in the **sandbox** pool only, and is confirmed absent from the
      production pool.
- [ ] The production pool still contains exactly one user (the owner) after this work.
- [ ] `docs/capabilities/02-deploy-and-auth.md` records which pool is sandbox and which is production,
      with their ids, so the confusion that occurred during 0014 cannot recur.

## Notes

0014 hit exactly this confusion: the agent's local `amplify_outputs.json` was the **sandbox's**, so an
early posture read reported the sandbox pool's state while describing it as production. The finding
survived (CloudTrail confirmed production was created with `allowAdminCreateUserOnly: false` too), but
the evidence pointed at the wrong resource. Recording the two pool ids side by side is the cheap fix.
