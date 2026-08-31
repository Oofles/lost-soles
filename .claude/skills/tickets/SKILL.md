---
name: tickets
description: >
  Manage and implement Lost Soles tickets. Subcommands: list, show, next, triage,
  create, start, block, close, sync. Bare /tickets works the backlog in priority order.
argument-hint: "[list|show|next|triage|create|start|block|close|sync] [id]"
arguments: [action, id]
allowed-tools: "Bash(node ${CLAUDE_PROJECT_DIR}/.claude/skills/tickets/scripts/tickets.mjs *), Bash(git *), Read, Edit, Write, Grep, Glob"
disable-model-invocation: true
---

# /tickets

`$1` is the action, `$2` is usually a ticket id. Everything after them is in `$ARGUMENTS` and is
passed through **verbatim** — never re-interpret a quoted reason or a filter flag.

**The split that governs every branch below:** the script does everything MECHANICAL — parsing,
id allocation, dependency resolution, file moves, validation, the close preconditions. You do
everything JUDGEMENTAL — what a ticket means, whether the work is genuinely done, what to write in
`## Resolution`, which questions to ask. **Never re-derive by reading what the script can tell you
by running.** Reading 100 ticket bodies to work out an order is the exact tax this system exists to
remove.

`SCRIPT` below means `node ${CLAUDE_PROJECT_DIR}/.claude/skills/tickets/scripts/tickets.mjs`.

## Routing

Dispatch on `$1`. **Every branch's first action is a `SCRIPT` call** — there is no native
subcommand dispatch, so this table is the dispatch.

| `$1` | First action | Then |
|---|---|---|
| *(empty)* | `SCRIPT sync`-equivalent, then `SCRIPT next --all --json` | The default loop, below |
| `list` | `SCRIPT list $ARGUMENTS` | Print the table. Nothing else. |
| `show` | `SCRIPT show $2` | Add the capability doc link; read the body only if asked to explain it |
| `next` | `SCRIPT next --json` | Summarize, propose an approach, **wait for a go** |
| `triage` | `SCRIPT list --status inbox --json` | The triage procedure, below |
| `create` | `SCRIPT create --title "…" --type … --priority …` | Confirm the path it printed |
| `start` | `SCRIPT start $2` | Then work it |
| `block` | `SCRIPT block $2 --on <id> --reason "…"` | Report; **never close a blocked ticket** |
| `unblock` | `SCRIPT unblock $2 --on <id>` | Report the resulting status |
| `close` | **Read `reference.md` first**, then the close procedure | See below |
| `validate` | `SCRIPT validate` | Report errors verbatim; fix or file, do not silence |
| `sync` | `git pull --rebase`, then `SCRIPT index`, then `SCRIPT validate` | Report new inbox items by title, with a count |
| anything else | `SCRIPT` (prints usage) | Say which actions exist |

## `next`

`SCRIPT next --json` picks the ticket — highest priority in the ready set, ties by lowest id. Do not
second-guess it; if it picked something surprising, `SCRIPT show <id>` explains why.

Then: summarize the ticket in two or three sentences, **state the approach you intend to take**, and
**wait for a go before touching anything.** This is the operator's cheapest chance to redirect.

If the script refuses because the ticket is `size: l`, do not work around it. Offer a concrete split
into two or three tickets with proposed titles, and create them with `SCRIPT create` once agreed.
`size: l` is a smell recorded honestly, not a valid plan.

## `triage`

Process every file in `tickets/inbox/` end to end.

**Batch every question into one round.** Read all the inbox items first, then ask everything you
need about all of them in a single message. Interrogating item by item is what makes triage feel
like a chore, and a triage that feels like a chore stops happening — which is how the inbox rots.

For each item decide, with the operator: promote (→ `SCRIPT triage-move <path> --slug <kebab>
--capability <NN-name> --size <s|m|l>`), merge into an existing ticket, or discard. A thought at
mile six is a note; it becomes a ticket when someone decides it should.

**Only the agent allocates ids.** The phone never does. That is what keeps numbering single-writer
and merge conflicts structurally impossible — do not hand-number anything.

## `close`

**Read `.claude/skills/tickets/reference.md` before closing anything.** It carries the full
procedure and the format spec.

Refuse first, then act:

1. **Verify every acceptance criterion is genuinely met.** The script refuses on any unchecked box,
   and there is no `--force`. **Do not tick a box on the ticket's behalf to make the close pass.**
   If a criterion turned out to be wrong or unbuildable, say so in `## Resolution`, amend the
   criterion, and explain why — that is a finding worth recording, not an obstacle to route around.
2. Append `## Resolution` — files touched, tests added, decisions and their rationale. **The honest
   record of what happened, not what was planned.** Include what went wrong; a Resolution that reads
   as though everything worked first time is a Resolution nobody will trust later.
3. Append `## Operator validation` — concrete manual checks, naming **a screen and a device** for
   anything visual. "None" is permitted only for genuinely invisible infrastructure, and even then
   say why.
4. If a real architectural decision was made, add a `D-xxx` to `docs/decisions/DECISIONS.md`.
   **Never edit an existing settled decision to make a ticket easier.** Supersede it explicitly,
   with the reasoning, so the change is visible.
5. `SCRIPT close <id>` — sets status, stamps `closed:`, `git mv`s, regenerates the index.
   It refuses on a dirty tree (D-158); commit unrelated work first rather than reaching for
   `--allow-dirty`.
6. **Commit on its own**: `tickets(#NNNN): <title>`, then push (D-150).
7. The script reports which tickets just became ready. **Say so** — that is the handoff to the next
   session.

## Bare `/tickets` — the default loop

1. **Orient.** `CLAUDE.md` → `docs/00-vision.md` → `docs/01-architecture.md` →
   `docs/decisions/DECISIONS.md` → `docs/capabilities/WORKFLOW.md`. If any is missing or visibly
   stale, **raise it before starting work.** Note this project uses a `docs/decisions/` *directory*.
2. **Sync.** `git pull --rebase`, `SCRIPT index`, `SCRIPT validate`. Report new inbox arrivals.
3. **Triage** if the inbox is non-empty.
4. **Order.** `SCRIPT next --all --json`. **State the proposed order and your reasoning aloud, then
   wait for confirmation.**
5. **Work tickets**: understand → clarify → propose → build → close.
   **Clarify means STOP and ask EVERYTHING AT ONCE**, before writing any code. Questions dribbled
   out one at a time across a session cost far more than one round up front.
6. **Stop** on any of: backlog empty · **~60% context used** (finish the current ticket cleanly,
   then stop) · blocked with nothing ready · a test failure revealing a deeper problem (file a
   ticket, stop) · operator interrupt.
7. **Session summary**, in this fixed format:
   - Tickets closed
   - Tickets in progress
   - New tickets filed
   - **★ OPERATOR VALIDATION REQUIRED ★** — the consolidated checklist across every ticket closed
     this session. This is the most important part of the summary.
   - Recommended next session

## Standing rules

- **Never expand a ticket's scope.** Discovered work becomes a new ticket via
  `SCRIPT create … --source agent`. A ticket that grows while being worked cannot be estimated,
  reviewed, or honestly closed.
- **Never edit a settled `D-xxx` to make a ticket easier.** Supersede it visibly instead.
- **Never hand-edit ticket frontmatter** when a `SCRIPT` command exists for it — the script
  maintains `index.json`, enforces preconditions, and `git mv`s so history follows the file.
- **Ask when the plan does not cover it** (D-152). If acceptance criteria do not settle a question,
  or the design turns out to be wrong, stop and ask. A wrong design doc is a finding, not an
  obstacle.
- **A capability closes with its drift audit** (D-153, `docs/capabilities/AUDIT.md`) before the next
  one starts.
