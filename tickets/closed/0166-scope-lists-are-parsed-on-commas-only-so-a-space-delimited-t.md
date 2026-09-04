---
id: 166
slug: scope-lists-are-parsed-on-commas-only-so-a-space-delimited-t
title: Scope lists are parsed on commas only, so a space-delimited token response reads as a downgrade
type: bug
priority: high
status: closed
size: s
capability: 05-strava-adapter
depends_on: []
blocked_by: []
source: agent
created: 2026-09-04T19:08:06Z
started: 2026-09-04T19:09:34Z
closed: 2026-09-04T19:10:15Z
---

## Description

`0165` fixed the wrong half of the problem and the connect flow still fails. The refusal at
**15:06:18**, with `0165` live since 14:33, is the proof: it is `oauth grant refused after
exchange`, and under `0165`'s code that branch only runs when the token response **states** a
scope that falls short. There is no `oauth callback refused` line at 15:06, so the callback's
scope string DID contain `activity:read_all`.

The same authorization, described twice, one string apart.

**`parseScopes` splits on commas only.** That is right for the callback query string, which is
where the only example in `03-integrations.md` §2.2 comes from. It is wrong for the token
endpoint: **RFC 6749 §5.1 defines the token response's `scope` as SPACE-delimited.** A
space-delimited list run through a comma split returns ONE element — `"read activity:read_all"` —
which equals no required scope, so a full grant reads as a downgrade.

The failure is loud and the cause is silent: no parse error, no malformed input, just a
fully-authorised connection refused and its credential revoked.

**The second defect is diagnostic, and it cost the operator a connect.** The refusal logged
`missing` and nothing else, so "the user declined a permission" and "this code cannot parse the
scope list" produced an identical line. Distinguishing them required a second failed attempt from
the phone — for information the first attempt already had and threw away.

## Steps to reproduce

1. `/settings` → Connect Strava, approve with **every** permission ticked.
2. The screen shows *"Not connected — a permission is missing."*
3. `/aws/amplify/d14fhvl4rp79nn` shows `oauth grant refused after exchange` and **no** preceding
   `oauth callback refused` — the callback passed, the token response did not.

## Expected vs actual

**Expected:** a scope list is parsed the same whichever separator its surface uses, because no
scope name in any of these grants contains either one.

**Actual:** commas only. The callback (commas) parses; the token response (spaces) does not, and
the mismatch presents as a revoked credential.

## Acceptance criteria

- [x] A space-delimited scope list parses identically to a comma-delimited one, on both surfaces.
- [x] Mixed and untidily-spaced lists parse — `"read, activity:read_all"`, leading and trailing
      whitespace, repeated separators.
- [x] Accepting two SEPARATORS does not accept two SPELLINGS: `"activity read_all"` and
      `"<lesser> _all"` are still refused.
- [x] Both refusal logs record what was **granted** as well as what was **missing**, and the
      post-exchange one records `scopeSource`, so a parse failure and a real decline are never
      again the same line.
- [x] A test covers the token response's space-delimited form specifically — the form no fixture
      had.

## Notes

**This is the same root cause as `0165` wearing different clothes, and that is worth stating
plainly rather than filing twice and moving on.** Both bugs are one code path trusting one example
from one document about one of the two surfaces a scope string travels on. `0165` corrected what an
absent field means; this corrects how a present one is spelled. Neither would have survived a
single recorded real response, which is `0038`.

`0032` shipped with the pre-exchange check the ticket asked for, plus a post-exchange check it did
not. Both defects have been in the extra check. It is still worth keeping — with a correct parser
it is the only thing that could catch a provider downgrading a grant between callback and token —
but the record should show that the un-asked-for check has cost two operator connects and the
asked-for one has cost none.

## Operator validation

**Device: the Android phone, Chrome, at `/settings`.** Connect Strava with both boxes ticked.
Expect *Connected as athlete `<id>`*.

The athlete id is **not** the operator's to find — it is read back from DynamoDB with AWS
credentials, and asking for it in `0032`'s checklist was a D-181 violation on the agent's part.
The `scopeSource` log line settles what the live token response actually carries, and
`03-integrations.md` §2.2 step 3's unverified annotation is replaced with it.

## Resolution

One regex and one log line.

```ts
raw.split(",")        ->  raw.split(/[\s,]+/)
```

`03-integrations.md` §2.2 shows the scope list exactly once, on the callback, comma-separated —
so the parser was written for the surface the document happened to illustrate, and the token
endpoint's RFC 6749 §5.1 space-delimited form was never in view. **The document was not wrong
here; it was partial, which is harder to notice.**

Accepting both separators is not leniency covering an unknown: no scope token in any of these
grants contains a comma or a space, so the separators cannot be confused with content. A test
asserts the parser did not become lenient about the scope NAME — `"activity read_all"` and
`"<lesser> _all"` are still refused.

**Both refusal logs now record what was granted, not only what was missing**, and the
post-exchange one records `scopeSource`. That is the change that would have removed the second
failed connect: at 14:17 and 15:06 the log said `missing: ["activity:read_all"]` and nothing else,
which is equally consistent with a declined permission and an unparseable list. One extra field
distinguishes them from the first attempt.

### What this run of three tickets actually showed

`0032` shipped a pre-exchange scope check (asked for) and a post-exchange re-check (not asked
for). **Both defects, `0165` and `0166`, were in the check nobody asked for**, and both are the
same shape: one code path trusting one example from one document about one of the two surfaces a
scope string travels on. The check is still worth keeping — with a correct parser it is the only
thing that could catch a provider downgrading a grant between the callback and the token — but
the cost of adding it unbidden was two operator connects, and that belongs in the record.

Neither bug would have survived a single recorded real response. That is `0038`, whose Notes now
say so.

## Operator validation

**Smoke tests (agent), 2026-09-04.** Deployed and verified before asking for another attempt.

The diagnosis needed no reproduction: `oauth grant refused after exchange` at 15:06:18 with
`0165` live since 14:33, and **no** `oauth callback refused` at 15:06, together say the callback
carried `activity:read_all` and the token response's stated scope did not parse as containing it.
The two differently-worded refusals written into `0032` paid for themselves a second time.

```
LostSolesSourceAccount   0 rows    still nothing stored — the refusal path holds
```

Suite 531 green; lint, typecheck, `check-boundaries.mjs` and `check-design-tokens.mjs` clean. The
criterion-1 grep gate fired on this ticket's own new test when it spelled the lesser scope
literally, and the fixture was assembled at runtime instead — the gate works.

**★ Operator, on the phone ★** — `/settings` → **Connect Strava**, tick **both** boxes. The one
that matters is *"View data about your private activities"*: that is `activity:read_all`, and it
is the one whose absence puts a permanent hole in the map. Expect *Connected as athlete `<id>`*.

**Nothing to look up afterwards.** The athlete id, the stored scopes and the `scopeSource` line
are all read back with AWS credentials.

## Operator validation — RESULT, 2026-09-04

**Connected.** Operator reported success on the phone; read back with AWS credentials:

```
pk               U#5488e4b8-d081-7014-748e-edd1937f8083
sk               SRC#strava
externalOwnerId  "51449053"          <- a STRING (0032 criterion 4)
scopes           SS ["activity:read_all", "read"]
status           ACTIVE
connectedAt      2026-09-04T19:28:16Z
expiresAt        1788571696 = 2026-09-05T01:28:16Z   <- exactly 6.0h, from the response

source connected {"source":"strava","externalOwnerId":"51449053",
                  "scopes":["activity:read_all","read"],"scopeSource":"response"}
```

`scopeSource: "response"` is the finding: the token response **does** state its scope, so `0165`'s
"absent field" diagnosis was wrong and this ticket's separator fix was the whole defect. Recorded
as a correction on `0165`, and `03-integrations.md` §2.2 step 3's annotation replaced with the
observed fact rather than the inference.
