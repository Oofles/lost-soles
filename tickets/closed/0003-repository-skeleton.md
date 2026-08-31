---
id: 3
slug: repository-skeleton
title: Create the repository skeleton per 07-ticketsmith §7.2
type: chore
priority: high
status: closed
size: m
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-08-30T00:00:00Z
---

## Description

Create the initial `lost-soles` repository layout by hand, before any code. This is
`07-ticketsmith.md` §7.2 / §7.3 **Step 0**: at the end of it the methodology is *fully
operational* with no tooling — an agent can be told "read `CLAUDE.md`, work `tickets/open/` in
priority order, close per `docs/TICKET_FORMAT.md`" and it will work correctly, just without a
script to make listing cheap.

Target layout:

```
lost-soles/
├── CLAUDE.md                        # orientation. Points at everything below.
├── .gitignore                       # 0004 owns its contents
├── tickets/
│   ├── inbox/.gitkeep               # untriaged captures — DO NOT seed (§7.4)
│   ├── open/                        # NNNN-slug.md — seeded by 0006
│   ├── closed/.gitkeep              # never deleted
│   └── index.json                   # generated; absent until tickets.mjs exists (0007)
├── docs/
│   ├── 00-vision.md … 09-roadmap.md ✓ exist
│   ├── TICKET_FORMAT.md             # §3 of 07-ticketsmith, extracted; what /tickets reads
│   ├── decisions/DECISIONS.md       ✓ exists, plus NNNN-title.md ADRs
│   ├── research/R1..R10-*.md        ✓ exist
│   └── capabilities/
│       ├── WORKFLOW.md              # 0005
│       ├── TEMPLATE.md              # 0005
│       ├── ROADMAP.md               # ours: which capability is next, not their designs
│       └── NN-name.md               # one per capability
├── prompts/                         # 0005 fills these
├── scripts/                         # app scripts
└── .claude/skills/tickets/          # SKILL.md, reference.md, scripts/tickets.mjs (0007–0010)
```

Repo settings from `01-architecture.md` §6: `github.com/Oofles/lost-soles`, **private**, default
branch **`main`** (a deliberate divergence — `devaultsecurity` uses `master`; Amplify branch names
drive deploy targets and per-branch secret namespaces, so decide once and be consistent).
Trunk-based: `main` is production, work happens on short-lived `feat/*` / `fix/*` branches merged
by PR, no long-running `develop`.

`docs/TICKET_FORMAT.md` is **generated from `07-ticketsmith.md` §3** and is the copy `/tickets`
reads. If the two ever diverge, 07 wins and both change in the same commit — say that in the file
itself.

Two divergences from TicketSmith's expected layout must be recorded in `CLAUDE.md` so a future
session does not "fix" them: (1) `docs/decisions/` is a **directory** with `DECISIONS.md` inside it
plus per-decision ADR files, not one file at the docs root; (2) design docs are numbered
`NN-name.md` at the docs root.

## Acceptance criteria

- [ ] ~~A private GitHub repo exists with default branch `main`.~~ **Moved to 0004** during
      planning review: neither the remote nor the first commit may exist before secret scanning
      does. This ticket ends with an initialised local repo and an uncommitted tree.
- [ ] Every directory in the tree above exists, with `.gitkeep` in `tickets/inbox/` and
      `tickets/closed/` so git tracks the empty directories.
- [ ] `tickets/inbox/` contains **only** `.gitkeep` — it is not pre-populated (07 §7.4: an inbox
      that starts full teaches the operator to ignore it).
- [ ] `docs/TICKET_FORMAT.md` exists and contains the frontmatter field table, all four enum
      definitions (`type`, `priority`, `status`, `size`), the `source` values, and the body-section
      list from `07-ticketsmith.md` §3.1–§3.3, including the `bug` and `design` extra sections and
      the close-time `## Resolution` / `## Operator validation` sections.
- [ ] `docs/TICKET_FORMAT.md` states, in its first paragraph, that `07-ticketsmith.md` §3 is
      normative and that divergence is fixed in both files in one commit.
- [ ] `CLAUDE.md` (already written — review and extend, do not rewrite) points at: `docs/00-vision.md`, `docs/01-architecture.md`,
      `docs/decisions/DECISIONS.md`, `docs/TICKET_FORMAT.md`, `docs/capabilities/WORKFLOW.md`, and
      `tickets/open/`. It states the two layout divergences above and the trunk-based branch model.
- [ ] `docs/capabilities/ROADMAP.md` exists and lists the nineteen capabilities from
      `09-roadmap.md` §3 in order, marking which one is next. It *picks* the next capability; it
      does not *design* one.
- [ ] `git log` on `main` shows a clean initial history: no `node_modules/`, no `.DS_Store`, no
      archive tarball, no `.claude/` content. (`01-architecture.md` §6 records that the existing
      repo tracks 2,229 `node_modules` files and a 19 MB `public.tar.gz` despite a `.gitignore`.
      Do not inherit that.)
- [ ] The existing `docs/*.md` design documents and `docs/decisions/` are present in the repo at
      the paths above.

- [ ] `git init`, `git config` identity set, `main` as the default branch. **Local only — no
      remote, no commit yet.** Creating the remote and making the first commit is 0004's job,
      because secret scanning must exist before anything enters history.

## Notes

**`CLAUDE.md` already exists** — written during planning (2026-08-30) so that the very first
session, and every cleared session before the tooling lands, starts oriented rather than blind.
This ticket **reviews and extends** it against the final layout; it does not author it. Check in
particular that its "Map" table matches what actually exists on disk after this ticket.


**Push protocol from here on (D-150):** after this ticket, every ticket close commits and pushes to
`main` automatically — the ticket file moving to `tickets/closed/` and the code that satisfies it
land in the same commit. No branches, no PRs for ordinary work.


`.gitignore` **content** is 0004's job and must land in or before the first commit that adds any
file — do not commit a tree without one. Sequencing: create the skeleton, write `.gitignore`
(0004), then make the initial commit.

`tickets/index.json` is deliberately absent until `tickets.mjs` exists (0007). Q-07-1 (index
committed vs ignored) is decided in 0007, not here.

The `.claude/skills/tickets/` directory is created here but populated by 0007–0010. Note the
tension with 0004: `08-security-privacy.md` §7.1 gitignores `.claude/` wholesale, so the skill
files need an explicit `!` un-ignore line — 0004 owns writing it, this ticket owns telling 0004
that the directory exists.

## Operator validation

1. On the laptop, in a desktop browser, open `github.com/Oofles/lost-soles`. Confirm the repo is
   **Private** (the badge next to the name), the default branch selector reads `main`, and the file
   listing shows `CLAUDE.md`, `docs/`, `prompts/`, `scripts/`, `tickets/`.
2. In the GitHub file browser, click into `tickets/` and confirm `inbox/`, `open/` and `closed/`
   are all present and that `inbox/` holds nothing but `.gitkeep`.
3. On the laptop, run `git clone` of the repo into a scratch directory and `du -sh` it. It should be
   a few hundred KB of markdown — if it is tens of megabytes, something is tracked that should not be.
4. Open `CLAUDE.md` on the phone via the GitHub mobile web view and read it top to bottom. It should
   be short enough to read on a phone screen and should tell a stranger where to start.

## Resolution

Local repository skeleton created. **No remote, no commit** — both moved to 0004 during planning
review, because secret scanning must exist before anything enters history.

**Done:**
- `git init`, default branch `main`, identity configured.
- Directories created: `prompts/`, `scripts/`, `.claude/skills/tickets/scripts/`,
  `docs/decisions/`. `tickets/inbox/.gitkeep` and `tickets/closed/.gitkeep` added so git tracks
  the empty directories. `tickets/inbox/` contains **only** `.gitkeep` (§7.4).
- `docs/TICKET_FORMAT.md` (239 lines) extracted verbatim from `07-ticketsmith.md` §3.1–§3.6, with
  a header stating that §3 is normative and divergence is fixed in both files in one commit.
- `docs/capabilities/ROADMAP.md` generated — all 19 capabilities with phase, ticket counts, and a
  computed **NEXT** marker. It picks; it does not design.
- `CLAUDE.md` reviewed and extended (it pre-existed): added the two layout divergences, the
  trunk-based branch model, and pointers to `TICKET_FORMAT.md`, `capabilities/ROADMAP.md` and
  `capabilities/WORKFLOW.md` (the last flagged as landing in 0005).

**Deferred to 0004, deliberately:**
- Remote creation and the initial commit.
- The clean-history criterion (`git log` shows no `node_modules/`, no `.DS_Store`, no tarball, no
  `.claude/` content) — unverifiable before a commit exists. **0004 must verify it**, and the
  existing devaultsecurity repo tracking 2,229 `node_modules` files despite having a `.gitignore`
  is the reason it is a criterion at all.
- `.gitignore` content, including the `!` un-ignore line for `.claude/skills/tickets/` — that
  directory now exists and is empty, so 0004 has something concrete to un-ignore.

**Consequence of the reordering, worth knowing:** this ticket's own closure cannot be committed,
because the first commit does not exist yet. It will be part of 0004's initial commit — so the
first commit in history contains both the skeleton and the closure of the ticket that made it.

## Operator validation

Run `git -C ~/lost-soles status`. Expect: on branch `main`, no commits yet, everything untracked.
That is the correct state — an uncommitted tree waiting for 0004's `.gitignore`.

Open `docs/capabilities/ROADMAP.md` and confirm the **NEXT** marker sits on `01-ticket-system`, and
that `00-preflight-and-repo` shows as in progress rather than complete — 0001 and 0002 are still
open and require AWS access this environment does not have.

Open `docs/TICKET_FORMAT.md` and check the frontmatter table, all four enum definitions and the
body-section list survived extraction intact.
