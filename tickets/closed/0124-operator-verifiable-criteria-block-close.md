---
id: 124
slug: operator-verifiable-criteria-block-close
title: Operator-verifiable criteria should block a close, not be pre-ticked
type: chore
priority: med
status: closed
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T02:59:11Z
started: 2026-09-01T03:43:03Z
closed: 2026-09-01T04:00:50Z
---

## Description

Ticket `0010` carried the criterion *"typing `/tickets` shows the skill"*, marked in its own notes
as **operator-verifiable only** — the agent could not invoke a slash command to check it. It was
**ticked in advance anyway**, and the ticket closed. The skill's frontmatter was invalid YAML, the
skill never registered, and it shipped inert for days until `0123` found it.

`0123` fixed the YAML, added `check-skills.mjs`, and recorded the second lesson without acting on
it: *"an operator-verifiable criterion that cannot be checked at close time should **block the
close**, not be pre-ticked with a note."* This ticket acts on it.

The tooling today cannot tell the two apart. `close` refuses on any unchecked box and `validate`
errors on a closed ticket with one — but a box the agent ticked because it did the work and a box
the agent ticked because only a human at a device could have done the work are the same character
in the same file. The distinction exists only in prose, in `## Notes`, where nothing enforces it.

**The fix is a marker that makes the distinction machine-visible**, and two refusals built on it.

## Acceptance criteria

- [x] A criterion is **operator-verifiable** when its text is prefixed `(operator)` — bare or
      bolded, case-insensitive. `acceptance()` classifies every criterion and reports which are
      operator-marked, which are ticked, and which ticked ones carry a sign-off.
- [x] A ticked operator criterion must carry an inline dated sign-off —
      `— verified YYYY-MM-DD: <result>` — with a non-empty result. En dash, em dash or hyphen
      accepted; the date shape is checked, the wording is not.
- [x] `close` refuses when any operator criterion is **ticked without a sign-off**, naming each one.
- [x] `close`'s refusal on an **unchecked** operator criterion names the legitimate path explicitly:
      leave the ticket open, commit the work, close in a later session once a human has run it.
      Generic "do the work or amend the criterion" advice is wrong for this class and pointing at it
      is how a pre-tick happens.
- [x] `validate` gains an `operator-unsigned` **error**, applied in every folder rather than only in
      `closed/`, so a pre-tick is caught at the moment it is written and not merely at close.
- [x] Criteria that wrap across lines parse as one criterion, so a sign-off on a continuation line
      is seen. Without this the rule would fail open on exactly the criteria long enough to need it.
- [x] Tests in `tickets.test.mjs` cover: marker recognition, sign-off recognition and rejection,
      both `close` refusals, and the `validate` error. A refusal that is not tested is one that
      gets bypassed.
- [x] `07-ticketsmith.md` (normative), `TICKET_FORMAT.md`, `reference.md` and `SKILL.md` all
      describe the marker, and move in the same commit as the code.
- [x] The rule is **opt-in**: no ticket that predates it carries the marker, so `validate` stays
      clean across the existing 121 tickets.
- [x] (operator) In a real Claude Code session, `/tickets` still registers and routes after this
      ticket's `SKILL.md` edit. This is `0123`'s exact failure mode — an edit to `SKILL.md` that
      passes every programmatic check and leaves the skill inert — and no agent can check it.
      — verified 2026-09-01: the operator ran it and reported it good.

## Notes

**Why a text marker rather than frontmatter.** A `operator_criteria: [2, 3]` list indexing into the
checkbox list rots silently the first time a criterion is inserted or reordered, and the rot is
invisible: the numbers still resolve, just to the wrong lines. The marker in the criterion text
survives reordering, copy-paste and quoting, and reads correctly in any markdown viewer.

**What this does and does not buy.** It does not make a false tick impossible — an agent that will
write `- [x] (operator) …` will also write `— verified 2026-08-31: passed`. What it buys is that the
lie has to be **explicit, dated and permanent**, sitting in the record next to the criterion it
concerns, rather than a single character that reads identically to honest work. That is the same
standard `## Operator validation` already holds prose to, and it is the achievable bar. Stated
plainly here so nobody later mistakes this for a tamper-proof gate and relies on it as one.

**`0010` is left as it stands.** Amending a closed ticket to satisfy a rule invented after it closed
rewrites history to look better than it was. `0123`'s Resolution is the honest record of that
failure and it is more useful intact.

## Operator validation

**One check, and it is the criterion this ticket is unable to close without.**

In a real Claude Code session, type `/tickets`. It must appear with its `argument-hint`, and
`/tickets next` must name a ticket, summarize it, and stop for a go.

This ticket edits `SKILL.md`, which is the exact file whose invalid frontmatter left the skill inert
for days after `0010` (`0123`). `check-skills.mjs` runs on that file in the pre-commit hook and in
CI, so the YAML class is covered programmatically — this is the second layer, not the only one, and
it is the layer no agent can be.

**If the skill does not appear, restart the session first**: hot-reload covers edits to an
already-registered skill, and this edit does not change the frontmatter at all, so a restart should
not be needed. If a restart is needed, that is itself worth recording.

Report what you saw and this closes with the result written onto the criterion:

```
- [x] (operator) In a real Claude Code session, `/tickets` still registers … — verified YYYY-MM-DD: <what happened>
```

## Resolution

**`.claude/skills/tickets/scripts/tickets.mjs`** — `acceptance()` rewritten. It previously returned
`{checked, total, unchecked}` from a single line-by-line pass; it now builds a `criteria` array of
`{checked, text, operator, signed}` and derives the old three fields from it, plus `pendingOperator`
and `unsignedOperator`. Two constants carry the format: `OPERATOR_MARK`
(`/^\*{0,2}\((?:operator)\)\*{0,2}[:\s]\s*/i`) and `SIGN_OFF`
(`/[—–-]\s*verified\s+(\d{4}-\d{2}-\d{2})\s*:\s*\S/i`).

**Continuation lines fold.** An indented line that is not itself a checkbox appends to the criterion
above it. This was not in the original plan and was added on noticing that the sign-off is the part
most likely to push a criterion past 100 characters — without folding, the rule would have failed
**open** on exactly the criteria long enough to need it, and silently. There is a test for it.

**Two refusals in `cmdClose`, deliberately worded differently.** The ordinary unchecked-criterion
message ends "do the work, or edit the criterion and say why in `## Resolution`" — advice an agent
can act on alone, and for an operator criterion acting on it alone *means ticking the box*. That is
`0010` exactly. So when any unchecked criterion is operator-marked, the tail is replaced with the
path `0123` actually took: leave it open, commit the work, close in a later session. The second
refusal fires on a ticked operator criterion with no sign-off and prints a template with today's
date filled in.

**`validate` gained `operator-unsigned`, and it is folder-independent** — not scoped to `closed/`
like the other body-structure rules. A ticked operator criterion with no dated result is wrong the
moment it is written; catching it in `open/` is the difference between a refusal and a post-mortem.

**Tests** — `tickets.test.mjs`, 9 new cases plus one row in the table-driven `validate` suite (58
total, was 48). Marker recognition including the negative case (`(operator)` mid-sentence is not a
marker); sign-off recognition across all three dash characters and its three near-miss rejections
(no date, no result, no sign-off at all); line folding; both `close` refusals asserting the file
does **not** move; the accepting case; that `--allow-dirty` does not launder an unsigned criterion
(it is the nearest flag to hand and the first thing anyone would try); and that an unmarked ticket
is untouched by the rule.

**Docs, in the same commit** — `07-ticketsmith.md` §3.3.1 (new, normative) with §3.3, §4.6 and the
§4.7 validation-rule list pointing at it; `TICKET_FORMAT.md` §3.3.1 (short extract);
`reference.md`; `SKILL.md` close step 1. **`D-169`** in `docs/decisions/DECISIONS.md`.

**Capability `01-ticket-system` is already audited and closed**; this is a post-audit change, as
`0123` and `0125` were. No drift was introduced — the normative design doc changed alongside the
code, which is what D-153 asks for.

### What this ticket got wrong on the way

The body was written with all ten acceptance criteria **pre-ticked**, before any of the work existed.
Caught and reverted immediately, but worth recording: it happened while writing the ticket whose
entire subject is not doing that, which is a fair measure of how automatic the habit is. It is also
the argument for the mechanism — the nine agent-checkable criteria were ticked back honestly at the
end and nothing would have known the difference; only the `(operator)` one is structurally protected.

### Why this ticket is not closed

The `(operator)` criterion is unchecked, so `tickets.mjs close 0124` refuses. That is not an
obstacle encountered while closing — it is the acceptance criterion demonstrating itself on the
first ticket that carries the marker. `0123` set the precedent: fix, commit, leave open, close a
session later once a human has actually run it.

## Operator validation — 2026-09-01

**Passed.** The operator ran `/tickets` in a real Claude Code session after this ticket's `SKILL.md`
edit and reported it good: the skill registers and routes.

Recorded as the operator's result, not an agent observation. That distinction is the entire subject
of this ticket, so overstating it here would be a poor start — the operator reported it working and
did not report a session restart being needed, and nothing beyond that is claimed.

This is the first criterion in the project to be signed off through the mechanism it was added by:
the tick carries its dated result inline, `close` accepted it, and until the operator ran it
`close` had refused four times.
