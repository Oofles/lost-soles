---
id: 170
slug: d-194-is-assigned-to-two-different-decisions-so-every-citati
title: D-194 is assigned to two different decisions, so every citation is ambiguous
type: bug
priority: high
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-05T23:12:00Z
started: 2026-09-27T03:48:57Z
---

## Description

`docs/decisions/DECISIONS.md` carries **two different decisions both numbered `D-194`**:

| Line | Decision | Ticket | Added |
|---|---|---|---|
| 1547 | *An adapter's OAuth routes are generic `[source]` routes; the vendor half lives on a connector* | `0032` | 2026-09-03 |
| 1583 | *The raw archive stores ONE content-addressed object per ingest* | `0035` | 2026-09-04 |

`0035` allocated a number that was already taken. Nothing catches this: `tickets.mjs validate`
does not read `DECISIONS.md`, and the register is append-only prose that nobody re-reads from
the top.

**Why it matters more than a numbering nit.** The register exists so a citation is a pointer to
one piece of reasoning. `03-integrations.md` §929 says *"SUPERSEDED by D-194"* and means the
archive layout; `tickets/closed/0032` says *"Recorded as D-194"* and means the OAuth routes. A
reader following either citation has a 50% chance of landing on an unrelated decision and
concluding the document is wrong about itself — which is exactly the failure the register is
supposed to prevent.

It is cheap to fix now (two commits old, six citations total) and permanent if left.

## Acceptance criteria

- [x] One of the two decisions is renumbered, and it is the LATER one (`0035`'s archive
      envelope) — renumbering `0032`'s would invalidate a citation in a document that has
      already been superseded on the strength of it.
- [x] Every citation of the renumbered decision is updated: `docs/03-integrations.md` §3.2's
      superseded note, `tickets/closed/0035-*.md` (three places), and any code comment.
- [x] The renumbered entry keeps a one-line note saying it was recorded as `D-194` by ticket
      `0035` and renumbered here, so a reader who followed a stale citation from outside the
      repo lands somewhere that explains itself.
- [x] A check makes a second collision impossible — the cheapest being a test that parses
      `DECISIONS.md`'s `D-xxx` headings and asserts they are unique and monotonic.
- [x] `D-195` and `D-196` (ticket `0036`) are left alone; they are already allocated and cited
      from `src/adapters/strava/normalize.ts`.

## Steps to reproduce

1. `grep -n "^- \*\*D-194" docs/decisions/DECISIONS.md`
2. Two hits, at different line numbers, with different subjects.

## Expected vs actual

**Expected:** a `D-xxx` names exactly one decision, forever.

**Actual:** `D-194` names two, and which one a citation means is decided by context the citation
does not carry.

## Notes

The uniqueness check is the durable half of this ticket, and it should probably also assert
**monotonicity** — a register whose numbers go backwards is one where a duplicate is about to be
introduced. `build-index.mjs` already walks the docs tree, so there is somewhere obvious for it
to live, though `0145` records that script as having no tests of its own.

Worth noting the allocation is the real problem: numbers are chosen by reading the file and
adding one, which is a read-modify-write with no lock, and every session is a concurrent writer
in the only sense that matters — none of them re-read before committing. A `tickets.mjs`
subcommand that allocated the next `D-xxx` the way it allocates ticket ids would remove the
class rather than this instance. That is bigger than this ticket; file it separately if the
check alone feels insufficient.

## Resolution

**0035's archive decision is now D-244; the capability 02 audit's decision is now D-245.** Both
renumbered IN PLACE, not moved to the end of the register: each sits under a section heading that
dates and explains it, and moving it would orphan that heading. Each carries a
*"Renumbered from D-xxx (ticket `0170`)"* sub-bullet as its first line, per criterion 3.

**Scope grew by one collision, with the operator's go-ahead.** Writing criterion 4's check exposed
a **second duplicate the ticket did not know about: `D-176`**, used by `0137` (2026-09-01, the
"a guard must prove it ran" rule, cited ~20 times across code and docs) and by the capability `02`
close audit (2026-09-02, the `01-architecture.md` §5/§6 amendments). The check cannot pass without
fixing it, so this was put to the operator before any edit: fix it here the same way, or check
uniqueness only and file it. They chose to fix it here. Same rule as criterion 1 — the LATER entry
moves — so the widely-cited guard rule keeps D-176.

**Every citation, by meaning, not by string.** D-176 is cited in ~35 places and only 14 of them
mean the audit decision, so the rewrite was per file after reading each hit's context:

| Renumbered | Files updated |
|---|---|
| D-194 → D-244 | `docs/03-integrations.md` §3.2 superseded note; `tickets/closed/0035-*.md` ×3 |
| D-176 → D-245 | `docs/01-architecture.md` ×3 correction blocks; `docs/capabilities/02-deploy-and-auth.md` ×9 (incl. the audit-record JSON's `forced` reason — still valid JSON); `tickets/closed/0142-*.md`; `tickets/open/0143-*.md` |

Left alone on purpose: D-194 citations meaning the OAuth routes (`tickets/closed/0032-*.md`),
`tickets/closed/0036-*.md`'s note that found this bug, every D-176 citation meaning the guard rule,
and D-195/D-196 (criterion 5). No code comment cited either renumbered decision.

**The check** — `scripts/decisions-register.test.mjs`, vitest, so it runs in `npm test` on the
gate and in the Amplify build. It parses top-level `- **D-nnn**` bullets and asserts: more than
150 parsed (an empty parse is not a clean one — D-176, fittingly); no id repeats; ids never go
backwards in file order outside a listed exemption; every exemption still exists AND is still
needed (so the list cannot rot into a blanket pass); and both renumbering notes survive.
Unit tests of the parser itself cover the collision, backwards and exemption paths.
**Negative control:** run against `HEAD`'s pre-fix `DECISIONS.md`, 4 of 8 fail, including the
uniqueness test naming D-176 and D-194; against the fixed file, 8 of 8 pass.

**Criterion 4 as built — monotonicity needed exemptions, and my first diagnosis was wrong.** I
told the operator the out-of-order entry was D-124 (after D-154); that came from a scan comparing
only adjacent entries. The real test showed **D-154** is the misplaced one — filed under
"Remaining open" beside the O-005 finding, between D-123 and D-124 — which pushed D-130…D-153 all
"backwards". Exemptions are therefore D-154, D-244 and D-245, each with its reason in the test.
Gaps (D-145, D-186 unused) are not an error and are not checked.

**Not done, deliberately.** The Notes suggest a `tickets.mjs` subcommand to allocate D-numbers as
it allocates ticket ids, which would remove the class rather than detect it. Not filed: the check
now makes a collision fail `npm test` on the next push and blocks the Amplify deploy, which is loud
enough for one writer. Worth filing if a third collision ever reaches CI.

Also: `DECISIONS.md` "Last updated" moved 2026-09-10 → 2026-09-26 (it had lagged D-240–D-243).
`D-160` ("tests use `node:test`") predates `package.json`; the other `scripts/*.test.mjs` already
use vitest, so this follows current practice rather than the letter of D-160.

Files: `docs/decisions/DECISIONS.md`, `docs/01-architecture.md`, `docs/03-integrations.md`,
`docs/capabilities/02-deploy-and-auth.md`, `tickets/closed/0035-*.md`, `tickets/closed/0142-*.md`,
`tickets/open/0143-*.md`, `scripts/decisions-register.test.mjs` (new).

## Operator validation

None needed from the operator: this is a documentation-integrity defect with nothing to look at.
Verified by agent on WSL2 (Ubuntu 26.04), 2026-09-26:
- `npx vitest run scripts/decisions-register.test.mjs` — 8/8 pass on the fixed register; 4/8 fail
  on `git show HEAD:docs/decisions/DECISIONS.md` (duplicate, ordering, exemption and note checks).
- `grep -n '^- \*\*D-\(176\|194\|244\|245\)\*\*' docs/decisions/DECISIONS.md` — exactly one line each.
- Full `npm test` 117 files / 2116 passed / 1 skipped; `npm run lint` clean; `tickets.mjs validate`
  0 errors; `build-index.mjs --check` up to date.
