# 01-ticket-system

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`01-ticket-system\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (8)

- `0007` — tickets.mjs — frontmatter parse, index.json generation, list, and the validator
- `0008` — tickets.mjs — allocate, create, start, block, unblock, close, triage-move
- `0009` — Dependency resolution, the ready set, `next`, and cycle detection
- `0010` — The /tickets project skill — SKILL.md and reference.md
- `0011` — Validate the entire hand-authored backlog and fix everything it finds
- `0121` — /tickets audit — run the capability close audit and refuse to advance until it passes
- `0126` — validate: enforce required body sections on every ticket *(filed by 0011)*
- `0127` — create: slug derivation truncates mid-word and emits a trailing hyphen *(filed by 0011)*

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

## Backlog validation (ticket 0011, 2026-08-30)

### First run, verbatim

Run over `tickets/{inbox,open,closed}/` — 125 files, before any change was made:

```
$ node .claude/skills/tickets/scripts/tickets.mjs validate

  0 error(s), 0 warning(s)
$ echo $?
0
```

That is the complete output. **Zero errors and zero warnings**, which `07-ticketsmith.md` §7.5 says
to treat as suspicious rather than as a pass. The rest of this section is the work of proving it.

### Warnings: none, and why that is legitimate

There were no warnings to justify. The one warning the ticket expected — `size: l` on 0006 — did not
fire, and that is correct rather than a miss: the rule is `size === "l" && isReady(...)`, and 0006 is
closed, so it is not in the ready set. Confirmed by re-testing the rule on a ticket that *is* ready
(injection 16b below), where it fires as designed.

### Proving the validator can fail

The clean result is only meaningful if the validator is capable of reporting a dirty one. Seventeen
deliberate defects were injected into a **scratch copy** of the backlog — `TICKETS_ROOT` pointed at a
throwaway tree, the real `tickets/` was never modified — one defect per run, each from a fresh copy.

**All seventeen were caught. Every error case exited 1; every warning case exited 0 as designed.**

| # | Injected defect | Rule fired | Exit |
|---|---|---|---|
| 1 | `depends_on: [9999]` on 0012 | `dangling-ref` | 1 |
| 2 | 0013 renumbered to id 12 | `duplicate-id` + 3 cascading `dangling-ref` + `self-edge` | 1 |
| 3 | `priority: urgent` | `enum` | 1 |
| 4 | file renamed, frontmatter left alone | `filename` | 1 |
| 5 | 12→13 and 13→12 | `cycle` (`0012 → 0013 → 0012`) | 1 |
| 6 | `capability:` deleted | `required-field` + `no-capability` warn | 1 |
| 7 | `depends_on: [12]` on 0012 | `self-edge` + `cycle` | 1 |
| 8 | open ticket with `status: closed` | `status-folder` | 1 |
| 9 | non-empty `blocked_by`, `status: open` | `blocked-status` | 1 |
| 10 | `slug: Nextjs_Amplify` | `slug` | 1 |
| 11 | closed ticket, `## Resolution` renamed | `closed-section` | 1 |
| 12 | closed ticket, one box un-ticked | `closed-unchecked` | 1 |
| 13 | closed ticket, `closed:` stamp deleted | `closed-stamp` | 1 |
| 14 | bug ticket, `## Steps to reproduce` renamed | `bug-section` | 1 |
| 15 | `capability: 02-deploy-and-authz` | `missing-capability-doc` *(warn)* | 0 |
| 16b | `size: l` on a **ready** ticket | `size-l-ready` *(warn)*, and `next` refuses it outright | 0 |
| 17 | `assignee: nobody` added | `unknown-key` *(warn)* | 0 |

Injection 2 is the most reassuring: renumbering one ticket produced five errors, because three other
tickets still pointed at the id that vanished. That cascade is what a real hand-authoring mistake
looks like, and the validator traced all of it.

Injection 16 was initially recorded as a **miss** — `size: l` on 0012 produced nothing. It was not a
miss: 0012 depends on the still-open 0011, so it is not in the ready set and the rule correctly
stayed quiet. Re-run against 0011, which *is* ready, it fires. Recorded here because the first
reading was wrong and the correction is the useful part.

### What the validator does not check

Four further probes were expected to fail and **passed clean**. These are real gaps, filed as
[`0126`](../../tickets/open/0126-validate-required-body-sections.md) rather than fixed here, because
0011's own rule is that fixes go in the tickets and a questionable rule is a separate argument:

| Probe | Result |
|---|---|
| open ticket missing `## Operator validation` | not caught |
| open ticket missing `## Description` **and** `## Acceptance criteria` | not caught |
| ticket body **deleted entirely**, frontmatter only | not caught |
| `type: design` with no `## Options considered` / `## Open questions` | not caught (latent — no `design` tickets exist) |

Body-structure checks exist only for `closed` tickets and for `type: bug`. **This is not the
validator failing to implement its spec** — it is exactly what `07-ticketsmith.md` §4.7 lists, and
§4.7 is implemented in full (see below). The gap is *between two sections of the design*: §3 makes
the four body sections normative for every ticket, and §4.7's rule list does not carry a check for
them. A frontmatter-only file therefore validates clean while being invalid per §3.

That makes `0126` a design question — should §4.7 gain the rule? — rather than a straightforward
bug, and it is written that way. Recorded as divergence 1 in the audit below.

### `07-ticketsmith.md` §4.7 conformance

Every rule the spec lists is implemented, and the injection pass exercised most of them directly:

- **13 of 13 error rules present.** 12 were proved by injection above; the 13th (frontmatter
  missing or unparseable) is covered by the 0007 unit tests rather than by an injection.
- **5 of 5 warning rules present.** Three were proved by injection (`missing-capability-doc`,
  `size-l-ready`, `unknown-key`), a fourth (`no-capability`) fired incidentally during injection 6,
  and the fifth (`stale-inbox`) is unreachable today because `tickets/inbox/` is empty by design
  (`07-ticketsmith.md` §7.4 says not to seed it).

No rule in §4.7 is missing, and no rule exists in the code that §4.7 does not authorise.

### The four known oddities, with an opinion on each

The ticket asked for a position rather than a fix on each of these.

1. **Forward dependencies** — `0068→0070`, `0069→0070`, `0108→0110`, `0109→0110`. All four are real
   and all four are **fine**. `0070` depends only on `0025` and `0110` only on `0107`, so neither
   closes a loop; the cycle check confirms it. A ticket depending on a higher id just means the
   authoring order did not match the dependency order, which is expected when ranges are written in
   parallel. **No fix, and no rule** — a "forward dependency" warning would fire on four correct
   tickets and teach the operator to ignore warnings.
2. **0006 closed-on-arrival** — correct. It records work genuinely finished before the tooling
   existed. Back-dating it into `open/` to make the history look tidier would make the record false.
3. **Capability docs are stubs** — true, and every one of the 19 carries an explicit stub banner
   pointing at `09-roadmap.md` §3 as authoritative. They are placeholders that admit what they are,
   which is the honest state; they fill in at each capability's DESIGN step. Not a defect.
4. **Should `size: l` be an error?** — **No, and the current split is better than either extreme.**
   `validate` warns only when an `l` ticket is *ready*, and `next` refuses to hand one over at all
   (exit 1, with instructions to split it). Enforcement sits at the moment of pickup, where the
   operator can act, instead of failing CI over a ticket nobody is going to touch for six weeks.
   Recorded as **D-161**.

### What hand-authoring got wrong

The honest record §7.5 asks for. **`tickets.mjs` found zero format errors across 125 files** — but
that number is only meaningful next to what an earlier pass had already removed.

| Category | Count | Found by |
|---|---|---|
| Missing cross-capability dependency edges | 8 | ad-hoc validator, during 0006 |
| Capability values with no doc | 19 | ad-hoc validator (stubs generated) |
| `size: l` tickets needing a split | 2 (0055, 0056 → 0118, 0119) | ad-hoc validator |
| Dangling `depends_on`, duplicate/skipped ids, cycles, self-edges | **0** | both passes |
| Frontmatter format errors (enum, filename, slug, required field) | **0** | `tickets.mjs` |
| **Prose splice inside a ticket body** | **1** (0011 itself) | human reading, not tooling |
| Validator coverage gaps | 4 | 0011's injection pass |
| Tooling ergonomics defects | 1 (`create` slug truncation) | using the tool at scale |

The conclusions worth carrying into any future seeding:

- **Hand-authoring 117 tickets produced no structural errors, and that is not luck** — it is because
  ids, dependencies and enums are mechanical, and the authoring pass was careful about the mechanical
  parts. The structural error classes 0011 predicted did not materialise.
- **What hand-authoring actually got wrong was prose, and only prose.** The single defect found in
  this ticket's own file is a paste that landed in the middle of a bullet, truncating it at
  ``its `## Notes`` and stranding its tail eighteen lines below. No validator would have caught it;
  it was found by reading the ticket in order to work it. **The format is checkable and was correct;
  the writing is not checkable and was not.**
- **A clean validator run says nothing about a backlog until you have proved the validator bites.**
  The seventeen injections took longer than the validation did, and they are the only reason the
  zero is worth anything. Doing this once, at the moment the validator ships, is the right cost.
- **Using the tooling at scale is itself a test.** Filing two tickets surfaced a `create` bug that
  1,000 lines of reading would not have.

## Design notes

**No DESIGN step ran for this capability, deliberately.** `01-ticket-system` was built straight from
`09-roadmap.md` §3 and the normative spec in `07-ticketsmith.md` §3–§4.8, which between them already
specify the frontmatter schema, the validation rules, the ready-set predicate and the skill layout in
more detail than a DESIGN session would have produced. Inventing a second design document over the
top would have created exactly the two-sources-of-truth problem that `0126` now exists to resolve.

Recorded here so the empty section is read as a choice rather than an omission. From capability `02`
onward the DESIGN step runs normally — those capabilities are not pre-specified to this depth.

## Audit

Run by hand at close, 2026-08-30, against [`AUDIT.md`](AUDIT.md). Capabilities `00` and `01` are
audited manually; `/tickets audit` (ticket `0121`) automates this from `02` onward.

Much of AUDIT.md targets application code that does not exist yet. Items are marked **n/a** with a
reason rather than silently ticked — a checklist that is 60% dishonest ticks is worse than no
checklist.

### 1. Automated

| Check | Result |
|---|---|
| `tsc --noEmit`, ESLint, `vitest` | **n/a** — no `src/`, no `package.json` until `0012`. The equivalent gate today is `node --test`, per D-160. |
| Test suite | **pass** — 48/48 in `tickets.test.mjs`, 13 suites. |
| Invariant sweep (`I-1`…`I-30`) | **n/a** — those invariants are about the domain model, which starts at `04`. |
| Boundary greps (`strava` in `src/domain`) | **n/a** — no `src/` yet. |
| Vigil test (D-031/D-141) | **n/a** — no skill schema yet; lands in `04`. |
| `validate` clean across `open/` + `closed/` | **pass** — 0 errors, 0 warnings, 125 files. |

One process finding: running `node --test <directory>` over the scripts directory reports a spurious
failure on Node 23.11.1, because it tries to execute `tickets.mjs` itself (which prints usage and
exits 1). CI and `.githooks` both invoke the **explicit file path**, so this never fires in practice.
Worth knowing before someone "helpfully" changes CI to the directory form.

### 2. Design conformance

Sections cited by this capability's tickets: `07-ticketsmith.md` §3, §4.1–§4.8, §7.2–§7.5;
`09-roadmap.md` §3, §4.1.

**Two divergences. Drift budget is three, so this capability passes without a DESIGN session.**

1. **§3 and §4.7 disagree about whether a ticket body may be empty.** §3 makes `## Description`,
   `## Acceptance criteria`, `## Notes` and `## Operator validation` normative for every ticket;
   §4.7's error list contains no rule for them, and the validator implements §4.7 exactly. A
   frontmatter-only file validates clean. **Resolution: the design was wrong (incomplete), and the
   fix is scoped to [`0126`](../../tickets/open/0126-validate-required-body-sections.md), which
   amends §4.7 and records a `D-xxx` before touching the validator.** Not fixed inline, because
   0011's own scope is format, not plan.
2. **`create` cannot derive a valid slug from a long title.** `tickets.mjs:383` trims hyphens before
   truncating, so the truncation can reintroduce a trailing hyphen and fail `SLUG_RE`. **Resolution:
   the code was wrong; filed as
   [`0127`](../../tickets/open/0127-create-slug-trailing-hyphen.md).**

Not counted as divergences, because both are recorded deliberate choices rather than drift:

- `docs/decisions/` is a directory and design docs are `NN-name.md` at the docs root — both
  divergences from TicketSmith §7.2, both documented in `CLAUDE.md` and `TICKETSMITH-DIFF.md`.
- `${CLAUDE_PROJECT_DIR}/...` rather than `${CLAUDE_SKILL_DIR}/...` in the skill frontmatter —
  verbatim from §4.2 by `0010`'s requirement, noted above under the skills verification.

**Canonical contract** (`docs/contracts/ingestion-contract.md`): **n/a** — this capability touches no
domain type.

**Decisions quietly falsified:** none. D-155 (`.githooks`, `core.hooksPath=.githooks` ✓), D-158
(dirty-tree refusal, tested ✓), D-159 (`index.json` committed and not gitignored ✓), D-160
(`node:test` ✓) all still hold as written. D-161 is added by this ticket rather than superseding
anything.

### 3. Operator validation

All 11 closed tickets carry a substantive `## Operator validation` section (29–72 non-blank lines
each); none is a restatement of the instruction and none is a bare "None". **n/a** for the USE-step
run requirement — this capability touches neither map, run log, nor XP.

### 4. Regression against earlier capabilities

`00-preflight-and-repo` is the only earlier capability. Nothing in `01` altered its outputs: the
`.gitignore`, the gitleaks hook and the repo skeleton are untouched, and the secret-scanning hook was
exercised by every commit in this capability. `explored-r10.bin` and the XP checks are **n/a** — no
map or ledger exists yet.

### 5. Cost and hygiene

- **AWS spend: n/a** — this capability created no AWS resources. Nothing to check in Billing.
- **No `blocked_by` points at a closed ticket** — no ticket in the backlog has a non-empty
  `blocked_by` at all.
- **Discovered scope was filed, not absorbed** (D-152): `0126` and `0127`, both `source: agent`.

## Reflection

**What the design got right, non-obviously.** Specifying the validator's rules as a flat list in
§4.7 — rather than as prose — meant conformance could be checked line by line at audit time, and the
answer was unambiguous. That is why divergence 1 could be classified as a *design* gap in about two
minutes instead of being argued about. A spec written as a checklist audits itself.

Also right: refusing `size: l` at `next` rather than at `validate` (now D-161). It puts the
enforcement where the operator is already paying attention, and it is the reason a `size: l` ticket
can sit honestly in the backlog for months without anyone being tempted to lie about its size.

**What the design got wrong.** §3 and §4.7 were written as if they could not contradict each other,
and they did. The format section and the validation section describe the same object from two angles,
and nothing forced them to agree — so an empty ticket body is simultaneously invalid (§3) and
accepted (§4.7). Any future spec that describes a format in one place and its checker in another
should state explicitly which one governs.

**Estimate vs actual.** Roadmap §3 sized this capability at 5 tickets; it closed at 8. The three
extra are `0121` (the audit command, correctly foreseen as capability work rather than a ticket) and
`0126`/`0127`, both discovered by *using* the tooling rather than by reading it. That ratio is worth
remembering: two of the three additions came from the last hour of work, not the planning.

**The thing that actually mattered this session.** The validator reported a clean backlog on the
first run, and the ticket was written in advance to distrust exactly that. The seventeen injections
took longer than every other part of 0011 combined, and they are the only reason the clean result
means anything. Without them this capability would have closed on an unfalsified assertion — which
is indistinguishable, from the outside, from a validator that returns `0 errors` unconditionally.

**What the next capability should do differently.** `02-deploy-and-auth` is the first capability with
real application code, and the first where the audit's automated half actually runs. Two things:

1. **Wire `tsc --noEmit`, ESLint and the test runner into `.githooks` and CI in `0013`, not later.**
   This capability got away with a hand-run test suite because there were 48 tests and one file. That
   stops being true immediately.
2. **Do not carry the "n/a with a reason" habit into `02` as a shortcut.** It was honest here because
   the checks genuinely had no subject. From `02` onward most of them have one, and an "n/a" that
   should have been a "fail" is precisely the drift D-153 exists to catch.

