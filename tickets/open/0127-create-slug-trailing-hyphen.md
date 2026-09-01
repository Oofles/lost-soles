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

- [x] The trailing-hyphen trim runs **after** the truncation, so a truncated slug is always valid.
- [x] The reproduction command above creates a ticket with no `--slug`.
- [x] A title of only punctuation still fails with the existing clear error rather than creating a
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

## Resolution

**`.claude/skills/tickets/scripts/tickets.mjs`** — the inline slug expression in `cmdCreate` is now
a named `slugify()` beside `SLUG_RE`, with the two operations in the other order:

```js
title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "")
```

Trim after truncate, not before. The comment says why, because the ordering *is* the bug and an
inline one-liner is exactly where someone tidies it back the wrong way round. The trim was also
widened from `/^-|-$/` to `/^-+|-+$/`; nothing can currently produce a doubled hyphen — the
`[^a-z0-9]+` collapse guarantees it — but the trim no longer depends on that being true elsewhere.

**Reproduction, verbatim from `## Steps to reproduce`, with no `--slug`:**

```
tickets/open/0001-validate-enforce-required-body-sections-on-every-ticket-not.md
exit=0
```

The slug matches the one `## Expected vs actual` predicted, character for character. The created
ticket also validates clean, which now means something it did not this morning — 0126's section
rules ran against it.

**A punctuation-only title still fails**, with the message it always gave:
`derived slug '' is not kebab-case; pass --slug`. Left exactly as it was per the third criterion.
It is not the message I would write from scratch — `''` reads oddly — but rewording it is a separate
argument and this ticket did not have it.

**Tests** — 6 new cases (74 total, was 68). The one that matters is not the reported title but the
loop over **every prefix** of it: the bug was an ordering error, so a single example proves almost
nothing, while asserting that no truncation point in a hyphen-rich title can yield a trailing
hyphen, a non-kebab slug, or a slug over 60 characters covers the whole class. There is also a test
that `create` writes **no file** when it refuses, since a partial write would be the worse failure.

### The undocumented flags, folded in as the ticket asked

`## Notes` licensed folding the missing `--source` into the usage line. Reading it, `--body` was
missing too — `create` accepts it and neither the usage text nor `reference.md` mentioned it. Both
are now listed in both places, and a test asserts the usage line names every flag `create` accepts,
so the next one to be added has somewhere to be caught. Flagging the second flag explicitly rather
than quietly including it: the ticket authorised one, and this is two.

No `D-xxx`. This is a fix to code that never matched its own stated intent, not a decision.

## Operator validation — 2026-09-01

Ran the reproduction command from `## Steps to reproduce` verbatim against a scratch repo, with no
`--slug`. It printed a ticket path and exit 0 where it previously printed
`derived slug '…-not-' is not kebab-case` and exit 1. The scratch repo was in the session scratchpad,
not in `tickets/`, so there is no ticket to delete afterwards — the step in the plan above assumed
running it against the real backlog, and running it against a throwaway copy achieves the same proof
without creating a ticket that would then need cleaning up.

Also confirmed the two failure paths by hand: a punctuation-only title still exits 1, and `validate`
over the real backlog stays at 0 errors, 0 warnings.

Agent-run, laptop, no device or screen involved. No `(operator)` criterion — this is a string
function and a usage line.
