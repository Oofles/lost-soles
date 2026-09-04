---
id: 146
slug: check-design-tokens-mjs-reads-a-dynamodb-composite-key-as-a
title: check-design-tokens.mjs reads a DynamoDB composite key as a hex colour
type: bug
priority: high
status: open
size: s
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-09-02T04:04:46Z
---

## Description

`ANY_HEX = /#[0-9a-f]{3,8}\b/i` matches any `#` followed by three to eight hex characters.
That is a correct description of a CSS colour and an incorrect description of a **DynamoDB
composite sort key**, which this project's own architecture writes with `#` separators.

Found while building ticket `0019`. Its rate-limit counter keys were
`RATE#<userId>#H#2026-09-02T14`, and the scanner reported the `#2026` as a palette leak and
failed. 0019 worked around it by joining the window marker to its date with `:` instead —
correct for that file, and no help at all to the next one.

**The clash is structural, not incidental.** `01-architecture.md` §2 specifies
`PK = U#<uid>#C#<res6parent>` for `LostSolesExploredCell`, and an **H3 cell id is a hex
string** — `8a2a1072b59ffff`. Every fixture in capability `07` that writes a realistic cell
key will contain `#8a2a107…` and every one of them will fail this check. That is a guard
that will be disabled by whoever it blocks, which is the outcome `.githooks/pre-commit`'s
own comment warns about.

## Acceptance criteria

- [ ] A line containing a DynamoDB composite key with a hex-looking segment — use
      `` `U#${uid}#C#8a2a1072b59ffff` `` — does **not** trip the check.
- [ ] A genuine palette leak still fails: `const c = '#C9A227'` and `color: '#000'` both
      still fail, asserted by the existing self-test cases rather than by new ones.
- [ ] The self-test carries the composite-key case, so the fix cannot regress silently.
- [ ] Whatever mechanism is chosen, a suppression is **visible on the line** in the diff
      (the `gitleaks:allow` convention the pre-commit hook already uses) rather than a
      directory or file-extension exemption that silently stops scanning real components.

## Steps to reproduce

1. Add `const k = \`RATE#${"${userId}"}#H#2026-09-02T14\`` to any `.ts` file outside `app/tokens.css`.
2. `node scripts/check-design-tokens.mjs`

## Expected vs actual

**Expected:** no finding — that string is a database key and contains no colour.

**Actual:** `raw hex outside app/tokens.css — reference a semantic token (§8.3)`, and in
`amplify.yml` this fails the deploy, which is the LOCK rather than the alarm (D-163).

## Notes

Three candidate fixes, in the order they look best from here — the decision belongs to
whoever picks this up, not to `0019`:

1. **A visible per-line marker**, mirroring `gitleaks:allow`. Consistent with an existing
   convention in this repo and with the pre-commit hook's stated principle: deny by default,
   allow by exception a reviewer can see in the diff. Costs a marker on each key literal.
2. **Require a colour context** — only flag a hex that sits in a string assigned to something
   colour-shaped, or inside a `style`/`css` region. More precise, considerably more logic,
   and the extra logic is itself a thing that can fail open.
3. **Exclude `*.test.ts`.** Cheapest and wrong: a component test asserting a hardcoded colour
   is exactly the leak this check exists to catch, and `capture-store.ts` — not a test file —
   would still have tripped it.

Note the check is currently *correct* about severity and only wrong about scope. Do not
weaken it into something that would miss `'#C9A227'` in a component.

### 2026-09-04 — this stopped being hypothetical, and cost a deploy (ticket `0033`)

Raised **med → high**. Not because the analysis above changed — it was right — but because
the predicted failure happened, in production, on the branch that is the only deploy gate.

Amplify **job 92 failed** at `check-design-tokens.mjs` while shipping `0033`. The offending
lines were ordinary test fixtures for a KEYS_ONLY GSI:

```
lib/sources/source-account-store.test.ts:252   gsi1pk: "acme#134815"
lib/log.test.ts:134                            pk: "U#abc"
```

`#134815` and `#abc` are both valid CSS colours. Neither is a colour.

**The production key is `strava#51449053` — eight digits, and therefore a hex colour too.**
That is the live GSI1 partition key for the one connected account, so it will appear in the
webhook ticket's fixtures and its log lines. §2 of this ticket predicted capability `07`'s H3
keys; capability `05` got there first.

`0033` worked around it the same way `0019` did — by writing the id so a non-hex character
follows the `#` (interpolation, `` `acme#${OWNER}` ``). That is now the SECOND file carrying a
workaround for this, and the second time the fix was "phrase the key differently", which is
the shape of a guard being routed around rather than satisfied. `0167` was filed as a
duplicate before this ticket was found and is closed pointing here; its only content not
already above is this note.

**Candidate 4, not in the list above:** require the `#` not to be preceded by a word
character — `/(?<![\w$])#[0-9a-f]{3,8}\b/i`. A real colour follows whitespace, `:`, `(` or a
quote; a composite key always follows a letter or digit. It is a narrowing rather than a
loosening, needs no per-line marker, and would have passed every fixture in `0019`, `0033`
and the H3 case §2 names. It does not catch `"#134815"` standing alone as a whole string —
which is correct, since that genuinely is indistinguishable from a colour.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

None — a build-time check script with its own self-test. The self-test result and a green
`node scripts/check-design-tokens.mjs` on a tree containing a realistic H3 cell key are the
evidence.
