---
id: 127
slug: create-slug-trailing-hyphen
title: tickets.mjs create: slug derivation truncates mid-word and emits a trailing hyphen
type: bug
priority: low
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T03:12:50Z
---

## Description

`create` derives a slug from the title when `--slug` is not given. At `tickets.mjs:383` it trims
leading and trailing hyphens **before** truncating to 60 characters:

```js
flags.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
```

The `.slice(0, 60)` can land on a word boundary and reintroduce the trailing hyphen the previous
`.replace` just removed. `SLUG_RE` then rejects it and `create` dies, so any title long enough to be
truncated at a word boundary cannot be created without passing `--slug` by hand.

Hit for real while filing [[0126]] during 0011.

## Steps to reproduce

```
node .claude/skills/tickets/scripts/tickets.mjs create \
  --title "validate: enforce required body sections on every ticket, not just closed ones" \
  --type chore --priority med --size s --capability 01-ticket-system
```

## Expected vs actual

**Expected:** a ticket is created with the slug truncated cleanly to
`validate-enforce-required-body-sections-on-every-ticket-not`.

**Actual:** exit 1 —
`derived slug 'validate-enforce-required-body-sections-on-every-ticket-not-' is not kebab-case; pass --slug`

## Acceptance criteria

- [ ] The trailing-hyphen trim runs **after** the truncation, so a truncated slug is always valid.
- [ ] The reproduction command above creates a ticket with no `--slug`.
- [ ] A title of only punctuation still fails with the existing clear error rather than creating a
      ticket with an empty slug.

## Notes

Low priority: the failure is loud, the message names the fix, and `--slug` is the better choice for a
long title anyway. Filed because 0011 says an awkward edge in the mutating commands gets recorded
rather than worked around by hand.

Separately noticed while filing this: `create` accepts a `--source` flag (defaulting to `agent`) that
the usage text does not list. Not worth its own ticket — fold the usage line into this fix.

## Operator validation

1. On the laptop, run the reproduction command above and watch it print a ticket path instead of an
   error. Delete the ticket it creates afterwards.
