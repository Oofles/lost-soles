# 01-ticket-system

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`01-ticket-system\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (6)

- `0007` — tickets.mjs — frontmatter parse, index.json generation, list, and the validator
- `0008` — tickets.mjs — allocate, create, start, block, unblock, close, triage-move
- `0009` — Dependency resolution, the ready set, `next`, and cycle detection
- `0010` — The /tickets project skill — SKILL.md and reference.md
- `0011` — Validate the entire hand-authored backlog and fix everything it finds
- `0121` — /tickets audit — run the capability close audit and refuse to advance until it passes

## Verified 2026-08-30 — skills ARE user-invokable

Operator challenged the choice of a Skill over a command file, on the reasonable belief that only
`.claude/commands/*.md` produces a user-typable slash command. **Checked against current official
docs; the Skill is correct.** Recorded so this is not re-litigated.

> "Custom commands have been merged into skills. A file at `.claude/commands/deploy.md` and a skill
> at `.claude/skills/deploy/SKILL.md` both create `/deploy` and work the same way."

- Skills and command files have **converged**. Both create `/name`. The distinction is structural,
  not functional — and only skills get a supporting-file directory and a script beside the prompt,
  which is why this project uses one and TicketSmith (zero executables) does not.
- **`disable-model-invocation: true`** = user-invocable only. `/tickets` still types; Claude cannot
  auto-fire it. Exactly the intent: this skill moves files and makes commits.
- `argument-hint`, `arguments`, `allowed-tools` are all valid skill frontmatter, and
  `$1` / `$2` / `$ARGUMENTS` substitute in a skill body as in a command file.
- `${CLAUDE_PROJECT_DIR}` **does** substitute inside `allowed-tools` — load-bearing, since a
  permission rule that failed to match would abort the whole invocation.
- **A skill and a same-named command file collide, and the skill wins.** So adding
  `.claude/commands/tickets.md` as a fallback would be dead code, not a safety net. Do not add one.

Corroborating local evidence: the operator's own `~/.claude/skills/openscad/SKILL.md` already uses
`disable-model-invocation: true` **with** an `argument-hint` — a combination that is only coherent
if the skill is typed. Claude Code version here is 2.1.251.

**Possible simplification, not taken:** `${CLAUDE_SKILL_DIR}/scripts/tickets.mjs` is shorter and
more robust than the full `${CLAUDE_PROJECT_DIR}/.claude/skills/tickets/...` path. Not changed,
because 0010 required the frontmatter be verbatim from `07-ticketsmith.md` §4.2 — diverging from a
spec to save characters is how docs and code drift apart. Changing it means changing both, in one
commit.

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

