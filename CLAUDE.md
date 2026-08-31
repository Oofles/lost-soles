# Lost Soles — orientation

A fitness tracker where running permanently reveals a fog of war over a real map, wrapped in a
Runescape-style skill system. Single user. Fully planned; **read `docs/00-vision.md` before
proposing anything that changes what it is.**

**This file is loaded into every session. Everything below is operating procedure, not background.**

---

## Where things stand

Planning is complete — ~13,000 lines of design, ~70 recorded decisions, 121 tickets.
Check `tickets/closed/` to see what has actually been built.

## What to do at the start of a session

1. **Find the next tickets.**
   Three stages, because the tooling arrives in two steps — check which you are in:
   - **Once the `/tickets` skill exists** (ticket `0010`): `/tickets next`. Authoritative.
   - **Once `tickets.mjs` exists but the skill does not** (tickets `0007`–`0009` closed, `0010`
     open — *this is the current state*): call the script directly. It is fully working:
     ```
     node .claude/skills/tickets/scripts/tickets.mjs next        # what to pick up
     node .claude/skills/tickets/scripts/tickets.mjs next --all   # the whole ready set
     node .claude/skills/tickets/scripts/tickets.mjs show <id>    # why something is not ready
     node .claude/skills/tickets/scripts/tickets.mjs validate     # must be 0 errors
     ```
   - **Before either**: read **`docs/BUILD-ORDER.md`** — a precomputed topological order with
     session grouping. Take the first session whose tickets are not yet in `tickets/closed/`.
     It is a fallback; the script supersedes it once available.
2. **Propose the session's batch and confirm it before starting.** Do not silently start work.
3. Read each ticket in full, plus **only the design sections it cites**.

## Session protocol (D-151)

- **2–3 tickets per session** within a capability. They touch the same files and cite the same
  design sections; re-orienting per ticket re-reads the same pages three times.
- **Always clear context at a capability boundary.** Mid-capability, clear when context passes ~50%.
- **One ticket per session** in capabilities `08-map-and-fog-renderer`, `09-xp-engine-and-ledger`
  and `12-post-run-moment`. These are the overrun risks and a stale mental model costs most there.
- **The ticket's `## Resolution` is the context handoff.** Written properly, clearing costs nothing.
  Written lazily, clearing loses the session. This is the real reason Resolution is mandatory.

## Reading discipline

**Never read a design doc end to end.** They run 1,000–1,700 lines each; three of them is most of a
context window. Use **`docs/INDEX.md`** (once ticket `0120` lands) to find the section, then read
that line range only. Tickets cite the sections they need — trust the citation.

Read `docs/decisions/DECISIONS.md` in full at the **start of a capability**, not per ticket.

## Working agreement

- **Commit and push to `main` after every ticket close** (D-150). The ticket file moving to
  `tickets/closed/` and the code that satisfies it go in **one commit**: `NNNN: <title>`.
  No branches, no PRs. **Never commit a secret** — `gitleaks protect --staged` stops it.
- **Ask before implementing anything the plan does not cover** (D-152). If acceptance criteria don't
  settle a question, or implementation shows the design is wrong, **stop and ask**. Never widen a
  ticket's scope — file a new one with `source: agent`. A wrong design doc is a finding, not an
  obstacle: surface it, get a decision, record a new `D-xxx`.
- **Every capability closes with a drift audit** (D-153) — `docs/capabilities/AUDIT.md`.
  The rule: *if the code diverged from the design, either the code changes or the doc changes —
  never neither.* Capabilities `00` and `01` are audited by hand; from `02` onward
  `/tickets audit` runs it and blocks starting the next capability.

## Ticket workflow before the `/tickets` skill exists (through ticket 0010)

The methodology works with no tooling — that is the point of it.

- Find the next ticket with `tickets.mjs next` (see above), or `docs/BUILD-ORDER.md` if
  even the script does not exist yet.
- **Prefer the script over hand-editing** once it exists: `create`, `start`, `block`,
  `close` and `triage-move` maintain `index.json`, enforce the close preconditions, and
  `git mv` so history follows the file. Hand-editing silently skips all of that.
- To close: append `## Resolution` (files touched, decisions made, why) and `## Operator validation`
  (what you actually checked, on what device), set `status: closed`, add `closed:` as an ISO
  timestamp, and **move the file to `tickets/closed/`** in the same commit as the code.
- Ticket ids are **agent-allocated only**. Never renumber. Slugs and filenames are immutable.
- Format is normative in `docs/07-ticketsmith.md` §3 (and `docs/TICKET_FORMAT.md` once extracted).

## Hard constraints — violating these is a bug, not a preference

- **Adding a workout type is a data row, never code** (D-031/D-141). CI-enforced. If a change needs
  a `switch` on a skill id, the schema is wrong — stop and fix the schema.
- **The map never re-fogs** (D-020). Cell writes are append-only; `firstRunAt` writes with `min`,
  `lastRunAt` with `max`. Scoring uses `activity.startedAt`, never `now()`.
- **XP never decreases** (D-135). Corrections may only add.
- **No Strava-shaped type in `src/domain` or `src/pipeline`** (D-100). Grep-enforced.
- **No VPC-attached Lambdas** (D-081). A NAT Gateway is $33/mo — ten times the whole budget.
- **Legibility beats atmosphere, always** (D-051). Not a trade-off; a direction.
- **`activity:read_all`, never `activity:read`**, and the full `latlng` stream, never
  `summary_polyline` (D-121). A degraded trace permanently corrupts a map that cannot re-fog.

## Layout notes — do not "fix" these

Two deliberate divergences from TicketSmith's expected layout (`docs/07-ticketsmith.md` §7.2):

- **`docs/decisions/` is a directory**, with `DECISIONS.md` inside as the running `D-xxx` register
  plus per-decision ADR files. TicketSmith uses a single file at the docs root. A directory suits a
  project where an agent appends decisions constantly — one file per decision avoids repeated edits
  to a growing shared file.
- **Design docs are numbered `NN-name.md` at the docs root.** TicketSmith doesn't specify this; it
  is this project's convention and it stays.

**Branch model: trunk-based.** `main` is the only branch. Every ticket close commits and pushes
directly to it (D-150). No feature branches, no PRs for ordinary work — the PR gate (`0013`) exists
to run checks on pushes, not to gate a review that has no second reviewer.

## Map

| | |
|---|---|
| Why it exists, and what it refuses to be | `docs/00-vision.md` |
| Every decision + reasoning | `docs/decisions/DECISIONS.md` |
| What to build next | `tickets.mjs next` — or `/tickets next` once `0010` lands |
| Which capability is next | `docs/capabilities/ROADMAP.md` |
| Ticket format (short reference) | `docs/TICKET_FORMAT.md` — `07-ticketsmith.md` §3 is normative |
| Capability lifecycle | `docs/capabilities/WORKFLOW.md` *(lands in ticket `0005`)* |
| Capability close audit | `docs/capabilities/AUDIT.md` |
| **Canonical** `Activity`/`Trace`/`SourceAdapter` | `docs/contracts/ingestion-contract.md` |
| Architecture · data · integrations | `docs/01`, `docs/02`, `docs/03` |
| Game design · fog · UI | `docs/04`, `docs/05`, `docs/06` |
| Ticket system · security · roadmap | `docs/07`, `docs/08`, `docs/09` |
| Why a constraint exists | `docs/research/R1`–`R10` — expensive to establish, cheap to re-read |
