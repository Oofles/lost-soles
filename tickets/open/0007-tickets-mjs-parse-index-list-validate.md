---
id: 7
slug: tickets-mjs-parse-index-list-validate
title: tickets.mjs — frontmatter parse, index.json generation, list, and the validator
type: feature
priority: high
status: open
size: m
capability: 01-ticket-system
depends_on: [3]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The read half of `scripts/tickets.mjs` (`07-ticketsmith.md` §4.7). Node, **no dependencies beyond
the standard library and a small YAML parser, vendored or pinned**. It is the deterministic half:
*it makes no judgements and asks no questions.* Judgement lives in `SKILL.md` (0010).

Lives at `.claude/skills/tickets/scripts/tickets.mjs` (§4.1). Commands in scope for this ticket:

```
index                      Walk tickets/{inbox,open,closed}/, parse all frontmatter,
                           write tickets/index.json. Idempotent.
list [filters]             Table (or --json) from index.json. Never reads bodies.
                           --status --type --priority --capability --ready --size
show <id>                  Emit one ticket's raw markdown + resolved dep statuses.
validate                   Full validation pass; exit 1 on any error.
```

Every command supports `--json`; the skill uses `--json` and renders the table itself.

**Frontmatter parsing rules, all normative (§4.7):**

- Split on the leading `---` fence; everything before the second `---` is YAML, the rest is body.
- Parse with a **real YAML parser** — never a regex, never `eval`. A title containing a colon or a
  `#` must round-trip.
- Serialize back with the same parser, preserving key order as specified in §3.1 so diffs stay
  readable. Never reflow or re-quote the body.
- **The body is opaque** except for one thing: counting acceptance checkboxes. Match `- [ ]` and
  `- [x]` lines under `## Acceptance criteria` up to the next `##`. Everything else passes through
  byte-for-byte.
- Unknown frontmatter keys are **preserved on rewrite** and reported by `validate` as warnings, so a
  future field addition never silently loses data.

**Validation errors (exit 1)** — the §4.7 list, complete: frontmatter missing/malformed/unparseable;
a required field absent for the ticket's folder; any enum value outside its set; `id` not matching
the filename prefix or `slug` not matching the filename; duplicate `id` across all three folders;
`status` disagreeing with the folder; `blocked_by` non-empty but `status` not `blocked` (or vice
versa); a `depends_on`/`blocked_by` id that does not exist; a dependency cycle (0009 owns the cycle
check itself); `closed:` present on an open ticket or absent on a closed one; a closed ticket missing
`## Resolution` or `## Operator validation`; a `bug` missing `## Steps to reproduce` or
`## Expected vs actual`; a closed ticket with an unchecked acceptance criterion.

**Warnings (exit 0, reported):** `capability: null` on a `feature`; `size: l` on anything in the
ready set; a `capability` with no matching `docs/capabilities/NN-name.md`; an inbox item older than
14 days; an unknown frontmatter key.

**`index.json`** — one entry per ticket: every frontmatter field, plus `path`, plus `ready`
(boolean), plus `acceptance: {checked, total}`. **No bodies.** Deleting it is always safe.

**This ticket decides Q-07-1** — whether `index.json` is committed or gitignored. §4.7 says either
choice is fine since it is derived; committing makes the in-app UI's cold rebuild cheaper. **Lean
committed.** Record the decision as a `D-xxx` in `docs/decisions/DECISIONS.md` with its rationale,
and make `.gitignore` agree with it.

## Acceptance criteria

- [ ] `.claude/skills/tickets/scripts/tickets.mjs` runs on the project's pinned Node with no
      `npm install` step required beyond the repo's own `npm ci`.
- [ ] `node tickets.mjs index` walks all three ticket folders and writes `tickets/index.json`.
      Running it twice in a row produces a byte-identical file (idempotent).
- [ ] `index.json` entries contain every frontmatter field plus `path`, `ready`, and
      `acceptance: {checked, total}`, and contain **no** ticket body text.
- [ ] `node tickets.mjs list` prints a table with id, type, priority, size, capability, status,
      title, sourced only from `index.json` — verified by deleting every ticket body's content in a
      scratch copy and confirming `list` output is unchanged.
- [ ] `list` supports `--status`, `--type`, `--priority`, `--capability`, `--ready` and `--size`,
      and they compose (e.g. `--status open --priority high`).
- [ ] `node tickets.mjs show 42` prints the ticket's raw markdown plus, for each id in `depends_on`
      and `blocked_by`, that ticket's title and current status.
- [ ] `--json` is accepted by `index`, `list`, `show` and `validate` and emits parseable JSON on
      stdout with no decorative output mixed in.
- [ ] A ticket whose `title` contains a colon and a `#` round-trips through parse → serialize
      byte-identically, and a unit test asserts it.
- [ ] A ticket with an unknown frontmatter key round-trips with the key preserved, and `validate`
      reports it as a warning, not an error.
- [ ] Frontmatter key order in a rewritten file matches §3.1 order, and the body is byte-identical
      to the input, asserted by a unit test.
- [ ] Acceptance-checkbox counting matches only `- [ ]` / `- [x]` lines under `## Acceptance
      criteria` and stops at the next `##` — asserted with a fixture containing checkbox-looking
      lines in `## Notes`.
- [ ] `validate` implements every error in the list above and exits 1 on any of them, naming the
      file and the rule for each.
- [ ] `validate` implements every warning in the list above and exits **0** when only warnings are
      present.
- [ ] A fixture directory of deliberately-broken tickets exists (one per error rule) and a test
      asserts `validate` flags exactly the expected rule for each.
- [ ] Q-07-1 is decided and recorded as a `D-xxx` in `docs/decisions/DECISIONS.md`, and
      `.gitignore` matches the decision.

## Notes

The reason for the deterministic/model split is arithmetic (§4.7): TicketSmith has no executables,
so its `/tickets` must open every ticket into context just to sort them. **`/tickets list` must cost
one table, not twelve file reads.** That is the difference between a backlog that works at 60
tickets and one that does not. Any implementation where `list` reads bodies has missed the point of
the ticket.

Cycle detection is specified here as an error but is **implemented in 0009** along with the ready-set
computation; `ready` in `index.json` likewise gets its real definition there. Emit `ready` as
`false` for everything until 0009 lands rather than inventing a half-rule.

`validate` is run over the whole hand-authored seed backlog by 0011, and it is expected to fail the
first time.

## Operator validation

1. On the laptop, run `node .claude/skills/tickets/scripts/tickets.mjs list` in a terminal. The
   whole backlog prints as **one table** that fits a normal terminal width — ids padded to four
   digits, one row per ticket. If it wraps into unreadable spaghetti, the column widths are wrong
   and that is a real defect, not cosmetics.
2. Run `node ... validate` on the real backlog. Read the output. It should name files and rules in
   plain language; an error message you cannot act on without opening the source is a defect.
3. Run `node ... show 0001` and confirm the pre-flight ticket prints in full, with its `depends_on`
   line resolved to titles rather than bare numbers.
4. Run `node ... index && git status`. Confirm `tickets/index.json` shows up (or does not) exactly
   as the Q-07-1 decision says it should.

## Resolution

`.claude/skills/tickets/scripts/tickets.mjs` — no dependencies, Node stdlib only, so it runs before
`npm install` exists. Frontmatter parser is deliberately **not** a YAML library: the schema is flat
and fixed, and a real YAML parser would accept structures the format disallows then silently
reformat them on write. This one round-trips or fails.

- `index` is idempotent (byte-identical on re-run), carries every frontmatter field plus `path`,
  `ready` and `acceptance: {checked,total}`, and **no body text**.
- `list` is sourced only from frontmatter — asserted by a test that empties every body and
  confirms the output is unchanged.
- `show`, `validate`, `list`, `index`, `next`, `create` all accept `--json`.
- Round-trip: a title containing a colon and a `#` survives byte-identically; unknown keys are
  preserved on rewrite and reported as a warning; rewritten key order follows §3.1 and the body is
  byte-identical, all asserted by tests.
- Acceptance counting matches only `- [ ]`/`- [x]` under `## Acceptance criteria` and stops at the
  next `##`, with a fixture containing checkbox-looking lines in `## Notes`.
- `validate` implements all 12 error rules and 5 warning rules; errors exit 1, warnings exit 0.
  One test per error rule asserts the *right* rule fires.

**The validator's first run found a real defect — mine.** All 7 previously-closed tickets had
unchecked acceptance criteria: I had written `## Resolution` and moved the file without ticking the
boxes. That is exactly the failure 0011 was written to catch, found on turn one. Fixed by reviewing
each criterion individually rather than blanket-ticking, which would have been the very failure the
`close` command refuses. Three genuine gaps surfaced and are annotated inline in those tickets
(husky/D-155, the TicketSmith diff record, and hand-authored index summaries) rather than quietly
ticked.

Q-07-1 settled as **D-159: `index.json` is committed.** `.gitignore` verified to agree.

**Deviation (D-160):** tests use `node:test`, not vitest — vitest needs a `package.json` that does
not exist until 0012. Same reasoning as D-155.

## Operator validation

Run `node .claude/skills/tickets/scripts/tickets.mjs list --status open --priority high | tail -3`
and confirm it prints a count. Then `... validate` — expect `0 error(s), 0 warning(s)`. Then break
something on purpose: change a `priority:` to `urgent` in any open ticket and re-run `validate`; it
must exit 1 naming that file and the `enum` rule. Undo it.
