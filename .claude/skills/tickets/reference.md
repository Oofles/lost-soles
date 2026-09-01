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
status: open                # inbox | open | blocked | deferred | closed  (mirrors the folder)
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

### `blocked` vs `deferred`

**`blocked` is waiting on a ticket in this backlog; `deferred` is waiting on the world** (D-174).
Closing the blocker clears a `blocked` automatically and `blocked_by` names it. Nothing here can
clear a `deferred` — there is no ticket id for "npm fixes its bundled tarballs" — so it carries a
mandatory reason and a mandatory runnable re-check in a `## Deferred` section instead, both enforced
by `validate`. A deferred ticket is out of the ready set and out of its capability's
`capability-tickets-closed` check, but is **named** in the audit record: a capability that passed
with deferrals must not read as one that passed clean.

`recheck` runs the re-checks and reports. It never un-defers — `resume` is typed by someone who read
the result. If you want to file a placeholder ticket just so `blocked_by` has something to hold, the
state you want is `deferred`.

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
SCRIPT create --title "…" --type … --priority … [--size --capability --slug --depends --source --body]
SCRIPT start <id>
SCRIPT block <id> --on <id> [--reason "…"]      refuses cycles and unknown ids
SCRIPT unblock <id> --on <id>
SCRIPT defer <id> --reason "…" --recheck "<shell>"   external wait; --recheck-file <path> also works
SCRIPT resume <id> [--reason "…"]                    leaves the state; never automatic
SCRIPT recheck [<id>]                                runs deferred re-checks and REPORTS; exits 0 either way
SCRIPT close <id> [--allow-dirty]
SCRIPT triage-move <path> --slug <kebab> [--capability --size] [--allow-dirty]
SCRIPT audit <capability>             AUDIT.md mechanical checks; exit 1 on any failure
SCRIPT audit <capability> --sections  design-doc sections this capability's tickets cite (§2 reading list)
SCRIPT audit <capability> --record [--divergence "res|ref|desc"]... [--no-divergences] [--force "reason"]
```

`--json` on `index`, `list`, `show`, `validate`, `next`, `create`, `audit`, `recheck`.

### `audit` and the three verdicts

`audit <capability>` reports each check as `pass`, `fail` or **`n/a` with a reason naming what would
make it applicable** (D-171). Most of `AUDIT.md` targets code that does not exist yet — no Vigil
test, no fog blob, no ledger — and an `n/a` is how the audit says *could not check* without it
reading as *checked*. `n/a` never fails the run; a missing reason is a bug.

**The bare form runs the mechanical half only** and records nothing. §2 design conformance and §3
operator validation are yours — `SKILL.md`'s audit procedure drives them.

**`--record` writes the result** to `docs/capabilities/NN-name.md` as a human-readable write-up plus
a one-line `<!-- audit-record {…} -->` comment the script reads back (D-172). It refuses unless:

- every mechanical check passed;
- the divergence list is **asserted** — one `--divergence "<code-was-wrong|design-was-wrong>|<ref>|<description>"`
  per finding, or `--no-divergences`. Omitting it is refused: a §2 that found nothing and a §2 that
  never ran must not be indistinguishable;
- there are **no more than three** divergences (over budget ⇒ the design is stale, run a DESIGN
  session);
- the capability's REFLECT section has actual substance — the heading alone is not enough, since
  every capability doc ships with it holding a placeholder.

`--force "<reason>"` overrides and records `verdict: forced`, never `pass`, with the reason in the
doc. Records are append-only; a re-audit adds a line and the last one stands.

**Ready set:**
```
ready(T) ⟺ status ∈ {open, blocked} ∧ blocked_by = [] ∧ ∀d ∈ depends_on : ticket(d).status = closed
order: priority (high > med > low) → id ascending
```
A non-empty `blocked_by` is **never** ready, regardless of `depends_on`.

**The capability gate is a `next` refusal, not a readiness rule** (D-173) — same placement as the
`size: l` refusal (D-161). A ticket in capability `C` (where `C ≥ 02`) is **gated** while any
lower-numbered capability that has tickets has not recorded a passing or forced audit. `next` hands
over the best *ungated* ticket and says how many were gated; if every ready ticket is gated it
refuses and names the **earliest** unaudited capability, which is the one that can actually be
audited next. `next --all` lists everything, gated entries marked — the gate refuses to hand over
work, it does not hide the backlog.

---

## Validation rules

**Errors (exit 1):** missing/unparseable frontmatter · missing required field · enum violation ·
`id`/`slug` not matching the filename · duplicate id · status disagreeing with the folder ·
`blocked_by` non-empty without `status: blocked` (or vice versa) · dangling `depends_on`/`blocked_by`
id · self-edge · dependency cycle · `closed:` present when open or absent when closed · closed
ticket missing `## Resolution` · closed ticket with an unchecked criterion · an `(operator)`
criterion ticked with no dated sign-off (any folder) · **any `open/` or `closed/` ticket missing one
of the four required body sections** · `bug` missing its extra sections · `design` missing its extra
sections · a `deferred` ticket with no `## Deferred` section, no `**Reason:**` line, or no fenced
re-check block · a `deferred:` stamp whose status is not `deferred` (or vice versa).
**Inbox items are exempt from every section rule** — they are free-form captures (§2.3),
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
