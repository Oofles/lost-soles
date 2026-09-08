---
id: 161
slug: invariant-sweep-activation-rule
title: The invariant sweep arms on the first citation and cannot go green until capability 18
type: bug
priority: high
status: open
size: m
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-04T17:03:08Z
started: 2026-09-08T17:37:43Z
---

## Description

Found by the `04-domain-contract-and-rules` drift audit, which it blocked.

`0133` specified the invariant sweep as **`na` while no test cites any `I-n`, and all-or-nothing
the moment one does**. That trigger is wrong, and capability `04` is where it first bites.

`src/rules/validate.test.ts` correctly cites **I-26** — §3.8 checks 3 and 4 *are* I-26, so the
citation is exactly what the sweep was built to reward. One comment flipped the row from `na` to
`FAIL 29/30`, demanding citations for all thirty invariants. **The ticket that supplies them,
`0116`, sits in capability `18-mvp-hardening`** — fourteen capabilities away, and correctly so:
most of the thirty are about the fog, the ledger and the rebuild drill, none of which exist yet.

So as written the sweep now fails **every capability from `04` through `17`**, for a backlog that
is behaving exactly as planned. A gate that cannot go green until the last capability is not a
gate; it is a row everyone learns to scroll past — which is the precise failure `0133`'s own
reasoning invoked when it chose `na` over thirty red rows on an empty repo. The right lesson was
applied at the wrong end of the timeline.

**Two defects, and the second is the cheaper one to get wrong.**

1. **The activation rule is binary.** It should track the invariants that are *live* — an
   invariant whose subsystem does not exist cannot have a test, and 0116's remit is precisely to
   settle "a test, or a written reason it cannot have one" for each. Until then the sweep should
   report progress, not a pass/fail verdict on work that is not due.
2. **A citation is any `I-\d+` in a test file, including prose.** The one live citation is a
   sentence in a comment, not an assertion. That is the same weakness that tripped the sweep on
   its own fixture during `0133` (fixed then by scoping to `src/`, `app/`, `lib/`, `scripts/` —
   which narrowed *where* it looks, not *what counts*). A sweep satisfiable by writing `I-7` in a
   comment measures nothing.

## Steps to reproduce

```
node .claude/skills/tickets/scripts/tickets.mjs audit 04-domain-contract-and-rules
#   FAIL  invariant-sweep   29/30 invariants have no citing test: I-1, I-2, I-3 [S], ...
```

Every closed ticket in `04` is green; the only live citation is
`src/rules/validate.test.ts:252`, a comment reading *"These fire at SEED time, not run time
(invariant I-26)."*

## Expected vs actual

**Expected:** the sweep reports how many *applicable* invariants are cited, and fails only on a
regression — an invariant that had a citing test and lost it — or once `0116` has declared the
full set. A capability that added a correct citation should not be punished for the twenty-nine
it was never scheduled to write.

**Actual:** the first correct citation anywhere in the repo arms a gate that nothing can satisfy
until capability `18`, and it stays red for every audit in between.

## Acceptance criteria

- [x] The sweep no longer fails a capability audit merely because invariants outside that
      capability's scope have no citing test.
- [x] It still **fails** on a real regression: an invariant that was cited and no longer is.
      A test proves this by removing a citation.
- [x] Whatever the new rule is, it is stated in `docs/capabilities/AUDIT.md` §1 alongside the
      other checks, so the row's meaning is readable without opening the script.
- [x] A citation is something stronger than an `I-\d+` anywhere in a test file. The form is this
      ticket's to choose and to write down — a decision worth a `D-xxx` either way, including
      the decision to keep prose and say why.
- [x] `audit 04-domain-contract-and-rules` reports the sweep honestly under the new rule, and
      the reason string names what would change the verdict.
- [x] `0116`'s remit is unchanged and the ticket says so — this ticket fixes the gate's timing,
      it does not do the sweep or reduce what `0116` must still deliver.
- [x] `tickets.test.mjs` covers the new rule, including the `na` → live transition.

**Added 2026-09-08 — the `vigil-test` detector, widened into this ticket on the operator's
instruction** (the Notes below offered to file it separately; the operator said solve it now):

- [x] `vigil-test` finds `src/rules/registry-delta.test.ts` and runs it, rather than reporting
      `n/a — no vigil test exists yet` four capabilities after `0030` shipped it.
- [x] It is found by something a justified rename cannot switch off, and the rule is written in
      `AUDIT.md` §1 next to the check.
- [x] `tickets.test.mjs` covers it, including the `n/a` reason naming what would activate it.

## Notes

**Do not fix this by reverting to `na` until capability 18.** That trades a gate that always
fails for one that never fires, and loses the regression detection in the second criterion —
which is the only part of this check delivering value before `0116` runs.

Related: the same audit found `vigil-test` reporting
`n/a — no vigil test exists yet, ticket 0030 puts it permanently in CI` **after `0030` closed**
and shipped `src/rules/registry-delta.test.ts`. Probably one stale detector rather than two, and
worth checking while in this code — but if it turns out to be independent, file it separately
rather than widening this ticket.

## Resolution

**Files touched**

- `.claude/skills/tickets/scripts/tickets.mjs` — `invariantSweep()` rewritten as a ratchet; new
  `citedInvariants()`, `citationRatchet()`, `advanceRatchet()`, `vigilTests()`; `--record` now
  raises the high-water mark and prints what it added. `vigilTests` and `citedInvariants` exported.
- `.claude/skills/tickets/scripts/tickets.test.mjs` — the 0133 sweep test rewritten for the new
  rule, and a new `0161` block: ratchet advance, the regression FAIL, the `complete: true`
  transition in both directions, a corrupt ratchet file, numeric `I-n` ordering, the vigil marker.
  136 tests, all passing.
- `docs/capabilities/AUDIT.md` §1 — the sweep bullet restated as a ratchet; the Vigil bullet now
  says the marker is what locates the test and to keep it through a rename.
- `docs/decisions/DECISIONS.md` — **D-224** (a citation is an `I-n` in a test NAME) and **D-225**
  (the sweep is a ratchet; `0116` throws the all-or-nothing switch).
- `tickets/open/0116-invariant-test-sweep-i1-i26.md` — a dated note: remit unchanged, plus the two
  things `0161` changed about *how* it finishes (title-form citations, and setting `complete: true`
  is 0116's switch to throw).

**Decisions, and why**

*A citation is an `I-n` in the name of a `describe`/`it`/`test` (D-224).* The alternative was to
keep prose and say why, which the ticket explicitly allowed. It does not survive contact with the
regression check: a comment outlives the code it describes, so a prose citation would keep vouching
for coverage after the test guarding it was deleted — and the regression check is the only value
this row delivers before `0116` runs. The migration cost turned out to be zero, which was not
obvious up front: **15 invariants appear somewhere in a test file, 9 appear in a test name**, and
the codebase had already reached for the strong form unprompted (`it("stores all three time fields
(I-13)")`). No app test needed editing.

*The activation rule is a ratchet with an explicit completion flag (D-225).* Scoping invariants
per capability was the other candidate and was rejected: it needs an invariant → capability mapping
that does not exist, and inventing one would be a design change made to fix a tooling bug. The
ratchet needs no new taxonomy, and it fails on exactly the thing that is checkable today.

*The mark rises only in `--record`.* Raising it on every `audit` run lets a citation appear and
vanish between two audits with nothing to show for it. Never raising it protects only what this
ticket froze. `--record` is the moment a capability is declared done, and it is a single writer.

*A corrupt ratchet file FAILs rather than reading as empty.* Same instinct as `NA`-with-a-reason:
an unreadable high-water mark means a lost citation passes silently, which is worse than the bug
this ticket fixed.

**Scope: widened deliberately, on the operator's instruction.** The Notes offered to file the
`vigil-test` staleness separately, and the proposal at the top of the session recommended that. The
operator said solve it now, so the acceptance criteria were amended with three explicit rows rather
than the fix being smuggled in under the existing ones. It was a genuinely separate detector —
`testFiles().filter(f => /vigil/i.test(f))` matched on **filename**, and `0030` shipped the test as
`src/rules/registry-delta.test.ts` because the method is a registry delta. Same *family* as the
sweep bug (matching a string that is not the thing), different check. It now matches the marker
`THE VIGIL TEST`, which the file has carried since `0030`, so nothing under `src/` changed.

**What went wrong on the way.** Two things. The `vigil-test` test initially went through the audit
command, which meant it shelled out to `npx vitest` inside a temp dir with no `package.json` — it
passed in about a second here, but only because npx failed fast, and on a cold or offline machine
that is a network fetch or a hang inside a unit test. `vigilTests()` was extracted and exported so
the test asserts *which file is found* without running anything. The first attempt at that probe
used `node -e 'import(process.argv[1])'`, which made `process.argv[1]` the script path and tripped
`tickets.mjs`'s own CLI entry guard — it printed usage instead of importing. Replaced with a probe
file that takes the path from the environment.

**The ratchet file is not in this commit.** `docs/capabilities/invariant-citations.json` is created
by the first `audit --record`, which is the single writer D-225 names; hand-writing it here to have
something to show would be the first instance of exactly what its own `note` field forbids. The
next `--record` — capability `04`'s, which this ticket unblocks — will create it with the nine
citations listed above.

**One premise in the ticket was stale and is worth recording.** It was filed on 2026-09-04 stating
the only live citation was a comment at `src/rules/validate.test.ts:252`. By 2026-09-08 there were
15 prose citations and 9 in test names, added by the pipeline work in between. The defect was real
and unchanged; the "one comment armed the gate" framing was not, and the fix is better for it —
the `na` → live transition is now a real transition in the repo rather than a hypothetical one.

## Operator validation

**None required — agent-verified** (D-181). Ticket tooling with no rendered surface and nothing
deployed. What was actually run, on this machine, 2026-09-08:

- `node --test .claude/skills/tickets/scripts/tickets.test.mjs` — **136 tests, 136 pass, 0 fail**
  (129 before; 7 added).
- `tickets.mjs audit 04-domain-contract-and-rules` — the audit this ticket was filed to unblock:
  **10 passed, 0 failed, 2 n/a**, versus `FAIL invariant-sweep 29/30` before. The sweep now reads
  `9/30 invariants cited by a test name, none lost … the remaining 21 are not due until 0116 sets
  "complete": true`, which names what would change the verdict. `vigil-test` reads
  `src/rules/registry-delta.test.ts` instead of `n/a — no vigil test exists yet`.
- **The regression case was shown RED on the real repo before being trusted**, not only in a
  fixture. A ratchet file was written claiming `I-26` had been cited (it appears only in a comment,
  so under D-224 it is not), and the sweep returned
  `FAIL — REGRESSION — I-26 was cited by a test name and no longer is`, with the whole audit exiting
  `1`. The file was then deleted; `git status` confirms it left nothing behind.
- `tickets.mjs validate` — 0 errors, 1 pre-existing unrelated warning (`0181`, missing
  `docs/capabilities/00-foundations.md`).
