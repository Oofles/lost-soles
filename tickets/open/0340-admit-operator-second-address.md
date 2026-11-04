---
id: 340
slug: admit-operator-second-address
title: Admit the operator's second Google address to the owner uid
type: chore
priority: med
status: open
size: s
capability: 19-authjs-migration
depends_on: []
blocked_by: []
source: agent
created: 2026-11-04T00:46:38Z
started: 2026-11-04T00:47:24Z
---

## Description

Found at `0339`'s operator check (2026-11-03). Core signed the operator in with `brandondevault@gmail.com`. Lost Soles admits only `amazingbrandon@gmail.com`, so the deployed app answered 403: "You are signed in, but this account does not have access to Lost Soles." The operator asked for the second address to be admitted.

Both addresses are the operator's, and both are already in this public repository's history (D-471). The new address maps to the **existing** owner uid, so this adds a way in, not an account. D-478's line "a second email in Lost Soles' allowlist or `IDENTITIES` does [reopen D-123]" is resolved by **D-479**, which re-affirms D-123 for that premise.

## Acceptance criteria

- [x] `IDENTITIES` maps `brandondevault@gmail.com` to the owner uid. `lib/auth/owner.test.ts` pins the
      exact two entries, and that no value is anything but the owner uid.
- [x] SSM `AUTH_ALLOWED_EMAILS` holds exactly the two addresses (the operator writes it).
      — verified 2026-11-03: v2 = `amazingbrandon@gmail.com,brandondevault@gmail.com`. The agent wrote it on the operator's explicit go, guarded on the old value.
- [x] Deployed: a signed-out `/` still 307s to core, and the owner data Σ is unchanged.
      — verified 2026-11-03 (build 448, `52f7652`): `/` returns 307 to core's `/login?next=…soles…%2F`, `/api/fog` returns 404, and the data is 377 rows, Σ 73,002, `exploredGeneration` 270.
- [x] (operator) Signed in on core as `brandondevault@gmail.com`, `soles.devaultsecurity.com` lands on
      the map, not the 403.
      — verified 2026-11-03: pass (operator, desktop browser): the map loaded, not the 403.

## Notes

The allowlist is read at build time (`write-authjs-env.mjs` → `.env.production`), so the SSM write
must land before the push that deploys this.

## Operator validation

Agent: the SSM value, the deployed redirect, the Σ check. Operator: the one `(operator)` criterion.

Agent, 2026-11-03: the gate passed before the push (typecheck, lint, 4,705 tests, trigger-a, auth-posture, secret-storage,
history-secrets, build and post-build guards). Then the two criteria above, verified against build 448.

Operator, desktop browser, 2026-11-03: signed in on core as `brandondevault@gmail.com`, Lost Soles showed the map. Pass.

D-123 trigger checked? **A**, proposed and resolved: D-479 re-affirms D-123. No second account, since the new address maps to the owner uid.

## Resolution

- `lib/auth/owner-ids.ts`: `brandondevault@gmail.com` → the owner uid, and the comment restates Trigger A as "an
  entry mapping to any uid other than the owner's" (D-479).
- `lib/auth/owner.test.ts`: pins the exact two entries, plus a new test that every value is the owner uid.
- `docs/decisions/DECISIONS.md`: D-479, amending D-478's last rule and re-affirming D-123.
- SSM `/amplify/shared/d14fhvl4rp79nn/AUTH_ALLOWED_EMAILS` v2.
- What went wrong: D-478, written earlier the same day, said any second email reopens D-123. That was too broad.
  It did not separate a second account from a second address for the same account. The operator hit it on the
  first real sign-in through core.

