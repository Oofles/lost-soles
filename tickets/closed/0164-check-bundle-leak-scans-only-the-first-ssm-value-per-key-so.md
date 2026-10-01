---
id: 164
slug: check-bundle-leak-scans-only-the-first-ssm-value-per-key-so
title: check-bundle-leak scans only the first SSM value per key, so the production secret is never searched locally
type: bug
priority: med
status: closed
size: s
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-09-04T17:40:35Z
started: 2026-10-01T01:08:17Z
closed: 2026-10-01T01:10:12Z
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

- [x] Every SSM value found for a registry key is scanned, not only the first — a key present at
      three paths yields three literals.
- [x] The run log names each literal WITH its path, so two values under one key are visibly two
      rather than collapsing into one line.
- [x] Duplicate identical values across paths are de-duplicated by VALUE, so the common case does
      not triple the log.
- [x] `--self-test` proves the scan fires on a value that is only present at the non-narrowest
      path — the case that silently passes today.
- [x] The MIN_LITERAL_LENGTH skip is still reported per value, not per key.

## Notes

The narrowest-first ordering is correct and should stay — 0132 established it so the Amplify build
role's scoped `ssm:GetParametersByPath` grant is tried before anything broader. The bug is the
`if (!found.has(h.key))`, which turns an ordering preference into an exclusion.

## Resolution

**Files:** `scripts/check-bundle-leak.mjs`, `scripts/check-bundle-leak.test.mjs`.

- `resolveLiterals()` no longer builds a key→first-hit `Map`. Every SSM hit becomes a
  `{ key, value, origin }` candidate; `process.env` and `.env.local` remain fallbacks only for
  keys SSM did not resolve at all (unchanged semantics). `ssmPaths()` and its narrowest-first
  order are untouched, as the Notes asked.
- `resolveLiteralsFrom()` now takes that **list** instead of a `{key: value}` object, because one
  key can hold several values. It de-duplicates **by value** and returns
  `{ key, value, origins: [...] }`; a different key sharing a value is recorded as
  `<path> (as KEY)` so it is not lost. Placeholder and `MIN_LITERAL_LENGTH` skips are emitted per
  distinct value and name their paths. The separate `origins` map that `resolveLiterals` used to
  return is gone — the origins ride on each literal.
- The run log prints one line per distinct value with every path it was found at.
- `--self-test` gained three cases: two different values under one key are two literals (and a
  repeated value is one, listing both paths); a bundle containing **only** the non-narrowest
  path's value fires; the length floor skips per value, naming the path.
- vitest: the three existing `resolveLiteralsFrom` call sites moved to the list shape; three new
  tests mirror the self-test cases.

**Finding worth recording:** the real run shows all three `STRAVA_CLIENT_SECRET` paths (two
sandboxes and `shared`) currently hold the **same** value, so the production secret *was* being
searched for — by coincidence of value, not by design. The ticket's diagnosis was right about
the mechanism; the exposure today was nil. The fix matters the day the sandbox and production
secrets diverge (e.g. a rotation done on one only). The new log makes that state readable at a
glance: a divergence shows as two lines under one key.

No design doc change, no new D-xxx: this is the script now doing what 01-architecture §7 and the
0032 criterion already said it does.

## Operator validation

**None needed from the operator** — invisible tooling, verified by smoke test (2026-09-30, WSL):

- `node scripts/check-bundle-leak.mjs --self-test` → every case ok, including the three new 0164
  cases (`must fire   a value present only at the non-narrowest path`).
- `npx vitest run` → 131 files, 2443 passed / 1 skipped.
- `npm run build` then `AWS_PROFILE=devault node scripts/check-bundle-leak.mjs --require-literals`:
  ```
  source: ssm /amplify → 9 key(s)
  scanning for literals:
    STRAVA_CLIENT_SECRET  from /amplify/lostsoles/root-sandbox-bcc61467ba, /amplify/lostsoles/vivicat-sandbox-7b04466b62, /amplify/shared/d14fhvl4rp79nn
    STRAVA_WEBHOOK_VERIFY_TOKEN  from /amplify/lostsoles/root-sandbox-bcc61467ba, /amplify/shared/d14fhvl4rp79nn
    GITHUB_TICKETS_PAT  from /amplify/shared/d14fhvl4rp79nn
  skipped: STRAVA_CLIENT_ID from <same three paths> — value is 6 chars, under the 12-char floor …
  No secret in built output. 3 literal(s) and 5 patterns checked across 3 zone(s).
  ```
  All 9 SSM hits are accounted for (3 + 2 + 1 scanned, 3 skipped), where the old code reported
  one origin per key. The `/amplify/shared/...` path is now named on the client-secret line.
