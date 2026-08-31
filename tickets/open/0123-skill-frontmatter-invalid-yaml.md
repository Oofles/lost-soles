---
id: 123
slug: skill-frontmatter-invalid-yaml
title: SKILL.md frontmatter is invalid YAML — /tickets never registers
type: bug
priority: high
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T02:57:39Z
---

## Description

`/tickets` does not appear in Claude Code. The skill is silently never registered.

**Cause:** `.claude/skills/tickets/SKILL.md`'s frontmatter is **invalid YAML**. The `description`
value is unquoted and contains `: ` — in `Subcommands: list, show, …`. YAML reads that as a nested
mapping and errors with *"mapping values are not allowed here"* at column 66. A skill whose
frontmatter does not parse is skipped, with **no error shown anywhere**, which is why it looked fine.

**Why it shipped:** the frontmatter was copied **verbatim from `07-ticketsmith.md` §4.2**, and
0010's acceptance criterion required it be verbatim. A programmatic check confirmed a byte-for-byte
match — so the criterion passed while the thing it described was broken. **The spec itself is
wrong**, and conformance-to-spec cannot catch that.

Corroboration: the operator's own working `~/.claude/skills/openscad/SKILL.md` avoids this by using
a `>` folded block scalar for its `description`.

**This is why 0010 listed "typing /tickets shows the skill" as operator-verifiable only.** The
operator ran it and it failed. That is the check working, not the process failing — but it does mean
0010 closed on an unverified criterion, and the lesson is that "operator-verifiable only" criteria
should block a close rather than be ticked in advance.

## Steps to reproduce

1. Type `/tickets` in Claude Code with this repo open.
2. It does not appear in the list.
3. `python3 -c "import yaml,re; yaml.safe_load(re.match(r'^---
(.*?)
---', open('.claude/skills/tickets/SKILL.md').read(), re.S).group(1))"` raises.

## Expected vs actual

**Expected:** `/tickets` appears with its `argument-hint`, and subcommand completion works.
**Actual:** the skill is absent. No error, no warning, no log line — the failure is entirely silent.

## Acceptance criteria

- [x] `SKILL.md` frontmatter parses as valid YAML, asserted by a test.
- [x] `07-ticketsmith.md` §4.2 is corrected in the same commit — the spec is the origin of the
      defect, and fixing only the copy leaves the next reader to reproduce it (D-153: either the
      code changes or the doc changes, never neither; here both must).
- [x] Every key's parsed value is still semantically what §4.2 intended — quoting must not change
      meaning.
- [x] A test asserts **every** `SKILL.md` under `.claude/skills/` parses, so this cannot recur for a
      future skill.
- [x] CI runs that test.
- [ ] `/tickets` appears in Claude Code and its subcommands work. → **UNVERIFIED — awaiting the
      operator.** Deliberately left unchecked so `close` refuses: this is the exact criterion 0010
      pre-ticked and closed on, and it was false. See 0124. May need
      a session restart.** Frontmatter hot-reload covers *edits* to a known skill; a skill that was
      never registered (because it never parsed) is a new discovery.

## Notes

The general lesson is worth more than the fix: **"matches the spec verbatim" is not a test.** It
verifies transcription, not correctness. Where a spec contains something machine-checkable — YAML,
JSON, a regex, a shell command — the criterion should assert it *parses and behaves*, not that it
was copied faithfully.

## Operator validation

Type `/tickets` in Claude Code. It must appear with its `argument-hint`. Then `/tickets next` —
it should name the next ticket, summarize it, and stop for a go.

## Resolution

**Cause:** `description` was an unquoted YAML scalar containing `Subcommands: list…`. The `: ` makes
it a nested mapping — *"mapping values are not allowed here"*, column 66. **Claude Code skips a
skill whose frontmatter does not parse and reports nothing**: no error, no warning, no log line.
`/tickets` was simply absent, which is why every check I ran passed.

**Fixed in two places, in one commit** (D-153 — either the code changes or the doc changes, never
neither; here both were wrong):

1. `.claude/skills/tickets/SKILL.md` — `description` is now a `>` folded scalar; `allowed-tools` is
   quoted and comma-separated. Parsed values are semantically identical to what §4.2 intended.
2. `docs/07-ticketsmith.md` §4.2 — **the origin of the defect.** Corrected, with a note recording
   why the quoting is load-bearing so a future reader does not tidy it away.

**Prevention, at two layers:**

- `scripts/check-skills.mjs` walks every `.claude/skills/*/SKILL.md` and fails on an unquoted scalar
  containing `: ` or ` #`, or a missing required key. Hand-rolled rather than pulling in a YAML
  dependency — it must run with zero install, and it only needs to catch the class that bites.
  **Regression-proved**: run against a fixture reproducing the original frontmatter, it fails with
  exit 1 and names the key.
- Wired into **CI** and the **pre-commit hook** (the hook only when a `SKILL.md` is staged).

**The lesson, which outlasts the bug.** 0010's criterion required this frontmatter be reproduced
**verbatim** from the spec, and it was — a byte-for-byte programmatic check passed while the artifact
was inert. **"Matches the spec" is not a test.** It verifies transcription, not correctness, and it
inherits every defect the spec has. Where a criterion concerns something machine-checkable — YAML,
JSON, a regex, a command — it must assert the thing *parses and behaves*.

**Second lesson, about the close.** 0010 marked "typing /tickets shows the skill" as
operator-verifiable and **ticked it in advance**, then closed. The operator ran it and it failed.
An operator-verifiable criterion that cannot be checked at close time should **block the close**, not
be pre-ticked with a note. Filed as a follow-up rather than fixed here, to keep this ticket scoped.

## Operator validation

Type `/tickets`. It must appear with its `argument-hint`. **If it still does not, restart the
session** — hot-reload covers edits to an already-registered skill, but this one never registered at
all, so it is a first discovery.

Then `/tickets next`: it must name a ticket, summarize it, and **stop for a go**.
