# R6 — TicketSmith: Findings and Adaptation Proposal for Lost Soles

*Research brief, planning phase. Written 2026-08-30.*

**Source repository status: PUBLIC AND ACCESSIBLE.** `https://github.com/Oofles/ticketsmith` was cloned successfully (MIT, single commit `e3338fe` "Restructure flat repo into docs/templates/prompts layout"). Everything in Part 1 below is quoted or paraphrased from the actual repository contents — nothing is inferred or invented.

---

## Part 1 — What TicketSmith is

### 1.1 The problem it solves

TicketSmith's own framing (from `README.md` and `docs/METHODOLOGY.md`): long AI-assisted projects have a **coherence problem**. Every session starts with an empty context window, so the assistant re-derives everything from whatever happens to be visible. This fails in five named ways:

- **Scope creep** — the AI sees adjacent code and helpfully extends it; a 50-line ticket becomes 300.
- **Doc/code drift** — the README says one thing, the code does another; future sessions trust whichever they hit first.
- **Re-litigated decisions** — a choice made three months ago for good reasons gets proposed for reversal because nobody remembers the reasons.
- **Premature abstraction** — a generalization built for a second use case that doesn't exist yet, which then doesn't fit the real second use case.
- **Conversation-as-state** — shared context accumulates in a long chat and evaporates on `/clear`.

Its thesis: *"The artifacts of work outlive any single session. Every new session reads the artifacts, not the conversation history."*

The methodology was extracted from **Cyclopean Codex**, the author's personal CTF automation framework, which reportedly survived 30+ implementation sessions without architectural drift.

### 1.2 Core concept

TicketSmith is explicitly **a methodology kit, not a tool**. There is no code, no CLI, no binary, no dependency manifest — every file in the repo is Markdown. It is a set of prompts, templates and conventions that an AI installs into a target project. Its five disciplines:

1. **Design before tickets, tickets before code.** Each *capability* gets a design doc before a single ticket is filed; tickets are filed before a line is written. "Tickets do not invent scope; they implement scope."
2. **Ask first, code second.** Read constraints, batch clarifying questions (never drip them), propose before implementing anything non-obvious. "This is slow. The slowness is the value."
3. **Disk is the source of truth.** *"Nothing lives only in conversation. Nothing lives only in a database."* — this is the sentence that Part 3 has to reckon with.
4. **Don't design ahead.** Roadmaps *pick* the next capability; they don't *design* it. "A capability roadmap that's six months ahead of where you are is mostly fiction."
5. **Reality grounds design.** Every capability ships through DESIGN → TICKET-WRITE → BUILD → USE → REFLECT. Steps 4 and 5 are called out as the most-skipped and most important.

The kit is deliberately opinionated and says so: *"changes that compromise the opinionation are likely to be declined."*

### 1.3 The unit of work: capabilities, not epics

TicketSmith's grouping construct is a **capability**, defined in `templates/docs/capabilities/WORKFLOW.md` as "a coherent operator-facing change." A good capability:

- is described in one sentence of operator-visible change,
- is designable in a single focused session,
- decomposes into **3–8 tickets**,
- ships in one or two `/tickets` runs,
- is useful on its own even if nothing else follows.

("User authentication" qualifies; "add a button" is a ticket; "make the project better" is a wish.)

Capability docs live at `docs/capabilities/NN-name.md` and carry a `Status:` line with five states: **draft → in-design → tickets-generated → building → shipped**. A shipped doc is historical record and isn't edited for style afterwards; revisions get a *new* capability doc that references the old one.

The capability doc template (`templates/docs/capabilities/TEMPLATE.md`) has fixed sections: What and why · User-facing changes · Architectural impact · New abstractions · Data model changes · API surface changes · UI changes · **Out of scope** · Open questions · Tickets · Acceptance for the capability as a whole · Dependencies · Notes from implementation (appended post-ship).

### 1.4 Ticket storage and indexing

Verbatim from `README.md`: *"Tickets are markdown files on disk. No database, no GitHub Issues, no Jira. Disk is the source of truth."*

- `tickets/open/` — active tickets
- `tickets/closed/` — resolved tickets, **never deleted**

Filename: `NNNN-slug.md`, where `NNNN` is a **four-digit zero-padded sequential integer** that does *not* reset between open and closed, and `slug` is kebab-case and **immutable once assigned** (the title may be edited; the slug never is, because filenames get referenced in commits and conversations). Closing **moves** the file from `open/` to `closed/`; the filename is unchanged.

**There is no index.** No database, no cache, no generated manifest. Discovery is `ls tickets/open/` plus reading the frontmatter. **There is no validator either** — the format is "intentionally simple enough that a script could validate it, but the kit ships no validator"; `/tickets` checks compliance as it reads and surfaces malformed frontmatter to the operator.

**ID allocation** is a documented four-step manual procedure: read filenames in both folders → extract numeric prefixes → find the max → add 1. Concurrency is explicitly acknowledged as out of scope: *"For multi-operator work (not the kit's primary use case), branches will sometimes assign the same number; resolve in the merge by renaming the later one."*

### 1.5 The ticket data format

YAML frontmatter; all fields required except `closed`:

```yaml
---
id: 0042
slug: nmap-parser-drops-hostnames
title: Nmap parser drops hostnames when no PTR record exists
type: bug
priority: high
status: open
created: 2026-05-12T14:30:00Z
closed: 2026-05-15T09:45:00Z
---
```

| Field | Values / rules |
|---|---|
| `id` | integer in YAML, always *displayed* zero-padded to 4 digits; matches filename prefix |
| `slug` | kebab-case, immutable, matches filename |
| `title` | human-readable; editable |
| `type` | `bug` \| `feature` \| `refactor` \| `docs` \| `chore` |
| `priority` | `low` \| `med` \| `high` (three values only) |
| `status` | `open` \| `closed` — **mirrors which folder the file is in**; there is no `in-progress` or `blocked` state |
| `created` | ISO 8601 UTC |
| `closed` | ISO 8601 UTC, omitted while open |

Body sections are a **fixed set**:

- Required on all tickets: `## Description`, `## Acceptance criteria` (markdown checkboxes — "vague criteria produce vague implementations"), `## Notes`.
- Required additionally on `bug`: `## Steps to reproduce`, `## Expected vs actual` (bolded **Expected:** / **Actual:**).
- **Appended only at close time**, by the implementer: `## Resolution` (files touched, tests added, design decisions and rationale, commit links) and `## Operator validation`.

The **Operator validation** section is the piece TicketSmith is proudest of. It is described as *"the contract between implementation and the operator"* — a list of small, concrete manual checks the human performs *before* `/clear`-ing and starting the next session. "None" is permitted but the docs push back hard: UI changes deserve a screenshot check, CLI changes deserve running them, integration changes deserve verifying the integrated state. `WORKFLOW.md` lists "Closing tickets without honest operator validation" as an anti-pattern: *"If the validation section is always 'None,' nobody is checking the work. That's not validation; that's hope."*

The format doc also explains its own choices: frontmatter over headers because those fields are structured data that should be trivially parseable "without committing to any specific tool to do that parsing"; slug immutability to keep references stable; checkboxes because they're checkable; Resolution/Operator-validation added at close because they should be "the honest record" of what actually happened, not what was planned; and closed tickets kept forever because *"the `closed/` directory is one of the most valuable artifacts the project produces."*

### 1.6 Lifecycle / state machine

The ticket state machine is deliberately tiny — **two states**:

```
(created in tickets/open/, status: open)
        │
        │  /tickets: understand → clarify → propose → implement
        ▼
  append ## Resolution + ## Operator validation
  set status: closed, add closed: <ISO8601>
  git mv tickets/open/NNNN-slug.md tickets/closed/
  commit as "tickets(#NNNN): <title>"
        ▼
(tickets/closed/, status: closed, permanent)
```

There is no *blocked*, *in-progress*, *in-review* or *wontfix* state in the kit. Blocking is handled conversationally: a ticket that can't be finished is *left open* with a `## Notes` entry explaining what blocked it. Explicit prohibition: **"Never close a ticket whose acceptance criteria aren't met."** And: **"Never delete a ticket."**

The surrounding *capability* lifecycle (DESIGN → TICKET-WRITE → BUILD → USE → REFLECT) carries the richer state; the ticket itself stays binary.

### 1.7 Commands and Claude Code integration

TicketSmith integrates with Claude Code through exactly **two mechanisms, both plain markdown**:

1. **One slash command**: `.claude/commands/tickets.md` → `/tickets`. That's the entire command surface. Its frontmatter is a single field:
   ```yaml
   ---
   description: Work through open tickets in tickets/open/, asking clarifying questions and proposing solutions for review when needed.
   ---
   ```
   No `allowed-tools`, no `argument-hint`, no arguments at all. `/tickets` takes **no subcommands** — it is one long procedural prompt (~220 lines).

2. **Pasteable prompt files** for everything else. There are no `/capability-design`, `/review` or `/consolidate` commands; those are `prompts/*.md` files whose operative text lives in a fenced code block the operator copies into a fresh session by hand. Installed prompts: `CAPABILITY_DESIGN.md`, `CONSOLIDATION_PASS.md`, `ARCHITECTURE_REVIEW.md`. Kit-level, not installed: `INSTALL.md` (a 6-phase install prompt: read kit → discover target → resolve prerequisites → produce integration plan → execute → verify), `MIGRATE_EXISTING_TICKETS.md`, `ROADMAP_DESIGN.md`.

**No skills, no hooks, no MCP server, no scripts.** The kit imposes nothing on the tech stack because it contains no executable anything. `CLAUDE.md` is the orientation file that points at all of it.

#### What `/tickets` actually does

*Before anything:* read `CLAUDE.md` → `docs/ARCHITECTURE.md` → `docs/DECISIONS.md` → `docs/capabilities/WORKFLOW.md` → then `ls tickets/open/` and **read every open ticket fully before starting**. If those docs are missing or stale, raise it before starting work.

*Prioritization* (and it must **state the chosen order and its reasoning** before working): 1. `priority` field high → med → low; 2. **dependencies** — if A's acceptance criteria need something B builds, do B first; 3. numeric ID ascending as tiebreaker.

*Per-ticket, six steps:*
1. **Understand** — read the ticket, locate and skim the relevant files.
2. **Clarify** — STOP and ask if criteria are ambiguous or contradict the docs, a public interface is touched, there's a genuine design fork, a new dependency would be needed, or a documented constraint would be violated. **All questions for a ticket at once**; may proceed on *other* unblocked tickets while waiting.
3. **Propose** — for non-obvious solutions (multiple plausible architectures, a new abstraction, shared infrastructure). Explicitly *not* for mechanical changes: "Don't manufacture a proposal step for changes that don't need one."
4. **Implement** — follow existing patterns, write tests where there's a convention, run them, don't touch foundational docs unless the ticket says to, append an ADR to `docs/DECISIONS.md` if a real decision was made.
5. **Close** — the 5-part procedure from §1.6 (Resolution, Operator validation, frontmatter update, file move, commit `tickets(#NNNN): <title>` in its own commit).
6. **Move on.**

*Stop conditions:* all tickets closed · **context above ~60% used** (finish the current ticket cleanly, then stop) · blocked with nothing else unblocked · a test failure revealing a deeper problem (file a new ticket and stop) · operator interrupt.

*Mandatory session summary format:* Tickets closed · Tickets in progress · New tickets filed · **Operator validation required** (consolidated checklist across all closed tickets — "the most important part of the summary") · Recommended next session.

*Never-do list:* close a ticket whose acceptance criteria aren't met · modify foundational docs to make a ticket easier · expand a ticket's scope (file new tickets instead) · delete a ticket · run anything destructive outside the repo · commit secrets · silently overwrite the operator's uncommitted changes.

### 1.8 Dependencies, epics, ordering — the honest gaps

This is where TicketSmith is thinnest, and it matters for Lost Soles:

- **Dependencies are prose, not data.** The example ticket ends its `## Notes` with "Depends on ticket #0006 (tool registry and executor)." `/tickets` is instructed to honour dependencies when ordering, but it has to *infer* them by reading every open ticket's prose. There is no `depends_on` field.
- **Epics = capabilities, and the link is one-directional.** The capability doc lists its tickets (`- NNNN: <title> — <one-line description>`); the ticket has no `capability` field pointing back. Given a ticket, you cannot cheaply find its capability.
- **Ordering is recomputed from scratch every session**, by an LLM, by reading everything. Fine at 8 open tickets; degrades at 60.
- **No index, no query, no filter.** `/tickets list --priority high` does not exist.
- **Everything is a full-file read.** Reading "every open ticket fully before starting" is the documented first step — an O(n) context cost per session.

These are reasonable omissions for a markdown-only kit with no code in it. Lost Soles is a real application with a build step, so it can afford to close a few of these gaps cheaply (§3.2, §3.3).

---

## Part 2 — How `/tickets` should be built in Claude Code, as of 2026

Verified against `code.claude.com/docs/en/skills.md`, `.../permissions.md`, `.../memory.md`, `.../sub-agents.md`, `.../settings-reference.md`.

### 2.1 Commands and Skills have converged

The headline: **`.claude/commands/*.md` and `.claude/skills/<name>/SKILL.md` now produce the same thing** — a `/name` slash command.

- `.claude/commands/deploy.md` → `/deploy`
- `.claude/skills/deploy/SKILL.md` → `/deploy`

Resolution order on name collision: **enterprise > personal > project**; plugin skills are namespaced `plugin-name:skill-name`. Scopes:

| Scope | Path |
|---|---|
| Personal | `~/.claude/skills/<name>/SKILL.md` |
| **Project** | `.claude/skills/<name>/SKILL.md` |
| Plugin | `<plugin>/skills/<name>/SKILL.md` |

**Skills are the superset.** Everything a command file can do, a skill can do; skills additionally get supporting files, scripts, subagent forking, path-scoped auto-loading, and the `${CLAUDE_*}` substitutions. `.claude/commands/` ignores `name` and `paths`, and does **not** support the `${CLAUDE_*}` variable substitutions.

**→ For Lost Soles, `/tickets` should be a project Skill at `.claude/skills/tickets/SKILL.md`**, not a command file. It needs helper scripts in a directory next to it, and it needs `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_SKILL_DIR}`. (TicketSmith's own kit uses `.claude/commands/tickets.md` — that is the right choice for a stack-agnostic kit with zero executables, and the wrong one for a project that has a runtime.)

### 2.2 Frontmatter fields worth knowing

| Field | Notes |
|---|---|
| `description` | Drives Claude's *automatic* invocation. Combined with `when_to_use`, capped at 1,536 chars. |
| `when_to_use` | Extra auto-invocation triggers. |
| `argument-hint` | Autocomplete hint, e.g. `[list\|show\|next\|create\|close] [id]`. |
| `arguments` | Named positional args → `$name` substitution. YAML list or space-separated string. |
| `allowed-tools` | Pre-approves tools **for that turn only**; clears on the user's next message. |
| `disallowed-tools` | Removes tools while active. |
| `disable-model-invocation` | `true` = only the user can fire it. |
| `user-invocable: false` | Claude-only; hidden from the `/` menu. |
| `model`, `effort` | Per-invocation overrides (`effort`: low/medium/high/xhigh/max). |
| `context: fork` + `agent:` | Run the skill in an isolated subagent (`Explore`, `Plan`, `general-purpose`, or a custom one). `background: false` waits for it. |
| `paths` | Globs — skill auto-loads only when working with matching files. |
| `hooks` | Hooks registered on invocation, persisting for the session. |
| `metadata` | Free-form YAML for your own tooling. |

### 2.3 Arguments

- `$ARGUMENTS` — everything the user typed after the command.
- `$ARGUMENTS[0]`, `$ARGUMENTS[1]` — zero-indexed positional access.
- `$0`, `$1`, `$2` — shorthand for the same.
- `$name` — named argument declared in `arguments:` frontmatter.

```yaml
---
arguments: [action, id]
---
Perform $action on ticket $id.
```
`/tickets close 0042` → `$action=close`, `$id=0042`.

Unsupplied positionals stay literal; unsupplied named args become empty strings. Escape a literal dollar with `\$1.00`. Up to 6 skills can be stacked in one invocation, and the arg text is passed to all of them.

### 2.4 Subcommands: not a native feature

**There is no built-in subcommand dispatcher.** `/tickets list` does not route anywhere by itself. Two documented approaches:

- **Option A — one skill, model-routed.** A single `/tickets` skill whose body says "if `$ARGUMENTS` begins with `list`, do X; with `show <id>`, do Y…". Claude's instruction-following does the dispatch. Keeps one entry point and one mental model.
- **Option B — one skill per action** (`tickets-list`, `tickets-show`, …). Crisper isolation, but pollutes the `/` menu and loses the single memorable command.

**→ Use Option A**, and make the dispatch *deterministic rather than interpretive* by having the skill body immediately shell out to a small script that does the parsing. See §3.3.

### 2.5 Calling scripts and HTTP APIs — yes, both

Two mechanisms:

**Inline injection with `!`** — the command runs *before* the model sees the body, and its output is substituted in:

````markdown
Open tickets: !`node ${CLAUDE_PROJECT_DIR}/scripts/tickets.mjs list --json`
````
Multi-line form uses a ```` ```! ```` fenced block.

Critical detail: **injected commands never prompt for permission.** If the permission check fails, *the whole skill invocation aborts.* So anything you inject must be pre-approved in `allowed-tools`. Also gated globally by the `disableSkillShellExecution` setting, and injection is inert for skills synced from claude.ai.

**Ordinary Bash tool calls** from within the skill body work too, and *do* prompt normally.

HTTP is just `curl` under the Bash tool: `allowed-tools: Bash(curl *)`. Note that `permissions.deny` beats `allow` (precedence is **deny > ask > allow**, first match wins), so a blanket `Bash(curl *)` deny would kill it.

### 2.6 `allowed-tools` syntax that actually matters here

- `Bash(cmd)` exact match; `Bash(cmd *)` prefix match; `*` also works mid-pattern (`Bash(git log * main)`).
- Compound commands are split on `&&`, `||`, `;`, `|`, `&` and newlines — **each subcommand must independently match a rule**.
- Wrappers auto-stripped: `timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin`, `noglob`, `xargs`. **Not** stripped: `docker exec`, `npx`, `mise exec`, `direnv exec`.
- Redirections are checked as file writes (`cmd > file.txt` hits `Edit` rules).
- `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` substitute inside `allowed-tools` Bash rules, not just the body.

### 2.7 Supporting files, and `@file`

A skill is a directory:

```
.claude/skills/tickets/
├── SKILL.md            # required
├── reference.md        # loaded on demand when SKILL.md links it
└── scripts/
    └── tickets.mjs
```

`@file` imports work **only in `CLAUDE.md`**, not in skill bodies. Inside a skill, reference a path and let Claude `Read` it, or inline it with `` !`cat path` ``. `SKILL.md` edits hot-reload in the current session (v2.1.207+).

### 2.8 Available substitutions (skills only)

`$ARGUMENTS`, `$0`/`$1`/`$2`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}` (v2.1.196+), plus `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` for plugin skills.

### 2.9 Not verifiable from public docs

`/skill-doctor` and `claude plugin eval` are early-access and were not enabled in the researching session — treat any capability claims about them as unconfirmed.

---

## Part 3 — Proposal: TicketSmith adapted for Lost Soles

### 3.0 The actual problem

TicketSmith assumes one operator, at one keyboard, in one repo. Lost Soles adds a second access point that TicketSmith never contemplated: **the user's phone, minutes after a run, with an idea that will be gone in ten minutes.** Two clients now pull on one dataset:

| | Phone (post-run capture) | Claude Code (dev session) |
|---|---|---|
| Frequency | Often, briefly, unpredictably | Deliberate, scheduled, hours long |
| Operation mix | ~95% **create**, some read | Heavy **read**, **edit**, **move**, **close** |
| Content quality | Half a sentence, no acceptance criteria | Fully specified |
| Connectivity | Flaky (outdoors, mid-run) | Assumed online |
| Latency tolerance | Must be instant | Irrelevant |

The naive read of this is "two writers, therefore you need bidirectional sync." That framing is what makes people build a DB and a sync engine and then fight merge conflicts for a year.

**The correct read is that the write sets are almost perfectly disjoint.** The phone only ever *creates new files*. The agent only ever *edits and moves existing files*. Two writers that never touch the same bytes do not need a sync protocol — they need `git pull`. Every design decision below flows from protecting that disjointness.

### 3.1 The storage fork

#### Option A — Markdown files in the repo only (literal TicketSmith)

- **For:** zero infrastructure. Tickets version alongside the code that resolves them; `git log` on a ticket file *is* its audit trail. Works on a plane. Diffable and reviewable. The agent reads and writes at native speed with no auth, no network, no API client, no rate limit. Closed tickets sit next to the code they explain forever. Nothing to operate, nothing to pay for, nothing to break.
- **Against:** phone capture is not possible without a client. The GitHub mobile app technically lets you create a file in a repo, but composing YAML frontmatter on a phone keyboard while sweaty is not a capture flow anyone will actually use twice. **This fails an explicit requirement** ("the ability for me to manually create tickets within the UI is a must").

#### Option B — Tickets in the Lost Soles database, DB is the source of truth

- **For:** the in-app UI is trivial and fast — it's just CRUD against a table you already have a stack for. Real querying, real filtering, offline-capable reads via the PWA cache, push notifications if you ever want them. One source of truth, no sync question at all.
- **Against:**
  - **The agent's access degrades badly.** Claude Code would need an MCP server or a CLI wrapper, plus a credential on the dev machine, plus network availability, for what is currently a `cat`. Every ticket read becomes a tool round-trip.
  - **Tickets leave version control.** You lose the single most valuable property TicketSmith identifies: the ticket, its resolution, and the commit that resolved it stop being in the same history. `git log tickets/closed/` no longer answers "why is the code like this."
  - **Bootstrapping deadlock.** The ticket system for building the app would live *inside* the app. On day one there is no app. On any day the deploy is broken, there is no ticket system. You cannot file "the app is down" in the app.
  - **Domain pollution.** Your fitness app's schema, migrations, and backups now carry your development backlog. Every `prisma migrate` on a ticket-table change is coupled to your run data.
  - Violates TicketSmith discipline #3 head-on: *"Nothing lives only in a database."*

#### Option C — Hybrid, DB source of truth, exported to markdown for the agent

- **For:** phone UI is native; agent still gets files.
- **Against:** the export is a lie the moment the agent edits it, which is constantly — closing a ticket *is* an edit. So you need write-back, which means bidirectional sync, which means conflict resolution, which means a reconciliation strategy, version vectors, and a bug class that will eat more sessions than it saves. **Rejected outright.** This is the option that looks reasonable and isn't.

#### Option D — Hybrid, markdown source of truth, app writes through the GitHub API ✅

Markdown files in the repo remain the *only* source of truth, exactly as TicketSmith intends. The app UI is a **thin client** over them:

- **Writes** (create) go through a small server-side endpoint that commits a new file to the repo via the GitHub Contents API.
- **Reads** come from a cached mirror in the app's DB, kept fresh by a GitHub push webhook. The mirror is a **read-through cache that is never authoritative** — it can be dropped and rebuilt from the repo at any time.
- The agent doesn't know the UI exists. It sees files. `git pull` at session start is the entire sync protocol.

- **For:** keeps every property of Option A for the agent (offline, fast, git-native, zero auth). Satisfies the phone requirement. No bidirectional sync, because the cache is never a writer. No bootstrapping deadlock for the *agent* path — markdown works from commit #1, and the UI is added later as its own capability. The failure mode is graceful: if the endpoint is down, the phone queues locally and you've lost nothing; if the webhook is down, the browse list is stale but creation still works.
- **Against:** needs one serverless endpoint and one GitHub credential (§3.6). Ticket creation from the phone requires connectivity at *some* point (queued offline, flushed later). Read-after-write on the phone has webhook latency — solved by optimistic local insertion.

### RECOMMENDATION: **Option D.**

Markdown in `tickets/` is the source of truth. The app UI is a capture-and-browse client that commits through a server-side GitHub integration. The app DB holds a disposable read cache only.

Two design moves make Option D nearly free, and they are the load-bearing part of this proposal:

**Move 1 — a separate inbox folder, so the phone never allocates an ID.**

TicketSmith's `NNNN` sequential numbering is a single-writer invariant. The moment two clients allocate numbers, you get collisions (TicketSmith itself concedes this and shrugs: "resolve in the merge by renaming"). Rather than build distributed ID allocation for a one-person project, **remove the phone from the numbering system entirely**:

```
tickets/
├── inbox/     ← phone/Shortcut capture lands here. NO number.
│              filename: YYYY-MM-DDTHHMM-slug.md, status: inbox
├── open/      ← agent-numbered NNNN-slug.md, the real backlog
├── closed/    ← never deleted, permanent history
└── index.json ← generated, for the UI's browse view
```

`/tickets triage` (§3.3) is where an inbox note becomes a real ticket: the agent reads the capture, asks its clarifying questions *in one batch* per TicketSmith discipline #2, writes proper acceptance criteria, allocates the next `NNNN`, and `git mv`s it into `open/`. **Only the agent ever assigns numbers.** The invariant holds by construction.

This isn't a workaround, it's a better model of reality. A thought captured at mile 6 is *not* a ticket. It's a note. Making it pass through a triage gate before it becomes work is the same discipline TicketSmith applies everywhere else.

**Move 2 — the phone creates, the agent mutates. Never the reverse.**

v1 of the UI is **create + read only**. No editing existing tickets, no closing from the phone, no drag-to-reprioritize. This keeps the write sets disjoint, which means **merge conflicts are structurally impossible**, not merely unlikely. Every phone write is `git add` of a brand-new path; every agent write touches paths the phone has never heard of.

(If phone-side priority bumping later proves genuinely necessary, add it narrowly: a single allowlisted field, written via the Contents API with the file's blob `sha` for optimistic concurrency, 409 → refetch → retry. Do not generalise it into "edit tickets from the phone.")

### 3.2 Ticket schema for Lost Soles

TicketSmith's frontmatter, plus four fields that pay for themselves because this project has a runtime and can parse them. The additions are deliberate deviations, listed as such in §3.7.

```yaml
---
id: 0042                         # int; displayed zero-padded. Agent-allocated only.
slug: streak-freeze-token        # kebab-case, immutable, matches filename
title: Award a streak-freeze token after 7 consecutive active days
type: feature                    # feature | bug | design | chore | refactor | docs
priority: high                   # high | med | low
status: open                     # inbox | open | blocked | closed
size: m                          # s | m | l
capability: 03-streak-engine     # ← ADDED: back-link to docs/capabilities/NN-name.md
depends_on: [0038, 0039]         # ← ADDED: structured, was prose in TicketSmith
blocked_by: []                   # ← ADDED: set by /tickets block; non-empty ⇒ status: blocked
source: ui                       # ← ADDED: ui | agent | operator (provenance)
created: 2026-08-30T14:32:00Z
started: 2026-08-31T09:10:00Z    # optional
closed: 2026-08-31T11:45:00Z     # omitted while open
---
```

**`type`** — TicketSmith's five, plus `design`. A `design` ticket's deliverable is **a capability doc in `docs/capabilities/`, not code**; it exists so "we need to figure out how streaks interact with rest days" can be tracked as work without pretending it's an implementation task. This is the natural home for the user's "designing future capabilities" requirement.

**`priority`** — keep TicketSmith's three values. Three is enough; five invites deliberation about whether something is P2 or P3, which is not work.

**`status`** — four values. `inbox` and `closed` mirror their folders. `open` and `blocked` both live in `open/`; `blocked` is derived (`blocked_by` non-empty). Keeping the folder as the coarse state preserves TicketSmith's "status mirrors the folder" rule.

**`size`** — `s` (< 30 min) · `m` (30 min – 2 h, the target) · `l` (**too big — split it**). TicketSmith's WORKFLOW.md already says tickets should be 30-minute-to-2-hour sessions; `size: l` just makes that a machine-checkable smell rather than a hope. `/tickets next` should refuse to start an `l` and offer to split it instead.

**`capability`** — TicketSmith's capability docs list their tickets but tickets don't point back. Given a ticket you can't cheaply find its design context. One string fixes it, and it gives the UI its grouping axis for free. **Capabilities are the epics** — do not introduce a separate "epic" concept.

**`depends_on` / `blocked_by`** — TicketSmith puts dependencies in `## Notes` prose and asks the model to infer ordering by reading everything. That's an O(n) context tax every session and it silently degrades as the backlog grows. Structured fields let `/tickets next` compute the ready set in milliseconds, deterministically, with zero tokens. The distinction: `depends_on` is a **planned** ordering constraint (0042 needs 0038's schema); `blocked_by` is a **discovered** one (found mid-session that this can't proceed until 0011 lands). Both are ticket ID arrays.

**Body sections** — unchanged from TicketSmith, and this matters more than the frontmatter:

- All tickets: `## Description`, `## Acceptance criteria` (checkboxes), `## Notes`.
- `bug` also: `## Steps to reproduce`, `## Expected vs actual`.
- `design` also: `## Options considered`, `## Open questions` — and its acceptance criteria should read "a capability doc exists at `docs/capabilities/NN-x.md` with no open questions," not "the feature works."
- **Appended at close, by the implementer:** `## Resolution` and `## Operator validation`.

**Keep `## Operator validation` non-negotiable.** It is the single best idea in TicketSmith and it is *more* valuable here than in its origin project, because Lost Soles is a phone-first fitness app whose bugs are things like "the streak badge renders 4px off on an iPhone SE" — exactly the class of defect that passes every test and that only the operator can catch. Every UI ticket's validation section should name a screen, a device, and what to look at.

**Inbox capture format** is a deliberately degenerate subset — everything the phone can plausibly know:

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

Idea from the 10k this morning — missing one day shouldn't nuke a 40-day
streak. Some kind of token you earn and spend?
```

No `id`, no `slug`, no acceptance criteria. Triage supplies those.

### 3.3 The `/tickets` command spec

**Vehicle:** a project Skill (per §2.1), with a helper script:

```
.claude/skills/tickets/
├── SKILL.md
├── reference.md          # ticket format spec, closing procedure detail
└── scripts/
    └── tickets.mjs       # deterministic mechanics
```

**Split of responsibility — the key design decision.** Everything mechanical goes in `tickets.mjs`; everything judgemental stays in the prompt.

| `tickets.mjs` (deterministic) | `SKILL.md` (the model) |
|---|---|
| parse & validate frontmatter | decide what a ticket means |
| allocate the next `NNNN` | write acceptance criteria |
| compute the ready set from `depends_on`/`blocked_by` | ask clarifying questions |
| sort by priority → deps → id | propose approaches |
| `git mv` on close, stamp timestamps | write `## Resolution` honestly |
| regenerate `index.json` | write `## Operator validation` |
| emit compact JSON/table listings | judge whether criteria are actually met |

This is where Lost Soles should diverge most from TicketSmith. TicketSmith has no executables, so `/tickets` must open every ticket into context just to sort them. A 12-line Node script removes that entirely: `/tickets list` costs one table, not twelve file reads. That is the difference between a backlog that scales to 60 tickets and one that doesn't.

**Frontmatter:**

```yaml
---
description: Manage and implement Lost Soles tickets. Subcommands: list, show, next, triage, create, start, block, close, sync. Bare /tickets works the backlog in priority order.
argument-hint: "[list|show|next|triage|create|start|block|close|sync] [id]"
arguments: [action, id]
allowed-tools: Bash(node ${CLAUDE_PROJECT_DIR}/.claude/skills/tickets/scripts/tickets.mjs *) Bash(git *) Read Edit Write Grep Glob
---
```

Since there is no native subcommand dispatch (§2.4), the body opens with an explicit routing table on `$action`, and each branch's first move is a call to `tickets.mjs`.

**Subcommands:**

| Invocation | Behaviour |
|---|---|
| `/tickets` | **The TicketSmith default.** Read `CLAUDE.md` → `docs/ARCHITECTURE.md` → `docs/decisions/` → `docs/capabilities/WORKFLOW.md`. Run `sync` and `triage` if the inbox is non-empty. List the ready set. **State the proposed order and the reasoning, then wait for confirmation.** Then work tickets per the six-step per-ticket workflow. |
| `/tickets list [filters]` | Compact table from `index.json` — id, type, priority, size, capability, status, title. Filters: `--status`, `--type`, `--priority`, `--capability`, `--ready`. Reads no ticket bodies. |
| `/tickets show 0042` | Print one ticket in full, plus its capability doc link and the status of anything in `depends_on`. |
| `/tickets next` | Pick exactly one: highest priority among tickets with an empty `blocked_by` and all `depends_on` closed; ties broken by lowest id. Refuse `size: l` and offer to split. Summarize it, state the approach, **wait for a go**. |
| `/tickets triage` | Process `tickets/inbox/`. Per note: read it, batch **all** clarifying questions at once, expand into Description + Acceptance criteria, set `type`/`priority`/`size`/`capability`, allocate `NNNN`, `git mv` to `open/`. Commit `tickets: triage inbox (N items)`. **This is the phone→backlog bridge.** |
| `/tickets create [title]` | Interview → full ticket → next `NNNN` → `open/`. Also the path for tickets the agent files itself when it discovers out-of-scope work mid-session (per "never expand a ticket's scope"). |
| `/tickets start 0042` | `status: in-progress`-equivalent marker + `started` timestamp; stays in `open/`. Announce intent, load the capability doc, begin. |
| `/tickets block 0042 --on 0011 "reason"` | Append `0011` to `blocked_by`, set `status: blocked`, append a dated `## Notes` entry with the reason. Never closes a blocked ticket. |
| `/tickets close 0042` | The full TicketSmith closing procedure: append `## Resolution`, append `## Operator validation`, set `status: closed` + `closed` timestamp, `git mv` to `closed/`, commit `tickets(#0042): <title>`. **Refuse if any acceptance criterion is unchecked** — say what's missing and leave it open. |
| `/tickets sync` | `git pull --rebase`, regenerate `index.json`, report what arrived from the phone since last session. |

**Agent workflow picking up a ticket** — TicketSmith's six steps, with triage and sync bolted on the front:

```
/tickets
  ├─ sync            git pull; new inbox items?
  ├─ triage          inbox notes → numbered tickets  (batch questions, one round)
  ├─ orient          CLAUDE.md, ARCHITECTURE.md, decisions/, WORKFLOW.md
  ├─ order           ready set, sorted; STATE IT, get confirmation
  └─ per ticket:
       1 understand  read it + its capability doc; locate and skim the code
       2 clarify     ambiguity / public interface / design fork / new dep
                     / constraint violation → STOP, ask everything at once
       3 propose     non-obvious solution → short proposal, confirm first
                     (skip entirely for mechanical changes)
       4 implement   follow existing patterns; tests; run them;
                     new decision → docs/decisions/NNNN-*.md
       5 close       Resolution + Operator validation + frontmatter + mv + commit
       6 next
  └─ stop when: backlog empty | ~60% context | blocked with nothing ready
                | test failure reveals a deeper problem (file a ticket, stop)
  └─ session summary: closed · in-progress · newly filed
                    · ★ OPERATOR VALIDATION REQUIRED ★ · recommended next session
```

The `/tickets` skill should **not** be model-auto-invocable in a way that lets it fire mid-conversation and start committing. Set `disable-model-invocation: true` so it only runs when the user types it.

### 3.4 The in-app ticket UI

**Placement:** a route inside the Lost Soles app — `/dev/tickets` — gated to the owner. The app already authenticates one human; add a hard allowlist check on top so this route is invisible and inaccessible to anyone else. Being inside the app means it inherits the PWA shell, the session, and the home-screen icon; there's no second app to install or log into with cold hands.

**Screen 1 — Capture (the one that matters).** A full-width FAB on every dev screen. Tapping it opens a sheet with:

- **Title** — autofocused, single line. *The only required field.*
- **Body** — optional textarea.
- **Type** — chip row: feature · bug · design · chore. Defaults to feature.
- **Priority** — chip row: low · med · high. Defaults to med.
- **Save.**

That's it. Two taps and a sentence, done in under fifteen seconds. Resist every temptation to add acceptance-criteria fields, capability pickers, size estimators, or dependency selectors — that is triage's job, done later at a keyboard by someone who can think. A capture form that takes ninety seconds is a capture form that doesn't get used after a run.

**Offline:** write to IndexedDB immediately, render optimistically, flush to the endpoint via a background-sync queue with retry. The user must never watch a spinner. Show a small "N pending" badge when the queue is non-empty.

**Screen 2 — Browse.** Read-only list from the cached mirror, default filter `status != closed`, grouped by capability, sorted priority-then-id. Each row: `#0042 · feature · high · title`. Inbox items pinned at top with a distinct "untriaged" treatment so the user can see their capture landed. Tap → **Screen 3**, a rendered markdown detail view with acceptance criteria as read-only checkboxes and dependencies as links.

**Non-goals for v1, stated explicitly:** no editing, no closing, no reordering, no comments, no kanban board, no charts. Every one of those breaks write-set disjointness or adds a feature nobody uses.

**How it stays in sync:**

```
 Phone ──POST /api/dev/tickets──▶ server endpoint ──Contents API──▶ commits
                                                                    tickets/inbox/…
                                                                        │
                                                     GitHub push webhook│
                                                                        ▼
 Phone ◀──── GET /api/dev/tickets ◀──── read cache (app DB, disposable)

 Claude Code ── git pull ──▶ files ── /tickets triage ──▶ tickets/open/ ── git push ──▶
                                                                        │
                                                     (same webhook refreshes cache)
```

The cache holds one row per ticket: parsed frontmatter plus the raw markdown. It is rebuilt wholesale from a Git Trees API walk whenever the webhook fires or on a cron backstop. **It is never written by the UI and never read by the agent.** If it's wrong, delete it and it rebuilds. That property is what makes this a cache rather than a second source of truth, and it's what keeps this out of Option C's swamp.

**A stopgap worth building on day one:** an **iOS Shortcut** that POSTs `{title, body}` to the same endpoint, triggerable by Siri. "Hey Siri, lost soles ticket" → dictate → done, without unlocking the phone or opening anything. This works before the app UI exists (solving the bootstrapping gap) and is likely to remain the fastest capture path even after. It also means the endpoint, not the UI, is the real product here — build the endpoint first.

### 3.5 Repository layout

```
lost-soles/
├── CLAUDE.md                       # orientation; points at everything below
├── tickets/
│   ├── inbox/                      # untriaged phone captures
│   ├── open/                       # NNNN-slug.md
│   ├── closed/                     # never deleted
│   └── index.json                  # generated by tickets.mjs
├── docs/
│   ├── ARCHITECTURE.md             # source of truth
│   ├── TICKET_FORMAT.md            # the §3.2 schema
│   ├── decisions/NNNN-title.md     # ADRs — see note below
│   ├── research/R1..R6-*.md        # this brief lives here
│   └── capabilities/
│       ├── WORKFLOW.md · TEMPLATE.md · ROADMAP.md
│       └── NN-name.md
├── prompts/
│   ├── CAPABILITY_DESIGN.md
│   ├── CONSOLIDATION_PASS.md
│   └── ARCHITECTURE_REVIEW.md
├── scripts/                        # app scripts
└── .claude/skills/tickets/{SKILL.md,reference.md,scripts/tickets.mjs}
```

Note: the repo already has `docs/decisions/` as a *directory*, so this project has evidently chosen one-file-per-ADR over TicketSmith's single append-only `docs/DECISIONS.md`. Keep that — it's better for a project where Claude Code appends ADRs, since one-file-per-decision avoids constant edits to a growing shared file. Update `CLAUDE.md` and the `/tickets` skill to read `docs/decisions/` rather than `DECISIONS.md`.

Also worth copying wholesale from TicketSmith: `WORKFLOW.md`, `TEMPLATE.md`, and the three prompt files. They are project-agnostic by design and cost nothing to adopt. The capability discipline (3–8 tickets, one focused design session, DESIGN → TICKET-WRITE → BUILD → **USE** → **REFLECT**) fits a fitness app unusually well, because "USE" means *actually going for a run with the build on your phone* — which is a real, unskippable validation step rather than a chore.

### 3.6 Auth and security

**Absolute rule: no GitHub credential ever reaches the browser.** All GitHub calls happen server-side in the endpoint. There is no client-side GitHub SDK, no token in an env var prefixed for client exposure, no token in localStorage.

**v1 credential — fine-grained PAT.** Fastest to stand up:
- Scoped to **the single `lost-soles` repository**, not "all repositories."
- Permission: **Contents → Read and write.** Nothing else. No Actions, no workflows, no admin.
- Expiry 90 days, with a calendar reminder. (GitHub allows up to a year; shorter is better for a token that lives in a Lambda.)
- Stored in **AWS Secrets Manager or SSM Parameter Store as a SecureString** (or the equivalent encrypted secret store for whatever platform hosts the endpoint), fetched at cold start and held in memory. Never in the repo, never in a `.env` that gets committed, never echoed into logs.
- Drawback: it acts *as the user*, so commits are attributed to the user and the blast radius is "whatever that token can reach" — which is why the repo scoping and the Contents-only permission are load-bearing.

**v2 credential — a GitHub App** (recommended once the endpoint is stable):
- A personal GitHub App owned by the user, installed on the one repo, with Contents: read/write.
- Store App ID + private key PEM in the secret store; mint a JWT, exchange for an **installation access token (1-hour TTL)**, cache it in memory across warm invocations.
- Advantages: a **separate bot identity** (commits show as `lost-soles-bot`, cleanly distinguishable from real work in `git log`), short-lived tokens instead of a 90-day standing credential, no rotation chore, and revocation is a single uninstall.

**Endpoint hardening — the part that actually matters.** The endpoint is a write primitive pointed at your repo, so treat it like one:

1. **Owner-only auth.** Require a valid Lost Soles session *and* check the user id against a hard-coded allowlist. Not "logged in" — "is the owner."
2. **The client never controls the path.** This is the critical one. Accept only `{title, body, type, priority}`. The server derives the path as `tickets/inbox/` + UTC timestamp + `slugify(title)`, and **rejects anything containing `..`, `/`, or a leading dot**. A client-supplied path is a path-traversal bug that writes arbitrary files into your repo.
3. **Enforce the prefix server-side.** Reject any computed path not under `tickets/inbox/`. Combined with (2), the endpoint provably cannot touch source code, `.github/workflows/`, or `.claude/`.
4. **Create-only.** Use the Contents API without a `sha`, so an existing path is a 422 rather than an overwrite. The endpoint has no update or delete capability at all.
5. **Size and rate limits.** Cap title at ~200 chars and body at ~8 KB; rate-limit to something like 30 creates/hour. A capture endpoint has no legitimate burst.
6. **Sanitize the YAML.** Strip newlines and quote the title, or emit frontmatter with a real YAML serializer. A title containing `\n---\n` should not be able to forge frontmatter.
7. **Verify the webhook.** Validate the `X-Hub-Signature-256` HMAC against the webhook secret on every delivery. The cache-refresh path is unauthenticated by nature and must not be forgeable.
8. **CORS locked** to the app's own origin; the route is same-origin anyway.

**A more paranoid variant, if wanted:** have the endpoint commit to a `tickets-inbox` branch rather than `main`, and let `/tickets sync` merge it. This removes direct-to-default-branch write from the endpoint's capability entirely, at the cost of one extra merge step per session. Given constraints (2)–(4) already confine writes to `tickets/inbox/`, direct-to-main is defensible for a single-operator project — but the branch variant is the right call if the credential is ever a broader-scoped one.

**Fallback that needs no GitHub credential at all:** the app writes captures to its own DB, and `/tickets sync` pulls pending drafts from an authenticated read-only endpoint and materializes them as inbox files. This moves the credential from the cloud to the dev machine (strictly safer) and keeps the phone path GitHub-free. The trade-offs: captures aren't in git until a session runs, the app must be up to capture at all, and you've now got a small amount of state that *is* only in a database — a partial violation of discipline #3. Worth keeping in the back pocket if the GitHub write path proves annoying to operate.

### 3.7 Deviations from TicketSmith, stated honestly

TicketSmith's `CLAUDE.md` warns that softening its opinionation is usually wrong. These deviations are deliberate; each names what it's buying.

| Deviation | Why |
|---|---|
| Skill instead of `.claude/commands/*.md` | Needs a helper script directory and `${CLAUDE_*}` substitutions (§2.1). The kit's choice is right for a stack-agnostic kit, wrong for a project with a runtime. |
| Subcommands on `/tickets` | User requirement; also makes the backlog usable at 60 tickets rather than 8. Bare `/tickets` still behaves exactly as TicketSmith specifies. |
| `tickets/inbox/` + a `design` type + `inbox`/`blocked` statuses | Phone capture requires a pre-triage state; blocking needed a home now that dependencies are structured. |
| Structured `depends_on` / `blocked_by` / `capability` / `size` | TicketSmith leaves these as prose for a model to re-infer every session. Structured, they're free to query and can't drift. |
| A generated `index.json` | TicketSmith has no index because it has no code. Lost Soles has code, and the index is what keeps ticket listing off the context budget. |
| A read cache in the app DB | Explicitly a cache, rebuildable from the repo, never authoritative. Discipline #3 ("nothing lives only in a database") is preserved in letter and spirit. |
| `docs/decisions/NNNN-*.md` instead of one `DECISIONS.md` | Matches the layout the project already has. |

**What is kept, unchanged, because it's the actual value:** disk is the source of truth · design before tickets, tickets before code · ask first in one batch, propose before non-obvious work · closed tickets are never deleted · **`## Operator validation` on every close** · never close on unmet acceptance criteria · never expand a ticket's scope · stop at ~60% context · the capability lifecycle including USE and REFLECT.

### 3.8 Suggested build order

1. **Day one, no code:** create `tickets/{inbox,open,closed}/`, copy TicketSmith's `WORKFLOW.md`, `TEMPLATE.md` and the three prompts, write `CLAUDE.md` and `docs/TICKET_FORMAT.md`. The methodology works immediately, with zero infrastructure.
2. **`/tickets` skill + `tickets.mjs`** — file it as tickets 0001–0004 and build them with the very first session. The system bootstraps itself.
3. **The capture endpoint + iOS Shortcut** — a capability of its own. This is where phone capture actually starts working, and it needs no UI.
4. **The in-app `/dev/tickets` UI** — a later capability, once the app has a shell, auth and a deploy. Read cache and webhook land here.
5. **Phone-side editing** — only if genuinely missed after living without it for a month. Probably it won't be.

Note the ordering property: nothing in steps 3–5 is required for the agent to work tickets. If the endpoint is never built, Lost Soles still has a fully functional TicketSmith. That's the payoff of keeping markdown authoritative.

---

## Sources

- `https://github.com/Oofles/ticketsmith` — cloned at commit `e3338fe`; `README.md`, `CLAUDE.md`, `docs/METHODOLOGY.md`, `docs/TICKET_FORMAT.md`, `templates/.claude/commands/tickets.md`, `templates/docs/capabilities/{WORKFLOW,TEMPLATE}.md`, `templates/CLAUDE.md.template`, `prompts/{INSTALL,ROADMAP_DESIGN,MIGRATE_EXISTING_TICKETS}.md`
- [Claude Code — Skills](https://code.claude.com/docs/en/skills.md)
- [Claude Code — Permissions](https://code.claude.com/docs/en/permissions.md)
- [Claude Code — Memory / `@file` imports](https://code.claude.com/docs/en/memory.md)
- [Claude Code — Subagents](https://code.claude.com/docs/en/sub-agents.md)
- [Claude Code — Settings reference](https://code.claude.com/docs/en/settings-reference.md)
- [Introducing fine-grained personal access tokens](https://github.blog/security/application-security/introducing-fine-grained-personal-access-tokens-for-github/) · [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) · [GitHub token guide (visma-prodsec)](https://github.com/visma-prodsec/github-token-guide) · [GitHub App installation token security](https://www.systemshardening.com/articles/cicd/github-app-token-security/)
- Prior art in the same shape, for comparison: [Backlog.md](https://github.com/MrLesk/Backlog.md) · [veggiemonk/backlog](https://github.com/veggiemonk/backlog) · [ticket-rs whitepaper](https://docs.ticket-rs.io/blog/whitepaper) — all independently converged on YAML-frontmatter markdown tickets committed in-repo, which is corroborating evidence for the Option D recommendation.
