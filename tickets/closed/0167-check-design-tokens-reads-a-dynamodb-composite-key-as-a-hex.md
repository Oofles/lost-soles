---
id: 167
slug: check-design-tokens-reads-a-dynamodb-composite-key-as-a-hex
title: check-design-tokens reads a DynamoDB composite key as a hex colour
type: bug
priority: high
status: closed
size: s
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-09-04T20:50:43Z
closed: 2026-09-04T21:22:13Z
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

- [x] ~~Five criteria describing a fix to `check-design-tokens.mjs`.~~ **WITHDRAWN** — this
      ticket is a DUPLICATE of `0146`, which was filed 2026-09-02 from ticket `0019` and
      describes the same defect more completely. Its evidence has been folded into `0146`'s
      Notes and `0146` raised med → high. The criteria are struck rather than deleted so the
      duplication is visible rather than tidied away.

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

## Resolution

**Withdrawn as a duplicate of `0146`, the same day it was filed.**

`0146` — *"check-design-tokens.mjs reads a DynamoDB composite key as a hex colour"* — has
existed since 2026-09-02, filed from ticket `0019` when the same pattern rejected
`RATE#<userId>#H#2026-09-02T14`. It is the better ticket: it also names the case this one
missed, that capability `07`'s H3 cell ids are literally hex strings (`8a2a1072b59ffff`), so
every realistic `ExploredCell` key fixture will fail the same check.

**Why it was filed anyway, which is the part worth recording.** `0033` hit the failure
mid-deploy, and the ticket went in from the failing build log without a search of the open
backlog first. A `list --type bug` would have found `0146` by title in one line. That is a
cheap habit to skip under a red build and an expensive one to skip repeatedly — a backlog
with two tickets for one defect is a backlog nobody trusts to be the list of what is wrong.

**What was carried across before closing**, so nothing is lost with this id:

- Amplify **job 92**, 2026-09-04T20:49Z — the first real deploy failure from this defect.
- The exact fixtures that tripped it, and that **`strava#51449053`**, the live GSI1 key for
  the connected account, is itself a valid hex colour — so the webhook ticket will hit this.
- That `0033` is now the SECOND file carrying a "phrase the key differently" workaround
  after `0019`, which is a guard being routed around rather than satisfied.
- A fourth candidate fix `0146` did not list: require the `#` not to follow a word character.

`0146` is raised **med → high** on the strength of the first of those.

## Operator validation

None. Nothing was built and nothing was deployed under this id. The verification that matters
is that `0146` now carries the evidence — visible in its `## Notes` and in its raised
priority — and `tickets.mjs validate` reports 0 errors after the move.
