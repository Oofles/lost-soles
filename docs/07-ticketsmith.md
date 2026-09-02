# 07 — Ticket System ("TicketSmith, adapted")

**Status:** design, pre-implementation. No code exists.
**Authority:** `docs/decisions/DECISIONS.md`. Every `D-xxx` below is settled and user-confirmed.
**Research:** `docs/research/R6-ticketsmith.md` (a full reading of the user's own
`github.com/Oofles/ticketsmith` at commit `e3338fe`, plus the adaptation proposal this
document turns into a spec).

> This system ships from day one (D-090, and it is explicitly named IN for MVP by D-122).
> It is not a side quest. Lost Soles is built almost entirely by an AI coding agent working
> ticket by ticket, so this is *the* interface between the operator and the build process.
> If this is bad, everything downstream is bad.

## Contents

1. What we keep from TicketSmith, and what we change
2. Storage design — the central problem
3. Ticket schema
4. The `/tickets` command
5. The in-app ticket UI
6. Auth and security
7. Bootstrapping

---

## 1. What we keep from TicketSmith, and what we change

### 1.1 What TicketSmith actually is

Be precise about this, because it constrains what "adapting" it can mean.

**TicketSmith is a methodology kit, not a tool.** There is no code in it — no CLI, no binary,
no dependency manifest, no scripts, no hooks, no MCP server. Every file in the repository is
Markdown. It is MIT licensed. It is a set of prompts, templates and conventions that an AI
installs into a target project. The repo's own `CLAUDE.md` warns that it is deliberately
opinionated and that "changes that compromise the opinionation are likely to be declined."

Its shape:

- **Tickets are markdown files on disk.** `tickets/open/` for active work, `tickets/closed/`
  for resolved work — **never deleted**. Filename is `NNNN-slug.md`, where `NNNN` is a
  four-digit zero-padded sequential integer that does *not* reset between the two folders, and
  `slug` is kebab-case and **immutable once assigned** (the title may be edited; the slug never
  is, because filenames get referenced in commits and conversations).
- **YAML frontmatter** carries `id, slug, title, type, priority, status, created, closed`.
  Everything else is body prose under a fixed set of headings.
- **Two states only.** `open` and `closed`, and `status` mirrors which folder the file is in.
  There is no `in-progress`, no `blocked`, no `in-review`, no `wontfix`. A ticket that can't be
  finished is *left open* with a `## Notes` entry saying what stopped it.
- **Closing moves the file.** `git mv tickets/open/NNNN-slug.md tickets/closed/`, having first
  appended `## Resolution` and `## Operator validation`, set `status: closed` and stamped
  `closed:`. Committed on its own as `tickets(#NNNN): <title>`.
- **Work groups into capabilities, not epics.** A capability is "a coherent operator-facing
  change": describable in one sentence, designable in one focused session, decomposing into
  **3–8 tickets**, useful on its own. Capability docs live at `docs/capabilities/NN-name.md`
  and cycle **DESIGN → TICKET-WRITE → BUILD → USE → REFLECT**. Steps 4 and 5 are called out
  as the most-skipped and the most important.
- **One slash command**, `.claude/commands/tickets.md` → `/tickets`, taking no arguments and
  no subcommands: one ~220-line procedural prompt. Everything else is a pasteable prompt file.

Its load-bearing discipline, quoted exactly:

> **"Disk is the source of truth. Nothing lives only in conversation. Nothing lives only in a
> database."**

That sentence is the thing this document has to reckon with, because D-092 requires a phone UI
and a phone UI implies a server and a server implies a database. Section 2 is the answer.

### 1.2 Kept unchanged, because it is the actual value

- Disk is the source of truth. Markdown files in git, full stop (D-093).
- Design before tickets, tickets before code. "Tickets do not invent scope; they implement scope."
- Ask first, code second — and **batch all clarifying questions for a ticket at once**, never
  drip them.
- Propose before non-obvious work; explicitly do *not* manufacture a proposal step for
  mechanical changes.
- `tickets/closed/` is permanent. Never delete a ticket.
- **`## Operator validation` on every close.** Non-negotiable. See §3.5.
- Never close a ticket whose acceptance criteria aren't met.
- Never expand a ticket's scope — file a new ticket instead.
- Never modify foundational docs to make a ticket easier.
- Stop at roughly 60% context used; finish the current ticket cleanly first.
- The capability lifecycle, including USE and REFLECT. Capabilities are the epics; **we do not
  introduce a separate "epic" concept.**
- 3–8 tickets per capability; a 30-minute-to-2-hour ticket as the target size.

### 1.3 Changed, and what each change buys

R6 §1.8 identified four honest gaps in TicketSmith. They are reasonable omissions for a kit
with no executables in it; Lost Soles has a runtime and a build step, so it can close them
cheaply. Each change below names the gap it closes. Nothing here softens a discipline.

| Change | Gap it closes (R6 §1.8) |
|---|---|
| `tickets/inbox/` as a third folder, and a `status: inbox` | Not a gap in TicketSmith — a new requirement. D-092 adds a second write client TicketSmith never contemplated. See §2. |
| Structured `depends_on:` and `blocked_by:` fields | **"Dependencies are prose, not data."** The example ticket ends `## Notes` with "Depends on ticket #0006". `/tickets` is told to honour dependencies but must *infer* them by reading every open ticket's prose, every session. |
| A `capability:` back-link field | **"Epics = capabilities, and the link is one-directional."** The capability doc lists its tickets; the ticket has no pointer back. Given a ticket you cannot cheaply find its design context. One string fixes it, and it gives the UI its grouping axis for free. |
| A generated `tickets/index.json` and a `/tickets list` | **"No index, no query, no filter."** and **"Everything is a full-file read."** TicketSmith's documented first step is "read every open ticket fully before starting" — an O(n) context tax per session. Fine at 8 open tickets; degrades at 60. |
| A `size:` field with `l` meaning "too big — split it" | TicketSmith's `WORKFLOW.md` already asks for 30-minute-to-2-hour tickets. `size` makes that a machine-checkable smell rather than a hope. |
| A `design` ticket type | TicketSmith has five types, none of which fit "we need to figure out how discovery cooldown interacts with route planning." A `design` ticket's deliverable is a capability doc, not code. |
| A `blocked` status | Blocking was conversational in TicketSmith. Now that `blocked_by` is structured data, it needs a state to correspond to. Still lives in `open/` — the folder remains the coarse state. |
| `/tickets` as a **Skill** with subcommands, not a bare command file | TicketSmith uses `.claude/commands/tickets.md`: correct for a stack-agnostic kit with zero executables, wrong for a project with a Node runtime. See §4. |
| `scripts/tickets.mjs` — actual code | The mechanical half of `/tickets` (parse, sort, allocate, move, index) is deterministic and should not be spending tokens. `/tickets list` becomes one table instead of twelve file reads. |
| `docs/decisions/` one-file-per-ADR *plus* the existing `DECISIONS.md` register | Matches the layout this project already has. TicketSmith uses a single append-only `docs/DECISIONS.md`; here `DECISIONS.md` is the running `D-xxx` register and per-decision ADRs land beside it. `/tickets` reads the directory, not one file. |
| A read cache in the app DB | Required by D-092/D-093 for the UI. It is **explicitly a cache**: rebuildable from the repo at any time, never authoritative, never read by the agent. Discipline #3 survives in letter and in spirit — nothing lives *only* in the database. |

**The one discipline we deliberately extend rather than keep:** TicketSmith's ID allocation is a
manual four-step procedure and it shrugs at concurrency ("branches will sometimes assign the same
number; resolve in the merge by renaming the later one"). With a phone client that is not
acceptable, and §2 removes the phone from the numbering system entirely rather than building
distributed ID allocation for a one-person project.

---

## 2. Storage design — the central problem

**D-093 settles it: markdown in the repo is the sole source of truth. The app UI is a thin
client that commits through a server-side GitHub integration. The app DB holds only a
disposable read cache, refreshed by a GitHub push webhook.**

This section explains why that is not a compromise but the correct answer, and records what was
rejected.

### 2.1 The problem D-092 creates

TicketSmith assumes one operator, at one keyboard, in one repo. D-092 adds a second access
point it never contemplated: **the user's phone, minutes after a run, with an idea that will be
gone in ten minutes.** Two clients now pull on one dataset:

| | Phone (post-run capture) | Claude Code (dev session) |
|---|---|---|
| Frequency | Often, briefly, unpredictably | Deliberate, scheduled, hours long |
| Operation mix | ~95% **create**, some read | Heavy **read**, **edit**, **move**, **close** |
| Content quality | Half a sentence, no acceptance criteria | Fully specified |
| Connectivity | Flaky (outdoors, mid-run) | Assumed online |
| Latency tolerance | Must be instant | Irrelevant |

The naive read is "two writers, therefore bidirectional sync." That framing is what makes people
build a DB, then a sync engine, then fight merge conflicts for a year — and it is how a ticket
system ends up costing more upkeep than it saves, which D-013 forbids for the app and which is
just as fatal here.

### 2.2 Why it works: the write sets are not symmetric

Look at the table again. **The phone almost only creates. The agent almost only edits and
moves.** Two writers that never touch the same bytes do not need a sync protocol. They need
`git pull`.

That near-disjointness is made *exact* — provable rather than probable — by two design moves.
Everything else in this document is downstream of protecting them.

#### Move 1 — phone captures land in `tickets/inbox/`, unnumbered

TicketSmith's `NNNN` sequential numbering is a **single-writer invariant**. The moment two
clients allocate numbers, you get collisions. Rather than build distributed ID allocation for a
one-person project, remove the phone from the numbering system entirely:

```
tickets/
├── inbox/     ← phone capture lands here. NO number, NO id, NO slug.
│              filename: YYYY-MM-DDTHHMM-slug.md      status: inbox
├── open/      ← agent-numbered NNNN-slug.md — the real backlog
├── closed/    ← never deleted, permanent history
└── index.json ← generated by scripts/tickets.mjs, for the UI and for /tickets list
```

**Only the agent ever allocates `NNNN`.** The invariant holds by construction, not by
convention. A phone capture's filename is derived from a UTC timestamp, so two captures in the
same minute are the only collision case, and the server resolves it with a `-2` suffix before
it ever reaches git (§6).

#### Move 2 — the v1 UI is create + read only

No editing existing tickets. No closing from the phone. No drag-to-reprioritize. No comments.

Every phone write is `git add` of a **brand-new path**. Every agent write touches paths the
phone has never heard of and cannot address. The write sets are disjoint, so **merge conflicts
are structurally impossible** — there is no code path by which the two writers can produce
divergent versions of the same file. No sync engine is needed because there is nothing to
reconcile.

> If phone-side priority bumping later proves genuinely necessary, add it narrowly: one
> allowlisted field, written via the Contents API with the file's blob `sha` for optimistic
> concurrency, 409 → refetch → retry. Do **not** generalise it into "edit tickets from the
> phone." That generalisation is the thing this design exists to avoid.

### 2.3 Triage is a gate, not overhead

The obvious objection to `inbox/` is that it adds a step. It does, and the step is the point.

**A thought captured at mile 6 is not a ticket. It is a note.** It has no acceptance criteria,
no size, no capability, no dependency analysis, and quite possibly no merit — it was thought up
by someone with a heart rate of 165. TicketSmith's entire thesis is that unclarified work
produces scope creep and premature abstraction. Making a capture pass through a triage gate
before it becomes work is exactly the discipline TicketSmith applies everywhere else, applied to
the one input channel TicketSmith never had.

`/tickets triage` (§4.3) is where a note becomes a ticket: the agent reads it, asks **all** its
clarifying questions in one batch, writes real acceptance criteria, sets `type`/`priority`/
`size`/`capability`, allocates the next `NNNN`, and `git mv`s it into `open/`.

The inbox is also a useful pressure valve. If ten captures sit there untriaged, that is honest
information about the backlog. Ten half-formed tickets sitting in `open/` would be a lie.

### 2.4 Data flow

```
 Phone ──POST /api/dev/tickets──▶ capture endpoint ──GitHub Contents API──▶ commit to
   ▲                              (server-side, owner-only)                 tickets/inbox/
   │                                                                             │
   │                                                        GitHub push webhook  │
   │                                                                             ▼
   └──── GET /api/dev/tickets ◀──── read cache (DynamoDB; disposable, rebuildable)

 Claude Code ── git pull ──▶ files ── /tickets triage ──▶ tickets/open/ ── git push ──▶
                                                                             │
                                                     (same webhook refreshes the cache)
```

The cache holds one row per ticket: parsed frontmatter plus the raw markdown. It is rebuilt
wholesale from a Git Trees API walk whenever the webhook fires, with a cron backstop. **It is
never written by the UI and never read by the agent.** If it is wrong, delete it and it
rebuilds. That property is precisely what makes it a cache rather than a second source of truth.

Failure modes are all graceful:

- Capture endpoint down → the phone queues locally in IndexedDB and flushes later. Nothing lost.
- Webhook down → the browse list is stale. Creation still works. Next webhook or cron fixes it.
- Cache corrupted → drop the table, replay from the repo.
- App entirely down → the agent is completely unaffected. `git pull` and `/tickets` still work.
- GitHub down → capture queues; the agent works offline against local files.

### 2.5 Rejected alternatives

#### Rejected — DB as the source of truth

Tickets live in a Lost Soles DynamoDB table; the repo has no `tickets/`.

For: the in-app UI is trivial CRUD against a stack we already have. Real querying and filtering.
One source of truth, no sync question at all.

Rejected because:

- **The agent's access degrades to tool round-trips.** Claude Code would need an MCP server or a
  CLI wrapper, plus a credential on the dev machine, plus network availability, for what is
  currently a `cat`. Every ticket read becomes a network call. Ordering the backlog becomes a
  query someone has to have written.
- **Tickets leave version control.** This forfeits the single most valuable property TicketSmith
  identifies: the ticket, its resolution, and the commit that resolved it stop living in the same
  history. `git log tickets/closed/` no longer answers "why is the code like this."
- **Bootstrapping deadlock.** The ticket system for building the app would live *inside the app
  it is building*. On day one there is no app, no deploy, no table. On any day the deploy is
  broken there is no ticket system — you cannot file "the app is down" in the app. §7 exists
  because of this problem; this option makes it unsolvable rather than merely awkward.
- **Domain pollution.** The fitness app's schema, migrations and backups would carry the
  development backlog. Every schema change to a ticket table is coupled to the run data.
- Violates TicketSmith discipline #3 head-on: *"Nothing lives only in a database."*

#### Rejected — DB as truth, exported to markdown for the agent

Tickets live in the DB; a job writes markdown files out so the agent can read them.

For: the phone UI is native, and the agent still gets files.

Rejected outright, because **the export is a lie the moment the agent edits it — and the agent
edits constantly. Closing a ticket *is* an edit.** So you need write-back. Write-back plus
export is bidirectional sync, which means conflict resolution, which means a reconciliation
strategy, version vectors, and a bug class that will eat more sessions than the whole system
saves. This is the option that looks reasonable and isn't.

#### Rejected — markdown only, no UI at all (literal TicketSmith)

Zero infrastructure, and everything above about git-native tickets holds. **It fails D-092.**
The GitHub mobile app technically lets you create a file in a repo, but composing YAML
frontmatter on a phone keyboard while sweaty is not a capture flow anyone will use twice.

Note, though, that this is the *degraded mode* of the chosen design, not an unrelated option:
if the endpoint is never built or is permanently down, Lost Soles still has a fully functional
TicketSmith. That is the payoff of keeping markdown authoritative.

#### Kept in the back pocket — captures in the app DB, pulled by `/tickets sync`

The app writes captures to its own table; `/tickets sync` pulls pending drafts from an
authenticated read-only endpoint and materializes them as inbox files on the dev machine. This
moves the GitHub credential from the cloud to the dev machine, which is strictly safer, and
keeps the phone path GitHub-free.

Not chosen, because captures aren't in git until a session runs, and it does leave a small
amount of state that lives *only* in a database — a partial violation of discipline #3. Worth
revisiting only if the GitHub write path proves annoying to operate.

---

## 3. Ticket schema

Normative. `docs/TICKET_FORMAT.md` is generated from this section at bootstrap (§7) and is the
copy `/tickets` reads; if the two diverge, **this document wins and both get changed in the same
commit.**

### 3.1 Frontmatter fields

| Field | Required | Type | Values / rules |
|---|---|---|---|
| `id` | open/closed only | integer | Sequential, **agent-allocated only**. Written as an int in YAML, always *displayed* zero-padded to 4 digits. Matches the filename prefix. Does not reset between `open/` and `closed/`. Absent on inbox items. |
| `slug` | open/closed only | string | kebab-case, `^[a-z0-9]+(-[a-z0-9]+)*$`, **immutable once assigned**, matches the filename. Absent on inbox items (the timestamp filename carries a provisional slug that triage may replace). |
| `title` | yes | string | Human-readable, editable. Max 200 chars. |
| `type` | yes | enum | `feature` · `bug` · `design` · `chore` · `refactor` · `docs` |
| `priority` | yes | enum | `high` · `med` · `low` |
| `status` | yes | enum | `inbox` · `open` · `blocked` · `deferred` · `closed` |
| `size` | open/closed only | enum | `s` · `m` · `l` |
| `capability` | open/closed only | string \| null | `NN-name`, matching a file at `docs/capabilities/NN-name.md`. `null` is legal for genuinely standalone chores; the validator warns, it does not error. |
| `depends_on` | open/closed only | int[] | Ticket ids. Planned ordering constraints. `[]` when none. |
| `blocked_by` | open/closed only | int[] | Ticket ids. Discovered ordering constraints. `[]` when none. Non-empty ⇒ `status: blocked`. |
| `source` | yes | enum | `ui` · `agent` · `operator` — provenance. |
| `created` | yes | ISO 8601 UTC | Set once, never edited. |
| `started` | no | ISO 8601 UTC | Stamped by `/tickets start`. Omitted until then. |
| `closed` | closed only | ISO 8601 UTC | Stamped by `/tickets close`. Omitted while open. |
| `deferred` | `deferred` only | ISO 8601 UTC | Stamped by `/tickets defer`, removed by `/tickets resume`. Present iff `status: deferred`. |

#### Enum definitions

**`type`** — TicketSmith's five, plus `design`.

- `feature` — new operator-visible behaviour.
- `bug` — existing behaviour is wrong. Requires the extra body sections in §3.3.
- `design` — **deliverable is a capability doc in `docs/capabilities/`, not code.** This is how
  "we need to figure out how the 6-month discovery cooldown (D-120) interacts with route
  planning (D-070)" gets tracked as real work without pretending it is an implementation task.
  Its acceptance criteria read "a capability doc exists at `docs/capabilities/NN-x.md` with no
  open questions," never "the feature works."
- `chore` — maintenance with no behaviour change: dependency bumps, CI, key rotation.
- `refactor` — internal structure changes, behaviour identical, tests unchanged.
- `docs` — documentation only.

**`priority`** — TicketSmith's three, unchanged. `high` · `med` · `low`. Three is enough. Five
invites deliberation about whether something is P2 or P3, which is not work.

**`status`** — five values. `inbox` and `closed` mirror their folders exactly. `open`,
`blocked` and `deferred` **all live in `open/`**; `blocked` is derived from `blocked_by` being
non-empty. Keeping the folder as the coarse state preserves TicketSmith's "status mirrors the
folder" rule while giving structured blocking somewhere to live. There is deliberately no
`in-progress` status — `/tickets start` stamps `started:` instead, so an abandoned session leaves
a timestamp rather than a stuck state that has to be cleaned up.

**`blocked` vs `deferred` — the distinction, in one sentence: `blocked` is waiting on a ticket in
this backlog, `deferred` is waiting on the world.** Closing the blocking ticket clears a `blocked`
automatically, and `blocked_by` names it; nothing in the backlog can clear a `deferred`, and there
is no ticket id to point at because "npm fixes its bundled tarballs" is not work anyone here can
do. If you find yourself wanting to file a placeholder ticket so that `blocked_by` has something
to hold, the state you want is `deferred`.

`deferred` (D-174, ticket 0136) is for work that is **specified, correct, and unworkable through
no fault of its own**. It exists because the other four statuses each lie about such a ticket:
`open` claims it is available and makes every future session re-derive that it is not; `blocked`
needs a ticket id there is no honest candidate for; `closed` says the criteria are met when they
are not; `inbox` says untriaged when it is the most thoroughly triaged ticket in the backlog.

Three consequences, all of them the point:

- A deferred ticket is **not in the ready set**, so `/tickets next` never offers it. It is still
  counted aloud on the `N ready, M gated` line, because a backlog that hides its deferrals makes
  "nothing is ready" and "everything is waiting on npm" look identical.
- It is **excluded from the audit's `capability-tickets-closed` check** (D-153), so one third-party
  defect cannot hold a whole capability — and through the gate, every capability after it. The
  audit record **names every deferred ticket it passed with**, so a capability that closed with
  work outstanding never reads as one that closed clean.
- It carries a **mandatory reason and a mandatory re-check** in a `## Deferred` body section (§3.3).
  `validate` errors without either. A deferral with no reason is indistinguishable from a ticket
  nobody got to; a deferral with no re-check is a wait with no end condition, which is how a ticket
  goes quiet for a year.

**Leaving the state is never automatic.** `/tickets recheck` runs the re-check and *reports*; it
changes nothing and exits 0 either way, because a failing re-check is the expected case and this is
a report, not a gate. A human or agent reads the result and types `/tickets resume`. A ticket that
silently un-defers is a ticket nobody looks at — which is the failure the status was invented to
prevent, arriving by a different door.

**`size`** — a session-length estimate, not story points.

- `s` — under 30 minutes.
- `m` — 30 minutes to 2 hours. **The target.** TicketSmith's `WORKFLOW.md` already asks for
  this; `size` just makes it checkable.
- `l` — **too big. Split it.** `/tickets next` refuses to start an `l` and offers to split it
  instead. `size: l` is a smell recorded honestly, not a valid plan.

**`source`** — `ui` (phone capture), `agent` (filed by Claude Code mid-session, per "never expand
a ticket's scope — file a new ticket"), `operator` (typed at the keyboard). Cheap, and it tells
you at a glance whether the backlog is being driven by post-run ideas or by the build.

### 3.2 Why the four additions earn their place

`capability`, `depends_on`, `blocked_by` and `size` are the deviations. All four do the same
thing: **they move information out of prose that the agent must re-infer every session and into
fields a script computes for free.**

TicketSmith's `/tickets` is instructed to order work by "1. priority, 2. dependencies, 3. id
ascending" — but dependencies live in `## Notes` prose ("Depends on ticket #0006 (tool registry
and executor)"), so honouring rule 2 requires reading every open ticket in full, every session,
and re-deriving the graph with an LLM. That is an O(n) context tax paid at the start of every
session, it produces a slightly different answer each time, and it degrades silently as the
backlog grows. R6 §1.8 puts it plainly: fine at 8 open tickets, broken at 60.

With `depends_on` and `blocked_by` as integer arrays, `/tickets next` computes the ready set by
topological filter in milliseconds, deterministically, with **zero tokens spent**. The
distinction between the two fields is intentional and worth preserving:

- **`depends_on`** is a **planned** constraint, set at ticket-write time. "0042 needs the schema
  0038 creates."
- **`blocked_by`** is a **discovered** constraint, set mid-session by `/tickets block`. "Found
  while implementing that this can't proceed until 0011 lands."

Mixing them loses the ability to tell "we planned this order" from "we hit a wall," which is
exactly the information a REFLECT step wants.

`capability` closes the one-directional link: capability docs list their tickets, but a ticket
had no pointer back, so given a ticket you could not cheaply find its design context. One string
fixes it — and it hands the in-app browse view (§5) its grouping axis for free.

`size` costs one character and turns "tickets should be small" from a hope into something
`/tickets next` can enforce.

### 3.3 Body sections

Unchanged from TicketSmith, and this matters more than the frontmatter.

**All tickets:**

- `## Description`
- `## Acceptance criteria` — markdown checkboxes. Vague criteria produce vague implementations.
  A criterion only a human can check is prefixed `(operator)` — see §3.3.1.
- `## Notes`

**`bug` additionally:**

- `## Steps to reproduce`
- `## Expected vs actual` — bolded **Expected:** / **Actual:**

**`design` additionally:**

- `## Options considered`
- `## Open questions`

**`deferred` additionally** — written by `/tickets defer`, never by hand:

- `## Deferred` — a `**Reason:**` line saying what is being waited on and naming the third party,
  and a fenced shell block that is the **re-check**: the cheap test that says the wait is over.
  `validate` errors on a deferred ticket missing either. `resume` renames the heading to
  `## Deferred — resumed YYYY-MM-DD` and appends the result rather than deleting the section: what
  was waited on, and why, is worth keeping, and the rename is also what makes a *second* deferral
  open a fresh block instead of re-running the stale re-check.

**Appended only at close time, by the implementer:**

- `## Resolution` — files touched, tests added, design decisions and rationale, commit links.
- `## Operator validation` — see below.

### 3.3.1 `(operator)` criteria — the ones a human must run

A criterion prefixed **`(operator)`** is one no agent can check: it needs a human, a device, and
eyes. Bare or bolded, any case, optionally followed by a colon.

**WHAT EARNS THE PREFIX (D-181).** A human eye or hand must be the *only* instrument that can answer
the question. Apply the test honestly, because the prefix is expensive — it stops a close and parks
work on someone who is not at their desk:

| Earns `(operator)` | Does NOT — this is the agent's job |
|---|---|
| Does the fog read as legible on a real phone screen? | Did the table deploy, and is its TTL enabled? |
| Does the level-up card land, or feel cheap? | Does an unauthenticated POST return 404? |
| Is the tally readable in sunlight, one-handed, after a run? | Did the IAM policy attach, and is it scoped? |
| Did a **real run** appear on the map? | Does the rate limiter refuse at exactly the cap? |

Anything reachable with AWS credentials, `curl`, or a script is **verified by the agent and written
up in `## Operator validation` as a smoke test** — not handed to a human. This was not always true:
the rule was written when the agent had no AWS credentials, so "the agent cannot personally confirm
it" and "a human must check it" collapsed into the same thing. They are not the same thing.

**A step that rides along with something the operator already does is not a tax.** "Go for a run and
confirm it appears" costs nothing extra — they were going for a run. "Open the AWS console and check
a DynamoDB row" is pure overhead. Prefer the first shape; delete the second.

```markdown
## Acceptance criteria

- [x] `SKILL.md` frontmatter parses as YAML (`check-skills.mjs`)
- [ ] (operator) Typing `/tickets` shows the skill with its `argument-hint`
```

**A ticked `(operator)` criterion must carry its evidence inline** — a dated result, next to the
claim it supports:

```markdown
- [x] (operator) Typing `/tickets` shows the skill
      — verified 2026-08-31: registered, no session restart needed
```

Em dash, en dash or hyphen; the date shape is checked, the wording of the result is not. A
criterion may wrap across lines — continuation lines fold into it, so the sign-off can live on its
own line.

**Two refusals are built on the marker:**

- `close` refuses while an `(operator)` criterion is **unchecked**, and says what to do instead:
  leave the ticket open, commit the work, close in a later session once a human has run it. This is
  the whole point — the generic "do the work or amend the criterion" advice is one an agent can act
  on alone, and acting on it alone means ticking the box.
- `close` and `validate` both refuse an `(operator)` criterion **ticked with no sign-off**.
  `validate` applies this in every folder, so a pre-tick is an error where it is written rather
  than a post-mortem after the ticket has closed.

**Why this exists.** Ticket `0010` marked "typing `/tickets` shows the skill" as operator-verifiable
in its notes, ticked it in advance, and closed. The frontmatter was invalid YAML; the skill never
registered and shipped inert for days until `0123` found it. Prose in `## Notes` enforces nothing —
a box the agent ticked because it did the work and a box the agent ticked because only a human could
have is the same character in the same file. The marker makes the difference machine-visible.

**What it does not buy.** It does not make a false tick impossible; an agent willing to tick a box
is willing to type a date. It makes the claim **explicit, dated and permanent**, held to the same
standard as `## Operator validation` prose. Do not mistake it for a tamper-proof gate.

### 3.4 Inbox capture format

A deliberately degenerate subset: everything the phone can plausibly know, and nothing else.

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

No `id`, no `slug`, no `size`, no `capability`, no acceptance criteria. **Triage supplies those.**
Filename: `2026-08-30T1432-streak-freeze-after-7-days.md`.

### 3.5 `## Operator validation` is non-negotiable

This is the single best idea in TicketSmith and it is **more** valuable here than in its origin
project. Lost Soles is a phone-first app whose defects are things like "the Cartography level-up
banner renders 4px off on a small Android screen" or "the fog edge shimmers when you pan the atlas map" —
exactly the class of bug that passes every test and that only the operator can catch. D-051
makes map legibility non-negotiable, and no automated test asserts legibility.

Every UI ticket's validation section names **a screen, a device, and what to look at.** Note the
word **UI**: it was there from the start, and ignoring it is how this section turned into a tax.
A ticket with no screen has no screen to name, and inventing one is ceremony.

**"None" is permitted, and the anti-pattern it guards against has a better answer now (D-181).**
TicketSmith's `WORKFLOW.md` warns that *"if the validation section is always 'None,' nobody is
checking the work. That's not validation; that's hope."* That is correct and still binding — but the
fix is **not** to invent a manual step for a human. It is for the agent to run a smoke test against
real infrastructure and record what it proved. `0019` is the worked example: four manual steps
became four agent-run checks, two of which caught things no unit test could reach (a DynamoDB
conditional refusing at exactly the cap; GitHub's real `422 "sha" wasn't supplied`).

So the section is still non-negotiable and still must not be empty. What it contains changes:
**evidence of verification, by whoever could actually perform it.** A close with neither an operator
check nor a recorded smoke test is the thing this section exists to prevent.

The capability lifecycle's **USE** step fits this project unusually well: for Lost Soles, "USE"
means *actually going for a run with the build on your phone.* That is a real, unskippable
validation step rather than a chore.

### 3.6 Complete example

`tickets/open/0042-half-xp-on-explored-ground.md`

```markdown
---
id: 42
slug: half-xp-on-explored-ground
title: Award half Wayfaring XP for distance covered on previously explored ground
type: feature
priority: high
status: open
size: m
capability: 04-xp-and-levelling
depends_on: [38, 39]
blocked_by: []
source: operator
created: 2026-09-02T09:14:00Z
started: 2026-09-04T10:02:00Z
---

## Description

Per D-120, re-running previously explored ground awards **half XP** to the activity skill
(Wayfaring). Full XP applies only to ground that was not already revealed.

XP is computed at import time from the normalized `Trace` (see `docs/03-integrations.md` §1).
The scorer already splits a trace into per-cell segments to drive fog reveal; this ticket adds
the XP weighting on the segments that land on cells already present in the explored set.

Note that this is independent of discovery credit, which has its own 6-month cooldown rule
(also D-120) and is handled by 0039. A cell can award half Wayfaring XP and zero Cartography
discovery credit in the same run. Do not conflate the two.

## Acceptance criteria

- [ ] Distance on cells absent from the explored set awards full Wayfaring XP.
- [ ] Distance on cells already in the explored set awards exactly 50% Wayfaring XP.
- [ ] The split is computed per H3 res-10 cell (D-115), not per activity.
- [ ] An activity crossing both new and explored ground awards the correct blended total.
- [ ] Unit tests cover: all-new, all-explored, mixed, and a zero-distance trace.
- [ ] No change to Cartography discovery credit — 0039 owns that.

## Notes

Depends on 0038 (explored-cell set in DynamoDB) for the lookup and 0039 (per-cell `lastRunAt`)
for the timestamp the discovery rule needs; the XP rule here only needs presence, but doing
this before 0038 would mean writing the lookup twice.
```

At close, the implementer appends:

```markdown
## Resolution

Files touched: `src/scoring/wayfaring.ts` (new), `src/scoring/index.ts`,
`src/ingest/pipeline.ts`. Tests in `src/scoring/wayfaring.test.ts` (4 cases per criteria).

Weighting is applied at the segment level rather than post-hoc on the activity total, so a
mixed run blends correctly without a second pass. Considered rounding per segment; rounds once
on the activity total instead, so a long run over alternating ground doesn't accumulate
rounding drift.

Commit: `abc1234`.

## Operator validation

1. Open the app, go to the Skills screen, note the current Wayfaring XP.
2. Re-run a route you have already covered (the canal loop). Import it.
3. Wayfaring XP should increase by roughly half what an equivalent-distance new route gives.
   The Skills screen should show the increase; the map should show no new reveal.
4. Confirm the XP breakdown line on the activity detail reads "half XP (explored ground)".
```

---

## 4. The `/tickets` command

Required by **D-091**.

### 4.1 Vehicle: a project Skill, not a command file

R6 §2.1 verified against the current Claude Code docs that `.claude/commands/*.md` and
`.claude/skills/<name>/SKILL.md` now produce the same thing — a `/name` slash command — and
that **skills are the superset**. Only skills get supporting-file directories, helper scripts,
and the `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_SKILL_DIR}` substitutions. `.claude/commands/`
supports none of those.

TicketSmith uses a command file. That is the right choice for a stack-agnostic kit containing
zero executables, and the wrong choice for a project with a Node runtime that wants a script
next to its prompt.

```
.claude/skills/tickets/
├── SKILL.md            # the prompt: routing, judgement, procedure
├── reference.md        # ticket format spec + closing procedure detail, loaded on demand
└── scripts/
    └── tickets.mjs     # all deterministic mechanics
```

Note that `@file` imports work only in `CLAUDE.md`, not in skill bodies — `SKILL.md` references
`reference.md` by path and lets Claude `Read` it when a branch actually needs it.

### 4.2 Frontmatter

```yaml
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
```

> **Corrected 2026-08-31 (ticket 0123).** `description` was previously an unquoted scalar
> containing `Subcommands: list…`. The `: ` makes it invalid YAML — *"mapping values are not allowed
> here"* — and **a skill whose frontmatter does not parse is silently skipped, with no error
> anywhere.** `/tickets` simply never appeared. The folded `>` scalar and the quoted `allowed-tools`
> are load-bearing; do not unquote them. A test now asserts every `SKILL.md` parses.
>
> The wider lesson: ticket 0010 required this block be reproduced **verbatim**, and it was — a
> byte-for-byte check passed while the thing it described was broken. **"Matches the spec" is not a
> test.** Where a spec contains something machine-checkable, assert that it *parses and behaves*.

**`disable-model-invocation: true` is deliberate.** `/tickets` moves files and makes commits.
It must fire only when the user types it, never because a description matched something
mid-conversation.

**There is no native subcommand dispatch** (R6 §2.4). `/tickets list` does not route anywhere by
itself. So the body opens with an explicit routing table on `$action`, and **every branch's first
move is a call to `tickets.mjs`** — the dispatch is deterministic rather than interpretive
because the script, not the model, does the parsing.

A note on the `!`-injection form (`` !`node …` ``): injected commands never prompt for
permission, and if the permission check fails **the entire skill invocation aborts.** Anything
injected must therefore match `allowed-tools` exactly. The rule above is a prefix match on the
full `node <abs path>` invocation, which it does. Prefer ordinary Bash tool calls inside branches
that might need to vary their arguments.

### 4.3 Subcommand reference

| Invocation | Behaviour |
|---|---|
| `/tickets` | **The TicketSmith default loop.** See §4.4. |
| `/tickets list [filters]` | Compact table from `index.json`: id, type, priority, size, capability, status, title. Filters: `--status`, `--type`, `--priority`, `--capability`, `--ready`, `--capability-tree`. **Reads no ticket bodies.** |
| `/tickets show 0042` | Print one ticket in full, plus a link to its capability doc and the current status of every id in `depends_on` and `blocked_by` (resolved to title + status, so "blocked on 0011" reads as "blocked on 0011 *Strava token refresh* — still open"). |
| `/tickets next` | Pick exactly one ticket: highest `priority` among the ready set, ties broken by lowest `id`. **Refuse `size: l`** — say so, and offer to split it into `s`/`m` tickets. **Refuse to advance into a capability whose predecessors have not passed their audit** (D-173) — prefer an ungated ticket, and if every ready ticket is gated, name the earliest unaudited capability and stop. Summarize the chosen ticket, state the intended approach, **wait for a go.** |
| `/tickets triage` | Process `tickets/inbox/` — the phone→backlog bridge. See §4.5. |
| `/tickets create [title]` | Interview the operator → full ticket → next `NNNN` → `open/`, `source: operator`. Also the path the agent uses to file work it discovers mid-session, per "never expand a ticket's scope" (`source: agent`). |
| `/tickets start 0042` | Stamp `started:`, announce intent, load the capability doc, begin. The ticket stays in `open/` with `status: open`. |
| `/tickets block 0042 --on 0011 "reason"` | Append `11` to 0042's `blocked_by`, set `status: blocked`, append a dated `## Notes` entry with the reason. **Never closes a blocked ticket.** Errors if 0011 does not exist or if the edge would create a cycle. |
| `/tickets close 0042` | The full TicketSmith closing procedure. See §4.6. **Refuses if any acceptance criterion is unchecked** — names what is missing and leaves the ticket open. |
| `/tickets sync` | `git pull --rebase`, regenerate `index.json`, report what arrived from the phone since last session (count of new inbox items, listed by title). |
| `/tickets validate` | Run the validator over every ticket and report violations. Also runs implicitly inside `sync`. |
| `/tickets audit <capability>` | Run `AUDIT.md`'s **mechanical half** — §1, the scriptable §4 rows, §5 — and report `pass` / `fail` / **`n/a` with a reason** per check (D-171). Exit 1 on any failure; `n/a` never fails. Records nothing. |
| `/tickets audit <capability> --sections` | The §2 reading list: every design-doc section this capability's tickets cite, with its `§` references. Mechanical, in service of the judgemental half. |
| `/tickets audit <capability> --record` | Write the audit result to `docs/capabilities/NN-name.md` (D-172). **Refuses** unless the mechanical half is green, the divergence list is explicitly asserted (`--divergence …` or `--no-divergences`), the divergences are within the budget of three, and §6 REFLECT has substance. `--force "<reason>"` overrides and records `verdict: forced`, never `pass`. |

**Argument handling.** `arguments: [action, id]` gives `$action` and `$id`. `/tickets close 0042`
→ `$action=close`, `$id=0042`. Bare `/tickets` leaves both empty, which the routing table treats
as the default loop. Anything beyond the second positional (filters, `--on`, a quoted reason) is
read from `$ARGUMENTS` and passed through to the script verbatim.

### 4.4 Bare `/tickets` — the default loop

1. **Orient.** Read `CLAUDE.md` → `docs/00-vision.md` → `docs/01-architecture.md` →
   `docs/decisions/DECISIONS.md` (plus any ADRs in that directory) →
   `docs/capabilities/WORKFLOW.md`. If any is missing or visibly stale, **raise it before
   starting work.** Note the path difference from TicketSmith: this project uses a
   `docs/decisions/` directory, not a single `DECISIONS.md` at the docs root.
2. **Sync.** `git pull --rebase`, regenerate the index, report new inbox arrivals.
3. **Triage** if the inbox is non-empty (§4.5).
4. **Order.** Get the ready set from `tickets.mjs next --all --json`. **State the proposed order
   and the reasoning out loud, then wait for confirmation.** TicketSmith requires this and it is
   worth keeping: it is the operator's cheapest opportunity to redirect a session.
5. **Work tickets** through the six-step per-ticket procedure below.
6. **Stop** on any of: backlog empty · **~60% context used** (finish the current ticket cleanly,
   then stop) · blocked with nothing else ready · a test failure that reveals a deeper problem
   (file a ticket, stop) · operator interrupt.
7. **Session summary**, in this fixed format: Tickets closed · Tickets in progress · New tickets
   filed · **★ OPERATOR VALIDATION REQUIRED ★** (the consolidated checklist across every ticket
   closed this session — TicketSmith calls this the most important part of the summary, and it
   is) · Recommended next session.

### 4.5 `/tickets triage`

For each file in `tickets/inbox/`, oldest first:

1. Read the capture. It will be one or two sentences written by someone out of breath.
2. **Batch every clarifying question for that note** — and, if triaging several, for all of them
   — into **one round.** Never drip questions. This is TicketSmith discipline #2 and it is the
   difference between triage being a two-minute step and a twenty-minute one.
3. Expand into a real ticket: `## Description`, `## Acceptance criteria` as checkboxes,
   `## Notes`. Add the `bug`/`design` extra sections if the type calls for them.
4. Set `type`, `priority`, `size`, `capability`, `depends_on`. Keep `source: ui`, keep the
   original `created` timestamp (the idea's age is real information), keep the operator's
   wording in the Description where it is usable.
5. `tickets.mjs allocate` for the next `NNNN`; derive the immutable slug from the final title.
6. `git mv tickets/inbox/<file> tickets/open/NNNN-slug.md`.
7. Legitimate triage outcomes are not only "becomes a ticket": a note may be **merged** into an
   existing open ticket's `## Notes`, **deferred** (left in the inbox with a dated note saying
   why), or **declined** — in which case it is still moved to `closed/` with a `## Resolution`
   explaining the decline. Never delete it. TicketSmith's "never delete a ticket" applies to
   captures too; a declined idea that gets re-captured three months later should meet its own
   previous rejection.
8. Commit once for the batch: `tickets: triage inbox (N items)`.

### 4.6 `/tickets close 0042`

Refuse first, then act.

1. **Verify every acceptance criterion is checked.** If any is not, stop, name the unmet ones,
   leave the ticket open. Do not check a box on the ticket's behalf to make this pass.
   A `(operator)` criterion (§3.3.1) is never yours to tick: leave the ticket open, commit the
   work, and close it in a later session once the operator has run it and reported a result.
2. Append `## Resolution` — files touched, tests added, design decisions and their rationale,
   commit links. The honest record of what happened, not what was planned.
3. Append `## Operator validation` — concrete manual checks, naming screen and device for
   anything visual (§3.5).
4. If a real architectural decision was made, append an ADR under `docs/decisions/` and add the
   `D-xxx` to `DECISIONS.md`. Never edit an existing settled decision to make a ticket easier.
5. `tickets.mjs close 42` — sets `status: closed`, stamps `closed:`, `git mv`s to
   `tickets/closed/`, regenerates the index.
6. Commit **on its own**: `tickets(#0042): <title>`.
7. If anything in the backlog had `depends_on: [42]` or `blocked_by: [42]`, the script reports
   which tickets just became ready. Say so.

### 4.7 `scripts/tickets.mjs`

Node, no dependencies beyond the standard library and a small YAML parser vendored or pinned.
It is the deterministic half; **it makes no judgements and asks no questions.**

The split of responsibility is the key design decision here:

| `tickets.mjs` (deterministic) | `SKILL.md` (the model) |
|---|---|
| parse & validate frontmatter | decide what a ticket means |
| allocate the next `NNNN` | write acceptance criteria |
| compute the ready set from `depends_on`/`blocked_by` | ask clarifying questions |
| sort by priority → deps → id | propose approaches |
| `git mv` on close, stamp timestamps | write `## Resolution` honestly |
| regenerate `index.json` | write `## Operator validation` |
| emit compact JSON/table listings | judge whether criteria are actually met |

This is where Lost Soles diverges most from TicketSmith, and the reason is arithmetic:
TicketSmith has no executables, so `/tickets` must open every ticket into context just to sort
them. **`/tickets list` costs one table, not twelve file reads.** That is the difference between
a backlog that works at 60 tickets and one that doesn't.

#### Commands

```
node scripts/tickets.mjs <command> [args] [--json]

  index                      Walk tickets/{inbox,open,closed}/, parse all frontmatter,
                             write tickets/index.json. Idempotent.
  list [filters]             Table (or --json) from index.json. Never reads bodies.
                             --status --type --priority --capability --ready --size
  show <id>                  Emit one ticket's raw markdown + resolved dep statuses.
  next [--all]               The ready set, ordered. --all lists it; default emits one.
  allocate                   Print the next NNNN. Does not write.
  create --title T --type X --priority P [--capability C] [--size S]
                             Scaffold a ticket in open/ from the template. Prints the path.
  start <id>                 Stamp started:.
  block <id> --on <id> [--reason R]
                             Add the edge, set status: blocked, append a dated Notes entry.
  unblock <id> --on <id>     Remove the edge; if blocked_by empties, status returns to open.
  close <id>                 Set status/closed:, git mv to closed/, reindex. Refuses if any
                             acceptance checkbox is unchecked (--force is NOT provided).
  triage-move <inbox-file> --slug S
                             Allocate NNNN, rewrite frontmatter, git mv to open/.
  validate                   Full validation pass; exit 1 on any error.
```

Every command supports `--json` for machine-readable output; the skill uses `--json` and renders
the table itself only when showing the operator.

#### Frontmatter parsing

- Split on the leading `---` fence; everything before the second `---` is YAML, the rest is body.
- Parse with a real YAML parser — never a regex, and never `eval`. A title containing a colon or
  a `#` must round-trip.
- Serialize back with the same parser, preserving key order as specified in §3.1 so that diffs
  stay readable. Never reflow or re-quote the body.
- **The body is opaque to the script** except for one thing: counting acceptance-criteria
  checkboxes. It matches `- [ ]` and `- [x]` lines under `## Acceptance criteria` up to the next
  `##`. Anything else in the body is passed through byte-for-byte.
- Unknown frontmatter keys are preserved on rewrite and reported by `validate` as warnings, so a
  future field addition never silently loses data.

#### Dependency resolution for `next`

```
ready(T) ⟺ T.status ∈ {open, blocked}
         ∧ T.blocked_by = []
         ∧ ∀ d ∈ T.depends_on : ticket(d).status = closed

order: priority (high > med > low)  →  then id ascending
```

- A ticket whose `blocked_by` is non-empty is never ready, regardless of `depends_on`.
- A `depends_on` id that does not exist is a **validation error**, not a silent skip.
- The graph is checked for **cycles** on every `index` and `block`; a cycle is an error naming
  the participating ids. With one operator and a few dozen tickets, a cycle is always a mistake.
- `next` (single) additionally **refuses `size: l`** and exits non-zero with a message telling
  the skill to offer a split. `next --all` lists them, flagged.

#### Validation rules

Errors (exit 1):

- Frontmatter missing, malformed, or not parseable as YAML.
- A required field absent for the ticket's folder (§3.1).
- Any enum value outside its defined set.
- `id` does not match the filename prefix, or `slug` does not match the filename.
- Duplicate `id` anywhere across all three folders.
- `status` disagrees with the folder (`inbox` outside `inbox/`, `closed` outside `closed/`,
  `open`/`blocked` outside `open/`).
- `blocked_by` non-empty but `status` is not `blocked` (or vice versa).
- A `depends_on` / `blocked_by` id that does not exist.
- A dependency cycle.
- `closed:` present on an open ticket, or absent on a closed one.
- A ticket in `open/` or `closed/` missing any of `## Description`, `## Acceptance criteria`,
  `## Notes` or `## Operator validation` (§3.3). **Inbox items are exempt** — they are free-form
  captures and triage supplies the structure (§2.3).
- A closed ticket missing `## Resolution`.
- A `bug` missing `## Steps to reproduce` or `## Expected vs actual`.
- A `design` missing `## Options considered` or `## Open questions`.
- A closed ticket with an unchecked acceptance criterion.
- An `(operator)` criterion ticked with no `— verified YYYY-MM-DD: <result>` sign-off, in any
  folder (§3.3.1).

Warnings (exit 0, reported):

- `capability: null` on a `feature`.
- `size: l` on anything in the ready set.
- A `capability` value with no matching `docs/capabilities/NN-name.md`.
- An inbox item older than 14 days.
- An unknown frontmatter key.

**The body-section rules were added by ticket `0126` (D-170).** Until then §3 made the four
sections normative for every ticket while this list carried no rule for them — so a file with valid
frontmatter and **no body at all** validated clean. That was a disagreement between two sections of
this document rather than a defect in the implementation, which is why it was settled here first and
in the code second. The rules are expressed in `tickets.mjs` as a single `type`/folder → sections
table, so adding a type's required sections is a row rather than another branch.

TicketSmith explicitly ships no validator, noting the format is "intentionally simple enough that
a script could validate it." We ship the script. This is a deviation in tooling, not in method —
the format is unchanged, and `/tickets` still surfaces malformed frontmatter to the operator
rather than silently fixing it.

#### `index.json`

Generated, gitignored-or-committed either way (committing it makes the UI's cold-rebuild cheaper;
either choice is fine since it is derived). One entry per ticket: every frontmatter field, plus
`path`, plus `ready` (boolean), plus `acceptance: {checked, total}`. **No bodies.** Deleting it
is always safe.

### 4.8 The agent's workflow, end to end

```
/tickets
  ├─ sync            git pull --rebase; regenerate index; report new inbox items
  ├─ triage          inbox notes → numbered tickets   (batch ALL questions, one round)
  ├─ orient          CLAUDE.md, 00-vision, 01-architecture, decisions/, WORKFLOW.md
  ├─ order           ready set, sorted; STATE IT ALOUD; get confirmation
  └─ per ticket:
       1 understand  read the ticket + its capability doc; locate and skim the code
       2 clarify     ambiguity | public interface touched | genuine design fork |
                     new dependency needed | a documented constraint would be violated
                     → STOP and ask EVERYTHING AT ONCE. May proceed on other
                       unblocked tickets while waiting.
       3 propose     non-obvious solution → short proposal, confirm before building.
                     SKIP ENTIRELY for mechanical changes.
       4 implement   follow existing patterns; tests where there's a convention; run
                     them; real decision made → ADR in docs/decisions/ + a D-xxx
       5 close       verify criteria → Resolution → Operator validation → frontmatter
                     → git mv → its own commit `tickets(#NNNN): <title>`
       6 next
  └─ stop when: backlog empty | ~60% context | blocked with nothing ready
              | a test failure reveals a deeper problem (file a ticket, stop)
  └─ summary:  closed · in-progress · newly filed
             · ★ OPERATOR VALIDATION REQUIRED ★ · recommended next session
```

**Never:** close a ticket whose acceptance criteria aren't met · modify foundational docs
(`00-vision.md`, `DECISIONS.md`) to make a ticket easier · expand a ticket's scope · delete a
ticket · run anything destructive outside the repo · commit secrets · silently overwrite the
operator's uncommitted changes.

---

## 5. The in-app ticket UI

Required by **D-092**: manual ticket creation from the app UI, phone-friendly. **Create and
browse only in v1** (D-093 / §2.2 Move 2).

### 5.1 Placement

A route inside the Lost Soles app: **`/dev/tickets`**, gated to the owner. The app already
authenticates one human (D-014: owner plus ~5 friends someday); add a hard allowlist check on
top so this route is invisible and inaccessible to anyone else.

Being inside the app matters practically: it inherits the PWA shell, the session and the
home-screen icon. There is no second app to install and no second thing to log into with cold
hands. It also inherits the D-050 art direction, which is fine — but legibility wins over
atmosphere here as it does on the map (D-051). A capture form in lantern-light that you cannot
read in bright sun is a capture form that does not get used.

### 5.2 Screen 1 — Capture (the one that matters)

A full-width FAB on every `/dev` screen. Tapping it opens a sheet:

| Field | Control | Default | Required |
|---|---|---|---|
| **Title** | single-line text, **autofocused** so the keyboard is already up | — | **yes — the only required field** |
| Body | optional textarea, 3 rows, grows | empty | no |
| Type | chip row: `feature` · `bug` · `design` · `chore` | `feature` | no |
| Priority | chip row: `low` · `med` · `high` | `med` | no |
| — | **Save** button, thumb-reachable bottom-right | — | — |

That is the entire form. Two taps and a sentence: under fifteen seconds, one-handed, while
catching your breath.

**Resist every temptation to add** acceptance-criteria fields, a capability picker, a size
estimator, a dependency selector, or a slug field. All of that is triage's job (§4.5), done
later, at a keyboard, by someone who can think. **A capture form that takes ninety seconds is a
capture form that does not get used after a run** — and per D-013, a feature whose upkeep exceeds
its value gets abandoned. That constraint governs the ticket system exactly as it governs the app.

Interaction requirements:

- Autofocus the title and open the keyboard on sheet-open. No tap to focus.
- Save must be reachable by the right thumb without a grip change.
- Voice dictation must work — it is the fastest input mid-recovery, and it is why title is a
  plain text field with no formatting affordances.
- Chips are single-tap, no dropdowns, no long-press.
- Save dismisses immediately. **Never show a spinner.**

### 5.3 Offline and the capture queue

Connectivity is flaky outdoors, and the capture must never fail in a way the user notices.

1. On Save, write to **IndexedDB immediately** and render the new item optimistically at the top
   of the browse list with a "pending" marker.
2. Flush to `POST /api/dev/tickets` via a background-sync queue with exponential-backoff retry.
3. On a 2xx, mark the local row `submitted` and keep it visible until the webhook-refreshed cache
   confirms it, then drop the local copy.
4. Show a small **"N pending"** badge whenever the queue is non-empty. That badge is the only
   sync UI; there is no manual sync button.
5. Duplicate protection: each capture carries a client-generated UUID sent as an idempotency key
   so a retried flush cannot create two files.

### 5.4 Screen 2 — Browse

Read-only list from the cached mirror. Default filter `status != closed`, **grouped by
`capability`**, sorted priority-then-id within each group.

- Row: `#0042 · feature · high · Award half Wayfaring XP on explored ground`
- **Inbox items pinned at the top** with a distinct "untriaged" treatment, so the user can see
  their capture landed and can watch the untriaged pile grow.
- Filter chips: status, type, priority, capability. Nothing more.
- A `closed` filter exists but is not the default; `closed/` is an archive to consult, not a
  feed to scroll.

### 5.5 Screen 3 — Detail

Tap a row → rendered markdown detail view. Acceptance criteria render as **read-only** checkboxes
(they show state; they do not accept taps — tapping one would be an edit, and §2.2 Move 2
forbids edits). `depends_on` and `blocked_by` render as tappable links to those tickets, with
their current status inline. The capability name links to the rendered capability doc.

### 5.6 Non-goals for v1, stated explicitly

No editing. No closing. No reordering. No comments. No kanban board. No charts. No
notifications. No assignment (there is one human). Every one of those either breaks write-set
disjointness (§2.2) or is a feature nobody will use twice.

### 5.7 How the read cache stays fresh

The cache is a DynamoDB table, one row per ticket: parsed frontmatter, `path`, and the raw
markdown for the detail view. Keyed by path.

**Refresh path:**

1. A GitHub **push webhook** on the repo hits `POST /api/dev/tickets/webhook`.
2. The handler verifies the `X-Hub-Signature-256` HMAC (§6) and returns 202 immediately.
3. Asynchronously it walks the repo's `tickets/` subtree via the **Git Trees API**
   (`?recursive=1` on the pushed commit sha), fetches changed blobs, parses frontmatter, and
   **replaces the table wholesale**. A full walk of a few hundred small files is cheap enough
   that incremental diffing is not worth the bug surface.
4. A **cron backstop** (daily) does the same walk unconditionally, so a missed or failed webhook
   delivery self-heals within 24 hours.

The webhook fires for *both* writers — a phone capture's commit and the agent's `git push` after
a session both refresh the same cache through the same path. There is no second mechanism.

**Cache invariants, and they are the whole reason this is not Option C (§2.5):**

- It is **never written by the UI.** Captures go to GitHub; the cache learns about them from the
  webhook like everything else. (The optimistic local row in §5.3 lives in the phone's
  IndexedDB, not in the cache.)
- It is **never read by the agent.** The agent reads files.
- It is **always rebuildable** from the repo. If it is wrong, drop the table.

Read-after-write latency on the phone is one webhook round trip — a few seconds. The optimistic
local insertion covers it, so the user never perceives it.

---

## 6. Auth and security

The capture endpoint is a **write primitive pointed at your source repository.** Treat it like
one. Everything below is a requirement, not a suggestion.

### 6.1 Absolute rule

**No GitHub credential ever reaches the browser.** All GitHub calls happen server-side. There is
no client-side GitHub SDK, no token in a client-exposed env var, no token in `localStorage`, no
token in a service worker.

### 6.2 v1 credential — fine-grained PAT

Fastest to stand up, and adequate for a single-operator project.

- Scoped to **the single `lost-soles` repository**. Not "all repositories."
- Permission: **Contents → Read and write. Nothing else.** No Actions, no workflows, no admin,
  no metadata beyond what Contents requires.
- Expiry **90 days**, with a calendar reminder. GitHub permits up to a year; shorter is better
  for a token living in a Lambda.
- Stored in **AWS SSM Parameter Store as a `SecureString`** (or Secrets Manager), fetched at
  cold start and held in memory for the life of the execution environment. Never in the repo,
  never in a committed `.env`, never echoed into logs — and the logger must have a redaction
  rule for `ghp_`/`github_pat_` prefixes regardless.
- Drawback, acknowledged: it acts **as the user**, so commits are attributed to the user and the
  blast radius is whatever that token can reach. That is exactly why the repo scoping and the
  Contents-only permission are load-bearing rather than cosmetic.

### 6.3 v2 credential — a GitHub App

Recommended once the endpoint is stable. Not required for v1.

- A personal GitHub App owned by the user, installed on the one repo, Contents: read/write.
- Store App ID + private key PEM in the secret store; mint a JWT, exchange it for an
  **installation access token (1-hour TTL)**, cache that in memory across warm invocations.
- Advantages: a **separate bot identity** — commits show as `lost-soles-bot`, cleanly
  distinguishable from real work in `git log`, which matters when the whole project is built by
  an agent; short-lived tokens instead of a 90-day standing credential; no rotation chore; and
  revocation is a single uninstall.

(Note D-081: this endpoint must not be VPC-attached. It only needs outbound internet to
`api.github.com`, so it stays a plain internet-facing Lambda and no NAT Gateway is involved.)

### 6.4 Endpoint hardening

`POST /api/dev/tickets`

**Request body — the complete accepted schema:**

```json
{ "title": "string, 1..200",
  "body":  "string, 0..8192, optional",
  "type":  "feature|bug|design|chore",
  "priority": "low|med|high",
  "idempotencyKey": "uuid" }
```

Anything else in the body is **rejected**, not ignored. Reject-unknown-keys rather than
strip-unknown-keys, so a future client bug surfaces as a 400 instead of silently dropping data.

1. **Owner-only auth.** Require a valid Lost Soles session **and** check the user id against a
   hard-coded allowlist. Not "is logged in" — "is the owner." Even after D-014 adds friends,
   this route stays owner-only.
2. **The client never supplies the file path. This is the critical one.** The server derives it:

   ```
   path = "tickets/inbox/" + utcNow("YYYY-MM-DDTHHmm") + "-" + slugify(title).slice(0, 60) + ".md"
   ```

   `slugify` lowercases, replaces every non-`[a-z0-9]` run with `-`, and trims leading and
   trailing `-`. The result is then **re-validated** against `^tickets/inbox/\d{4}-\d{2}-\d{2}T\d{4}-[a-z0-9-]+\.md$`
   and anything failing that regex is a 500, not a fallback. A client-supplied path is a
   path-traversal bug that writes arbitrary files into your repository — including
   `.github/workflows/` and `.claude/`, either of which is remote code execution against the
   operator's machine or CI. There is no scenario in which the client needs to name the path.
3. **Enforce the prefix server-side**, independently of (2), as a second check immediately before
   the API call. Reject any computed path not beginning `tickets/inbox/`, and reject any path
   containing `..`, a leading `.`, a backslash, a null byte, or a `/` beyond the two in the
   prefix. Belt and braces: (2) makes traversal impossible, (3) makes a future refactor of (2)
   fail closed. Together they mean the endpoint **provably cannot touch source code,
   `.github/workflows/`, `.claude/`, `tickets/open/`, or `tickets/closed/`.**
4. **Create-only.** Call the Contents API **without a `sha`**, so an existing path returns 422
   rather than overwriting. The endpoint has no update path and no delete path — not disabled,
   *absent*. On a 422 from a same-minute collision, retry once with a `-2` suffix, then fail.
5. **Size and rate limits.** Title capped at 200 chars, body at 8 KB, total request at 16 KB.
   Rate-limit to **30 creates/hour** and 200/day per user, enforced server-side (a DynamoDB
   counter with a TTL is sufficient). A human capture endpoint has no legitimate burst; anything
   above this is a loop, a stuck retry, or an attack.
6. **Sanitize the YAML.** Emit frontmatter with a **real YAML serializer**, never string
   concatenation. A title containing `\n---\n`, or a leading `!!python/object`, or an unbalanced
   quote, must not be able to forge or break frontmatter. Strip control characters and normalize
   newlines in the title to spaces before serializing. The body is fenced below the frontmatter
   and is inert markdown, but strip null bytes there too.
7. **Verify the webhook.** Validate `X-Hub-Signature-256` as an HMAC-SHA256 over the **raw
   request body** against the webhook secret, using a **constant-time comparison**, on every
   delivery. Reject unsigned deliveries outright. The cache-refresh path is unauthenticated by
   nature and must not be forgeable — an attacker who can forge it can make the browse list say
   anything. Keep the raw body: parsing before verifying defeats the check.
8. **CORS locked** to the app's own origin. The route is same-origin anyway; the header is
   defence against a future subdomain mistake.
9. **Idempotency.** Store `idempotencyKey` with a 24-hour TTL; a repeat key returns the original
   result without a second commit. This is what makes the §5.3 retry queue safe.

### 6.5 Abuse cases and what stops them

| Case | Mitigation |
|---|---|
| Non-owner discovers `/api/dev/tickets` | (1) session + owner allowlist. Route returns 404, not 403 — do not confirm it exists. |
| Client sends `path: "../../.github/workflows/pwn.yml"` | (2) the field is rejected as an unknown key; the path is never read from input; (3) rejects it again if it somehow were. |
| Title crafted as `x\n---\nid: 1\nstatus: closed\n---\n` | (6) real YAML serializer + newline stripping. |
| Overwriting an existing ticket | (4) create-only, no `sha` passed. |
| Runaway retry loop from a buggy PWA | (5) rate limit + (9) idempotency key. |
| Forged webhook to poison the browse cache | (7) HMAC verification, constant-time. And the cache is disposable — worst case, drop it. |
| Stolen PAT | Repo-scoped, Contents-only, 90-day expiry. Blast radius is "can write files to one repo." Revocation is one click. v2's GitHub App reduces this to a 1-hour token. |
| Endpoint used as an exfiltration channel by writing large bodies | (5) 8 KB body cap, 30/hour. |
| Someone commits a secret through a capture body | The body is prose in `tickets/inbox/`. Standard secret scanning on the repo applies; also worth a push-protection rule. Note as an accepted residual risk: the operator can already commit secrets directly. |

### 6.6 A more paranoid variant, if wanted

Have the endpoint commit to a **`tickets-inbox` branch** rather than `main`, and let
`/tickets sync` merge it. This removes direct-to-default-branch write from the endpoint's
capability entirely, at the cost of one extra merge step per session.

Given that (2)–(4) already confine writes to `tickets/inbox/` and make them create-only,
direct-to-`main` is defensible for a single-operator project — but the branch variant is the
right call if the credential ever becomes a broader-scoped one, or if branch protection on
`main` is introduced for any other reason.

---

## 7. Bootstrapping

### 7.1 The chicken-and-egg, stated plainly

The backlog for building Lost Soles must exist **as tickets** before there is anything capable of
creating tickets. The `/tickets` skill is itself work that needs a ticket. The capture endpoint
is a capability that needs a capability doc. And D-001 says nothing gets built until the full
plan and the ticket backlog exist and the user signs off — so the backlog has to exist *before
the first line of app code*, let alone before there is an app to file tickets in.

**This is only awkward, not deadlocked, and the reason is §2's storage decision.** Because
markdown in the repo is the source of truth (D-093) and not the database, the ticket system's
day-one dependencies are: a directory, a text editor, and git. All three exist now. Everything
with a runtime — the script, the skill, the endpoint, the UI — is an *optimization* layered onto
a system that already works.

Had we chosen DB-as-truth (§2.5), this section could not be written: the ticket system would live
inside the app it is building, and there would be no order of operations that produces it.

### 7.2 Initial repository layout

Created by hand, before any code:

```
lost-soles/
├── CLAUDE.md                        # orientation. Points at everything below.
├── .gitignore
├── tickets/
│   ├── inbox/.gitkeep               # untriaged captures
│   ├── open/                        # NNNN-slug.md — seeded per §7.3
│   ├── closed/.gitkeep              # never deleted
│   └── index.json                   # generated; absent until tickets.mjs exists
├── docs/
│   ├── 00-vision.md                 ✓ exists
│   ├── 01-architecture.md           # to be written
│   ├── 03-integrations.md           ✓ exists
│   ├── 07-ticketsmith.md            ✓ this document
│   ├── TICKET_FORMAT.md             # §3 of this doc, extracted; what /tickets reads
│   ├── decisions/
│   │   ├── DECISIONS.md             ✓ exists — the running D-xxx register
│   │   └── NNNN-title.md            # per-decision ADRs, appended by the agent
│   ├── research/R1..R10-*.md        ✓ exist
│   └── capabilities/
│       ├── WORKFLOW.md              # copied verbatim from TicketSmith
│       ├── TEMPLATE.md              # copied verbatim from TicketSmith
│       ├── ROADMAP.md               # ours: which capability is next, not their designs
│       └── NN-name.md               # one per capability
├── prompts/
│   ├── CAPABILITY_DESIGN.md         # copied from TicketSmith
│   ├── CONSOLIDATION_PASS.md        # copied from TicketSmith
│   └── ARCHITECTURE_REVIEW.md       # copied from TicketSmith
├── scripts/                         # app scripts
└── .claude/skills/tickets/
    ├── SKILL.md
    ├── reference.md
    └── scripts/tickets.mjs
```

`WORKFLOW.md`, `TEMPLATE.md` and the three prompt files are **copied wholesale from TicketSmith**
(MIT, so this is a licensing non-event — retain the copyright notice). They are project-agnostic
by design and cost nothing to adopt. Only two edits are needed: point every reference at
`docs/decisions/` rather than a single `docs/DECISIONS.md`, and add the `inbox` state to
`WORKFLOW.md`'s description of the ticket lifecycle.

**Two divergences from TicketSmith's expected layout to note explicitly**, so a future session
does not "fix" them:

- `docs/decisions/` is a **directory** with `DECISIONS.md` inside it as the running register,
  plus per-decision ADR files. TicketSmith uses one append-only file at the docs root. Ours is
  better for a project where an agent appends decisions constantly — one file per decision avoids
  repeated edits to a growing shared file — and it matches what this repo already has.
- Design docs are numbered `NN-name.md` at the docs root. TicketSmith does not specify this;
  it is this project's existing convention and it stays.

### 7.3 Seeding

Ordered, and each step is usable before the next exists.

**Step 0 — the layout above, by hand, plus `CLAUDE.md` and `docs/TICKET_FORMAT.md`.**
No code. The methodology is fully operational at the end of this step: an agent can be told
"read `CLAUDE.md`, work `tickets/open/` in priority order, close per `TICKET_FORMAT.md`" and it
will work correctly, just without a script to make listing cheap.

**Step 1 — write the initial backlog by hand.** This is the step people want to skip and cannot.
Every ticket in `tickets/open/0001-*.md` … onward is authored by the planning session directly
into files, with real acceptance criteria, using the §3 format. Ordering by capability, roughly:

| Capability | Tickets | Notes |
|---|---|---|
| `00-ticket-system` | `0001` `tickets.mjs` — parse, index, list, validate<br>`0002` `tickets.mjs` — allocate, create, start, block, close, triage-move<br>`0003` `/tickets` SKILL.md + reference.md<br>`0004` dependency resolution + `next` + cycle detection | **The system bootstraps itself.** Built in the very first implementation session, by an agent following the hand-written methodology from Step 0. |
| `01-…` onward | the MVP backlog per D-122 | map + fog + skills + strength logging + Strava ingest |
| `NN-ticket-capture-endpoint` | endpoint, secret, rate limit, webhook, cache | §5.7, §6 |
| `NN-dev-tickets-ui` | capture sheet, browse, detail | §5 |

Ticket `0001` is written by a human-directed planning session and implemented by an agent that
does not yet have `/tickets`. That is fine — it has files and a documented format, which is all
`/tickets` ever gave it.

**Step 2 — the first implementation session builds `00-ticket-system`.** Four tickets, one
capability, and at the end of it `/tickets list` works. Every subsequent session uses the system
to build the app. Note the ordering property: **`tickets.mjs` and the skill are the only pieces
required for the agent to work.** Nothing in Steps 3–5 is.

**Step 3 — the capture endpoint, as its own capability.** This is where phone capture actually
starts working, and **it needs no UI.** A day-one stopgap worth building with it: an **Android
quick-capture** that POSTs `{title, body}` to the same endpoint. On Android the equivalents are a
**Tasker/MacroDroid HTTP Request task** bound to a home-screen or quick-settings tile, or a
**Google Assistant routine**, or simply a **PWA share-target** — dictate → done, without unlocking the phone or opening
anything. This works before the app UI exists, closing the D-092 gap early, and is likely to
remain the fastest capture path even afterwards. **The endpoint, not the UI, is the real product
here — build the endpoint first.**

**Step 4 — the `/dev/tickets` UI**, once the app has a shell, auth and a deploy. The read cache
and webhook land with it.

**Step 5 — phone-side editing.** Only if genuinely missed after a month of living without it.
Probably it will not be. See the narrow-extension note in §2.2 if it is.

### 7.4 Seeding the inbox is not part of this

Do not pre-populate `tickets/inbox/` with ideas. The inbox is a live capture channel, and an
inbox that starts full teaches the operator to ignore it. Ideas that exist today are either
tickets (write them properly in Step 1) or they are not work yet (they belong in
`docs/capabilities/ROADMAP.md`, which per TicketSmith discipline #4 *picks* the next capability
and does not *design* it).

### 7.5 The honest awkwardness

Three things about this bootstrap are unlovely, and naming them is cheaper than discovering them:

1. **The first four tickets are written in a format that nothing validates yet.** If Step 1's
   hand-authored tickets have a frontmatter error, `tickets.mjs validate` finds it only after
   `0001` ships. Mitigation: `0001` includes "run `validate` over the entire existing backlog and
   fix what it finds" in its acceptance criteria, and expect it to find something.
2. **Step 1 is a large, unglamorous authoring session with no tooling.** There is no way to
   shorten it. D-001 requires the backlog before the build, and the backlog is the thing being
   signed off on.
3. **D-092 is not satisfied until Step 3.** Between sign-off and the capture endpoint, post-run
   ideas go wherever they currently go — a notes app — and get hand-carried into `tickets/inbox/`
   at the start of a session. This is a real gap of days-to-weeks, and it is the strongest
   argument for building the endpoint and the Android quick-capture earlier than the UI that motivated
   them.

---

## Open questions

- **Q-07-1** Does `tickets/index.json` get committed or gitignored? Committing makes the read
  cache's cold rebuild cheaper and gives the UI a fallback if the Trees walk fails; gitignoring
  avoids a regenerated file in every diff. Leaning **committed** — it is small, and a noisy diff
  on a generated file is a smaller cost than a second code path. Decide at ticket `0001`.
- **Q-07-2** Exact capability numbering and the full MVP backlog decomposition. Out of scope for
  this document; that is the ticket-backlog phase (D-002).
- **Q-07-3** Whether `/tickets` should refuse to run with a dirty working tree. Probably yes for
  `close` and `triage` (both make commits), no for `list`/`show`/`next`. Decide at ticket `0002`.
