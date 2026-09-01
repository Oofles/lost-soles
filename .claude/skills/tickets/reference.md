# /tickets — reference

Loaded **on demand**, not every session. `SKILL.md` points here by path; there is no `@file` import
(those work only in `CLAUDE.md`).

Normative source: `docs/07-ticketsmith.md` §3 and §4. `docs/TICKET_FORMAT.md` is the short extract.
**If this file and 07-ticketsmith disagree, 07-ticketsmith wins and both change in one commit.**

---

## Ticket format, in brief

```yaml
---
id: 42                      # int, agent-allocated ONLY. Filename is zero-padded: 0042-slug.md
slug: kebab-case            # ^[a-z0-9]+(-[a-z0-9]+)*$ — immutable once assigned
title: Human readable       # max 200 chars
type: feature               # feature | bug | design | chore | refactor | docs
priority: high              # high | med | low
status: open                # inbox | open | blocked | closed  (mirrors the folder)
size: m                     # s <30min | m 30min-2h (TARGET) | l = too big, SPLIT IT
capability: 04-domain-contract-and-rules   # or null; matches docs/capabilities/NN-name.md
depends_on: [38]            # PLANNED constraints, set at ticket-write time
blocked_by: []              # DISCOVERED constraints, set mid-session. Non-empty ⇒ status: blocked
source: agent               # ui (phone capture) | agent (filed by Claude) | operator (typed)
created: 2026-08-30T00:00:00Z
started: …                  # stamped by `start`, omitted until then
closed: …                   # stamped by `close`, omitted while open
---
```

**Required body sections, all tickets:** `## Description` · `## Acceptance criteria` (checkboxes) ·
`## Notes` · `## Operator validation`.
**A criterion only a human can check is prefixed `(operator)`** — see below.
**`bug` also needs:** `## Steps to reproduce` · `## Expected vs actual`.
**`design` also needs:** `## Options considered` · `## Open questions` — and its acceptance criteria
read *"a capability doc exists at `docs/capabilities/NN-x.md` with no open questions"*, never "the
feature works".
**Appended at close:** `## Resolution` · `## Operator validation` result.

### `(operator)` criteria (§3.3.1)

```markdown
- [ ] (operator) Typing `/tickets` shows the skill with its `argument-hint`
- [x] (operator) Ran it on the Pixel — verified 2026-08-31: passed, no restart needed
```

The marker means *no agent can check this*. Two refusals hang off it:

- **Unchecked** → `close` refuses and tells you to leave the ticket open, commit the work, and close
  it in a later session once the operator has run it. **Do not tick it to make the close pass.**
  Ticket `0123` did it the honest way and closed a session later; `0010` pre-ticked and shipped a
  skill that never registered.
- **Ticked with no `— verified YYYY-MM-DD: <result>`** → `close` refuses, and `validate` errors in
  every folder. The evidence lives on the criterion, not only in `## Operator validation` prose.

Relaying an operator's reported result *is* the sign-off — write what they saw, dated, in their
words where you have them. Inventing one is the failure this whole mechanism exists to prevent.

### `depends_on` vs `blocked_by`

The distinction is worth preserving. `depends_on` is *"we planned this order"*; `blocked_by` is
*"we hit a wall"*. Collapsing them loses exactly the information a REFLECT step wants — which
orderings were foreseen and which were discovered the hard way.

---

## The mechanical / judgemental split (§4.7)

| The script decides | You decide |
|---|---|
| Which tickets are ready | Whether a ticket is worth doing now |
| The dependency order | What a ticket actually means |
| Whether a criterion box is ticked | Whether the criterion is genuinely **met** |
| Whether required sections exist | What belongs in them |
| Id allocation, file moves, index | Acceptance criteria, approach, resolution text |
| Cycles, dangling refs, enum violations | Whether a design doc is wrong |

**Never spend tokens re-deriving something the script computes.** Reading every open ticket to work
out an order is an O(n) context tax paid every session, produces a slightly different answer each
time, and degrades silently as the backlog grows. That is why `depends_on` is a field.

---

## Full close procedure (§4.6)

**Refuse first, then act.**

1. **Verify every acceptance criterion is genuinely met.** The script refuses on any unchecked box
   and there is **no `--force`**. Do not tick a box on the ticket's behalf.
   - If a criterion is genuinely unbuildable or turned out wrong: amend it, mark it with a
     strikethrough and the reason, and explain in `## Resolution`. A criterion that was silently
     ticked is a criterion that never existed.
   - **`(operator)` criteria are not yours to tick.** An unchecked one means the ticket does not
     close today — that is the rule working, not an obstacle. Amending it away is the same failure
     as ticking it.
2. **`## Resolution`** — files touched, tests added, decisions and rationale, what went wrong.
   The honest record of what happened, not what was planned.
3. **`## Operator validation`** — concrete checks. **Name a screen and a device** for anything
   visual. For Lost Soles this frequently means *going for an actual run with the build on the
   phone*; the defects that matter (a shimmering fog edge, a banner 4px off, a map unreadable in
   sunlight) pass every automated test.
4. **New decisions** → append `D-xxx` to `docs/decisions/DECISIONS.md`.
   **Never edit a settled decision to make a ticket easier.** Supersede it visibly.
5. **`tickets.mjs close <id>`** — status, `closed:` stamp, `git mv`, index regenerated.
   Refuses on a dirty tree (D-158); it exempts the ticket's own file, so ticking a final criterion
   is fine, but unrelated dirt is not. Commit that first rather than using `--allow-dirty`.
6. **Commit on its own**: `tickets(#NNNN): <title>`. Then push (D-150).
7. **Report which tickets became ready** — the script prints them. This is the handoff.

---

## Script commands

`SCRIPT` = `node ${CLAUDE_PROJECT_DIR}/.claude/skills/tickets/scripts/tickets.mjs`

```
SCRIPT index                          rebuild tickets/index.json (committed, D-159)
SCRIPT list [--status --type --priority --capability --size --ready]
SCRIPT show <id>                      raw markdown + deps resolved to title/status
SCRIPT validate                       exit 1 on errors, 0 on warnings only
SCRIPT next [--all]                   ready set; single form refuses size:l
SCRIPT allocate                       next free id
SCRIPT create --title "…" --type … --priority … [--size --capability --slug --depends --source]
SCRIPT start <id>
SCRIPT block <id> --on <id> [--reason "…"]      refuses cycles and unknown ids
SCRIPT unblock <id> --on <id>
SCRIPT close <id> [--allow-dirty]
SCRIPT triage-move <path> --slug <kebab> [--capability --size] [--allow-dirty]
```

`--json` on `index`, `list`, `show`, `validate`, `next`, `create`.

**Ready set:**
```
ready(T) ⟺ status ∈ {open, blocked} ∧ blocked_by = [] ∧ ∀d ∈ depends_on : ticket(d).status = closed
order: priority (high > med > low) → id ascending
```
A non-empty `blocked_by` is **never** ready, regardless of `depends_on`.

---

## Validation rules

**Errors (exit 1):** missing/unparseable frontmatter · missing required field · enum violation ·
`id`/`slug` not matching the filename · duplicate id · status disagreeing with the folder ·
`blocked_by` non-empty without `status: blocked` (or vice versa) · dangling `depends_on`/`blocked_by`
id · self-edge · dependency cycle · `closed:` present when open or absent when closed · closed
ticket missing `## Resolution` · closed ticket with an unchecked criterion · an `(operator)`
criterion ticked with no dated sign-off (any folder) · **any `open/` or `closed/` ticket missing one
of the four required body sections** · `bug` missing its extra sections · `design` missing its extra
sections. **Inbox items are exempt from every section rule** — they are free-form captures (§2.3),
so a `type: bug` captured on a phone never fails validation.

A ticket promoted by `triage-move` therefore fails `validate` until its sections are written. That
is deliberate (D-170): a promoted capture is not yet a ticket, and the error is the gate. Finish the
triage before committing.

**Warnings (exit 0):** `capability: null` on a `feature` · `size: l` in the ready set · a
`capability` with no matching doc · inbox item older than 14 days · unknown frontmatter key
(preserved on rewrite, never dropped).

---

## Inbox capture format

Deliberately degenerate — everything the phone can plausibly know, and nothing else:

```yaml
---
status: inbox
title: streak freeze after 7 days?
type: feature
priority: med
source: ui
created: 2026-08-30T14:32:00Z
---

## Description

Idea from the 10k this morning — missing one day shouldn't nuke a 40-day streak.
```

No `id`, no `slug`, no `size`, no `capability`, no acceptance criteria. **Triage supplies those.**
Filename: `2026-08-30T1432-streak-freeze-after-7-days.md`.

**Never seed the inbox.** An inbox that starts full teaches the operator to ignore it.
