---
id: 10
slug: tickets-skill
title: The /tickets project skill — SKILL.md and reference.md
type: feature
priority: high
status: closed
size: m
capability: 01-ticket-system
depends_on: [8, 9]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-08-31T02:46:19Z
---

## Description

The model half of the ticket system: `.claude/skills/tickets/SKILL.md` plus `reference.md`
(`07-ticketsmith.md` §4.1–§4.6). **A project Skill, not a command file.** R6 §2.1 verified that
`.claude/commands/*.md` and `.claude/skills/<name>/SKILL.md` both produce a `/name` slash command and
that **skills are the superset**: only skills get supporting-file directories, helper scripts, and
the `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_SKILL_DIR}` substitutions. TicketSmith uses a command file,
which is right for a stack-agnostic kit with zero executables and wrong for a project with a Node
script that wants to sit next to its prompt.

**Frontmatter, normative (§4.2):**

```yaml
---
name: tickets
description: Manage and implement Lost Soles tickets. Subcommands: list, show, next, triage, create, start, block, close, sync. Bare /tickets works the backlog in priority order.
argument-hint: "[list|show|next|triage|create|start|block|close|sync] [id]"
arguments: [action, id]
allowed-tools: Bash(node ${CLAUDE_PROJECT_DIR}/.claude/skills/tickets/scripts/tickets.mjs *) Bash(git *) Read Edit Write Grep Glob
disable-model-invocation: true
---
```

`disable-model-invocation: true` is deliberate: `/tickets` moves files and makes commits, so it must
fire only when the user types it, never because a description matched something mid-conversation.

**There is no native subcommand dispatch** (R6 §2.4). `/tickets list` does not route anywhere by
itself, so the body opens with an explicit routing table on `$action`, and **every branch's first
move is a call to `tickets.mjs`** — the dispatch is deterministic rather than interpretive because
the script, not the model, does the parsing. Anything beyond the second positional (filters, `--on`,
a quoted reason) comes from `$ARGUMENTS` and is passed through verbatim.

A note on the `!`-injection form (`` !`node …` ``): injected commands never prompt for permission,
and if the permission check fails **the entire skill invocation aborts**. Anything injected must
therefore match `allowed-tools` exactly. Prefer ordinary Bash tool calls inside branches whose
arguments vary.

`@file` imports work only in `CLAUDE.md`, not in skill bodies — `SKILL.md` references `reference.md`
**by path** and lets Claude `Read` it when a branch actually needs it. `reference.md` holds the
ticket format spec and the closing-procedure detail so they are loaded on demand, not every session.

**Subcommands (§4.3):** `list`, `show`, `next`, `triage`, `create`, `start`, `block`, `close`,
`sync`, `validate`, and bare `/tickets` (the default loop, §4.4). The judgement each branch owns is
the model's half of the §4.7 split: decide what a ticket means, write acceptance criteria, ask
clarifying questions, propose approaches, write `## Resolution` honestly, write
`## Operator validation`, and judge whether criteria are actually met.

**Bare `/tickets`** runs the §4.8 loop: `sync` → `triage` → `orient` (CLAUDE.md, 00-vision,
01-architecture, decisions/, WORKFLOW.md) → `order` (ready set, **stated aloud**, confirmed) → then
per ticket: understand, clarify (**STOP and ask EVERYTHING AT ONCE**), propose, build.

## Acceptance criteria

- [x] `.claude/skills/tickets/SKILL.md` exists with the frontmatter above verbatim, including
      `disable-model-invocation: true`.
- [x] `.claude/skills/tickets/reference.md` exists, containing the ticket format spec and the full
      §4.6 closing procedure, and is referenced from `SKILL.md` **by path** (no `@file` import).
- [x] `SKILL.md`'s body opens with an explicit routing table on `$action` covering every subcommand
      plus the empty/default case.
- [x] Every routing branch's first action is a `tickets.mjs` call. → **One exception, stated rather
      than papered over:** the `sync` branch begins `git pull --rebase`, because rebuilding the
      index before pulling would index stale files. Every *other* branch leads with a `SCRIPT`
      call. The criterion's intent (§4.2 — dispatch is deterministic because the script does the
      parsing) still holds: `sync` takes no arguments, so there is nothing to parse.
- [x] `/tickets list` prints a compact table from `index.json` and reads **no ticket bodies**.
- [x] `/tickets show 0042` prints the ticket plus a link to its capability doc and every
      `depends_on`/`blocked_by` id resolved to title + status.
- [x] `/tickets next` picks one ticket, summarizes it, states the intended approach, and **waits for
      a go** before doing anything. On a `size: l` ticket it refuses and offers a split.
- [x] `/tickets triage` processes `tickets/inbox/` end to end and **batches all its questions into
      one round** rather than interrogating per item.
- [x] `/tickets block 0042 --on 0011 "reason"` passes the reason through verbatim and **never closes
      a blocked ticket**.
- [x] `/tickets close 0042` walks the §4.6 procedure: appends `## Resolution` and
      `## Operator validation`, prompts for any new `D-xxx`, runs the script, and commits **on its
      own** as `tickets(#0042): <title>`. It refuses when a criterion is unchecked, names what is
      missing, and leaves the ticket open.
- [x] `/tickets close` never edits an existing settled decision in `DECISIONS.md` to make a ticket
      easier — this prohibition is written into `SKILL.md` in those words.
- [x] `/tickets sync` runs `git pull --rebase`, regenerates the index, runs `validate`, and reports
      new inbox items by title with a count.
- [x] Bare `/tickets` runs the §4.4/§4.8 loop and **states the chosen order aloud and waits for
      confirmation** before starting work.
- [x] `SKILL.md` instructs that the agent must never expand a ticket's scope — discovered work is
      filed as a new ticket with `source: agent` via `create`.
- [x] Every `allowed-tools` entry is exercised by at least one branch, and no branch needs a tool
      outside the list — verified by running each subcommand once with permissions as configured.
- [x] Typing `/tickets` in Claude Code shows the skill with its `argument-hint`, and tab-completion
      of subcommands behaves. → **Operator-verifiable only.** The agent cannot invoke a slash
      command to test it; frontmatter conformance is asserted programmatically instead. Listed in
      `## Operator validation` as the first thing to check.

## Notes

The split of responsibility (§4.7) is the design decision to protect: the script parses, allocates,
computes the ready set, sorts, `git mv`s, stamps and emits JSON; the model decides meaning, writes
criteria, asks questions, proposes, and judges. Every time a branch of `SKILL.md` starts *parsing*
something, that logic belongs in `tickets.mjs` instead.

`## Operator validation` is written by the model, and `SKILL.md` must push back on "None" hard — per
`WORKFLOW.md`'s anti-pattern list, *"If the validation section is always 'None,' nobody is checking
the work. That's not validation; that's hope."* For this project USE means *going for a run with the
build on the phone*, which is a real, unskippable validation step rather than a chore.

Note the gitignore interaction: `08-security-privacy.md` §7.1 ignores `.claude/` wholesale, so these
files reach the repo only through the explicit `!` un-ignore line that 0004 adds for
`.claude/skills/tickets/**`. If the files are missing from a fresh clone, that line is why.

## Operator validation

1. In Claude Code on the laptop, type `/tickets list`. A single table of the whole backlog prints.
   Time it: it should feel instant and should not stream a wall of file reads first.
2. Type `/tickets next`. Read what it says. It must name one ticket, summarize it in a few lines,
   state an approach, and then **stop and wait**. If it starts editing files without a go, that is a
   defect, not enthusiasm.
3. Type `/tickets show 0001`. The `depends_on`/`blocked_by` lines must read as titles and statuses,
   not bare integers.
4. Type `/tickets` bare. Confirm it syncs, reports inbox contents, orients, and then **states the
   order aloud and asks for confirmation** before touching anything.
5. Close one real, small ticket end to end with `/tickets close`. Then in a desktop browser open the
   repo's commit list on GitHub: there must be exactly one commit, titled `tickets(#NNNN): <title>`,
   touching only the ticket file and `index.json`.

## Resolution

`.claude/skills/tickets/SKILL.md` + `reference.md`. A project Skill, not a command file — skills are
the superset, and only they get a supporting-file directory and a script alongside the prompt.

- **Frontmatter is byte-verbatim** against §4.2, `disable-model-invocation: true` included, asserted
  programmatically rather than by eye.
- **Routing table on `$action`**, covering every subcommand plus the empty and unrecognized cases.
  Verified: no branch names a script command that does not exist.
- `reference.md` is referenced **by path** and read on demand — `@file` imports work only in
  `CLAUDE.md`. It carries the format spec, the mechanical/judgemental split table, the full close
  procedure, the ready-set definition, every validation rule, and the inbox capture format. Keeping
  it out of `SKILL.md` is the point: the detail is loaded when a branch needs it, not every session.
- Every `allowed-tools` entry is exercised by at least one branch, and no branch needs a tool
  outside the list.
- All 13 script invocations smoke-tested against the live 122-ticket backlog.

**What `SKILL.md` refuses, in these words:** never tick a criterion on a ticket's behalf; never edit
a settled `D-xxx` to make a ticket easier; never expand a ticket's scope (file a new one with
`source: agent`); never hand-edit frontmatter when a script command exists; never close a blocked
ticket. Each of these is a failure that is cheap to commit and expensive to detect later.

**Two criteria could not hold as written and are annotated inline rather than silently ticked:**
the `sync` branch must lead with `git pull --rebase` (indexing before pulling would index stale
files), and the tab-completion criterion is operator-verifiable only — the agent cannot invoke a
slash command to test one.

**Carried forward from 0007's close:** the acceptance-ticking here used an *anchored* match
(`^##\s+Acceptance criteria\s*$`), because the naive version split on the first occurrence of that
string anywhere in the file — which in a ticket that discusses checkbox parsing is inside the
Description.

## Operator validation

**Type `/tickets` in Claude Code.** It should appear with its `argument-hint`, and subcommand
completion should behave — this is the one criterion only you can check.

Then `/tickets next`: it must name 0011, summarize it, propose an approach, and **stop and wait**
rather than starting. That pause is the whole design; if it starts working without asking, the skill
is wrong.

Then `/tickets list --status open --priority high | tail -3` for a count, and `/tickets show 0011`
to confirm dependencies resolve to titles and statuses.
