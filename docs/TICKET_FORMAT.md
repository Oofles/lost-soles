# Ticket format

**`docs/07-ticketsmith.md` §3 is normative.** This file is extracted from it so `/tickets` and any
session has a short reference to read instead of a 1,200-line design document. If the two ever
diverge, **07-ticketsmith wins, and both files are corrected in the same commit.**

Generated from `07-ticketsmith.md` §3.1–§3.6 on 2026-08-30.

---

### 3.1 Frontmatter fields

| Field | Required | Type | Values / rules |
|---|---|---|---|
| `id` | open/closed only | integer | Sequential, **agent-allocated only**. Written as an int in YAML, always *displayed* zero-padded to 4 digits. Matches the filename prefix. Does not reset between `open/` and `closed/`. Absent on inbox items. |
| `slug` | open/closed only | string | kebab-case, `^[a-z0-9]+(-[a-z0-9]+)*$`, **immutable once assigned**, matches the filename. Absent on inbox items (the timestamp filename carries a provisional slug that triage may replace). |
| `title` | yes | string | Human-readable, editable. Max 200 chars. |
| `type` | yes | enum | `feature` · `bug` · `design` · `chore` · `refactor` · `docs` |
| `priority` | yes | enum | `high` · `med` · `low` |
| `status` | yes | enum | `inbox` · `open` · `blocked` · `closed` |
| `size` | open/closed only | enum | `s` · `m` · `l` |
| `capability` | open/closed only | string \| null | `NN-name`, matching a file at `docs/capabilities/NN-name.md`. `null` is legal for genuinely standalone chores; the validator warns, it does not error. |
| `depends_on` | open/closed only | int[] | Ticket ids. Planned ordering constraints. `[]` when none. |
| `blocked_by` | open/closed only | int[] | Ticket ids. Discovered ordering constraints. `[]` when none. Non-empty ⇒ `status: blocked`. |
| `source` | yes | enum | `ui` · `agent` · `operator` — provenance. |
| `created` | yes | ISO 8601 UTC | Set once, never edited. |
| `started` | no | ISO 8601 UTC | Stamped by `/tickets start`. Omitted until then. |
| `closed` | closed only | ISO 8601 UTC | Stamped by `/tickets close`. Omitted while open. |

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

**`status`** — four values. `inbox` and `closed` mirror their folders exactly. `open` and
`blocked` **both live in `open/`**; `blocked` is derived from `blocked_by` being non-empty.
Keeping the folder as the coarse state preserves TicketSmith's "status mirrors the folder" rule
while giving structured blocking somewhere to live. There is deliberately no `in-progress`
status — `/tickets start` stamps `started:` instead, so an abandoned session leaves a timestamp
rather than a stuck state that has to be cleaned up.

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

**Appended only at close time, by the implementer:**

- `## Resolution` — files touched, tests added, design decisions and rationale, commit links.
- `## Operator validation` — see below.

### 3.3.1 `(operator)` criteria

A criterion prefixed **`(operator)`** needs a human, a device and eyes — no agent can check it.

```markdown
- [ ] (operator) Typing `/tickets` shows the skill with its `argument-hint`
- [x] (operator) Ran it on the Pixel — verified 2026-08-31: passed, no restart needed
```

Ticking one requires the inline dated result. `close` refuses while one is unchecked (leave the
ticket open and close it later, once a human has run it) and refuses one ticked without a sign-off;
`validate` errors on the latter in every folder.

`0010` ticked such a criterion in advance and shipped a skill that never registered (`0123`, `0124`).
Full rules in `07-ticketsmith.md` §3.3.1, which is normative.

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

Every UI ticket's validation section names **a screen, a device, and what to look at.** "None"
is permitted but push back hard: TicketSmith's `WORKFLOW.md` lists "closing tickets without
honest operator validation" as an anti-pattern — *"If the validation section is always 'None,'
nobody is checking the work. That's not validation; that's hope."*

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

