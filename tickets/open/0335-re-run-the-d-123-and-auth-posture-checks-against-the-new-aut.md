---
id: 335
slug: re-run-the-d-123-and-auth-posture-checks-against-the-new-aut
title: Re-run the D-123 and auth posture checks against the new auth (D-425)
type: chore
priority: med
status: open
size: s
capability: 19-authjs-migration
depends_on: [334]
blocked_by: []
source: agent
created: 2026-11-02T17:18:06Z
started: 2026-11-04T03:02:06Z
---


## Description

Capability `19-authjs-migration`, the last step. **D-425** names exactly what the migration
invalidates in capability `18`, and this ticket re-runs it against the new auth. **D-470** is the
re-affirmed D-123 it checks against.

- `0114`'s Trigger A check, live: one identity, the owner, in both `AUTH_ALLOWED_EMAILS` and
  `IDENTITIES`.
- `0114`'s **A-6** (D-428): `POST /api/tickets/capture` refuses a non-owner. Prove it on production
  with a session for an allowlisted-but-unmapped email if one can be minted without touching the
  shared `AUTH_SECRET`. Otherwise prove it with the route's test plus a signed-out curl, and say which.
- `0115`'s posture checks, re-pointed: the old "self-signup off" and "no unauthenticated identities"
  become "a Google account outside the allowlist cannot sign in" and "no unauthenticated principal
  reaches any data". Both are proven by attack, as `0014` proved self-signup off.
- `0117`'s §9 rows that name Cognito are re-read, with a dated note on each.

## Acceptance criteria

- [ ] Each check above has a pasted command and output in the Resolution.
- [ ] A sign-in attempt with a Google account outside `AUTH_ALLOWED_EMAILS` is refused. The agent
      observes the refusal in the Auth.js logs or the callback response, not on trust.
- [ ] `09-roadmap.md` §9 rows that mention Cognito carry a dated note pointing at this ticket.
- [ ] The capability `19` drift audit is unblocked: no capability ticket is left open.

## Notes

The refused-account attempt needs a Google account that is not the operator's. If none is at hand,
ask the operator once whether to run it with one of theirs that is not on the allowlist. That is a
single sign-in attempt, not a scenario to build.

## Operator validation

Agent: every check is a script or curl. Operator: at most the one refused sign-in above, if the
agent has no second Google account to try.

D-123 trigger checked? **A** — this verifies Trigger A's gate after the migration. D-470.
