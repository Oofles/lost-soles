---
id: 164
slug: check-bundle-leak-scans-only-the-first-ssm-value-per-key-so
title: check-bundle-leak scans only the first SSM value per key, so the production secret is never searched locally
type: bug
priority: med
status: open
size: s
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-09-04T17:40:35Z
---

## Description

Found while running `check-bundle-leak.mjs --require-literals` as `0032`'s criterion-6 smoke test.

The scanner resolves each registry key to **one** value — first path wins:

```js
for (const h of ssm.hits) if (!found.has(h.key)) found.set(h.key, h)
```

and `ssmPaths()` returns paths **narrowest first** (0132), so on a developer machine the SANDBOX
value wins. The run reported it plainly:

```
scanning for literals:
  STRAVA_CLIENT_SECRET  from /amplify/lostsoles/root-sandbox-bcc61467ba
  GITHUB_TICKETS_PAT    from /amplify/shared/d14fhvl4rp79nn
```

`/amplify/shared/d14fhvl4rp79nn/STRAVA_CLIENT_SECRET` also exists — it is the value the deployed
app actually loads (`lib/sources/oauth-credentials.ts`) — and it was **never searched for**.

**The consequence.** A production secret leaking into built output would not be caught by a local
run of this check. It would be caught in the Amplify build container, where the sandbox paths do
not resolve and the shared value wins instead — so the gate is not blind, but the surface a
developer trusts before pushing is. The two runs disagree about what they cover while printing
the same reassuring final line.

Not a `0032` defect: the ticket's criterion is that the bundle-leak test covers `client_secret`,
and it does — for one of the two values under that name.

## Steps to reproduce

1. `npm run build`
2. `AWS_PROFILE=devault node scripts/check-bundle-leak.mjs --require-literals`
3. Read the `scanning for literals:` block.

## Expected vs actual

**Expected:** every value stored under a registry key is searched for, so a leak of the value the
deployed app actually loads is caught wherever the check runs.

**Actual:** one value per key. On a developer machine the narrowest path wins, so
`STRAVA_CLIENT_SECRET` resolves to the `root-sandbox` value and the `shared` value — the one
`lib/sources/oauth-credentials.ts` loads in production — is never searched for. The run still
prints `No secret in built output.`

## Acceptance criteria

- [ ] Every SSM value found for a registry key is scanned, not only the first — a key present at
      three paths yields three literals.
- [ ] The run log names each literal WITH its path, so two values under one key are visibly two
      rather than collapsing into one line.
- [ ] Duplicate identical values across paths are de-duplicated by VALUE, so the common case does
      not triple the log.
- [ ] `--self-test` proves the scan fires on a value that is only present at the non-narrowest
      path — the case that silently passes today.
- [ ] The MIN_LITERAL_LENGTH skip is still reported per value, not per key.

## Notes

The narrowest-first ordering is correct and should stay — 0132 established it so the Amplify build
role's scoped `ssm:GetParametersByPath` grant is tried before anything broader. The bug is the
`if (!found.has(h.key))`, which turns an ordering preference into an exclusion.

## Operator validation

**None needed from the operator.** This is a script with a self-test: `node
scripts/check-bundle-leak.mjs --self-test` and a full run with `AWS_PROFILE=devault` are the
verification, and what they printed goes here at close.
