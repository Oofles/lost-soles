---
id: 167
slug: check-design-tokens-reads-a-dynamodb-composite-key-as-a-hex
title: check-design-tokens reads a DynamoDB composite key as a hex colour
type: bug
priority: high
status: open
size: s
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-09-04T20:50:43Z
---

## Description

`scripts/check-design-tokens.mjs` fails the Amplify build on DynamoDB composite keys,
because its hex-colour pattern cannot tell one from the other.

```js
const ANY_HEX = /#[0-9a-f]{3,8}\b/i
```

Every key in this project's single-table designs is `<prefix>#<value>`, and a numeric
`<value>` of three to eight digits IS a syntactically valid hex colour. So
`acme#134815` matches. So does `U#abc`. So does the production GSI1 key for the one
connected Strava account, **`strava#51449053`** — eight digits.

Found while closing `0033`: the ticket's own tests could not be written with the
obvious literals. It cost one failed deploy (Amplify job 92, 2026-09-04T20:49Z), and
the accommodation there — interpolate the id so a `$` follows the `#` — is a workaround
sitting in a test file, not a fix.

**This will recur, and soon.** The webhook ticket resolves `owner_id` → `userId`
through exactly that key, so its fixtures and its logs will carry `strava#51449053`.
Anything writing a `pk`/`sk`/`gsi1pk` literal is one unlucky id away from a red build.

**Why it matters beyond the inconvenience.** `check-boundaries.mjs` carries a comment
that is the whole argument: *"a gate with false positives is a gate that gets
bypassed"*. That check was narrowed in `0016` for precisely this reason after it fired
on legitimate settings copy. This one is now in the same position, and it is the last
line of defence before `soles.devaultsecurity.com` (D-163) — the check most worth
keeping trustworthy is the one guarding a deploy nothing else guards.

## Acceptance criteria

- [ ] A hex colour glued to a preceding word character is not reported. A real colour
      is essentially never written that way — it follows whitespace, `:`, `(`, or a
      quote — so requiring that is a narrowing, not a loosening.
- [ ] `acme#134815`, `U#abc` and `strava#51449053` pass, spelled as plain literals.
- [ ] The genuine leaks the check exists for still fail: `color: #1a2b3c`,
      `background:#fff`, `"#134815"` as a standalone value.
- [ ] The self-test (`--self-test`) covers both directions, and its fixture gains a
      composite-key case — a regression test that names the id that caused it.
- [ ] `0033`'s test files drop their interpolation workaround and state the composite
      keys as literals, which is what the tests would have said in the first place.

## Steps to reproduce

1. Put `const k = "acme#134815"` in any scanned `.ts` file.
2. `node scripts/check-design-tokens.mjs`.

## Expected vs actual

**Expected:** no violation — a DynamoDB sort key is not a colour.

**Actual:** `raw hex outside app/tokens.css — reference a semantic token (§8.3)`,
exit 1, and on Amplify a failed build with no deploy.

## Notes

The comment exemption already in the script (`isComment`) shows the author anticipated
false positives and handled the case they hit. This is the second case.

Not urgent for correctness — nothing ships wrong — but it is a **deploy blocker on an
unrelated ticket**, which is why it is filed `high` rather than left as a nuisance.

## Operator validation

None expected. The whole subject is a script with a self-test, and both directions are
reachable by running it — the close should carry the smoke test's output rather than an
instruction (D-181).
