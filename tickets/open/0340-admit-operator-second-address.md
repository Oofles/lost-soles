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
- [ ] SSM `AUTH_ALLOWED_EMAILS` holds exactly the two addresses (the operator writes it).
- [ ] Deployed: a signed-out `/` still 307s to core, and the owner data Σ is unchanged.
- [ ] (operator) Signed in on core as `brandondevault@gmail.com`, `soles.devaultsecurity.com` lands on
      the map, not the 403.

## Notes

The allowlist is read at build time (`write-authjs-env.mjs` → `.env.production`), so the SSM write
must land before the push that deploys this.

## Operator validation

Agent: the SSM value, the deployed redirect, the Σ check. Operator: the one `(operator)` criterion.

D-123 trigger checked? **A**, proposed and resolved: D-479 re-affirms D-123. No second account, since the new address maps to the owner uid.
