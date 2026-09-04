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

- [ ] The sweep no longer fails a capability audit merely because invariants outside that
      capability's scope have no citing test.
- [ ] It still **fails** on a real regression: an invariant that was cited and no longer is.
      A test proves this by removing a citation.
- [ ] Whatever the new rule is, it is stated in `docs/capabilities/AUDIT.md` §1 alongside the
      other checks, so the row's meaning is readable without opening the script.
- [ ] A citation is something stronger than an `I-\d+` anywhere in a test file. The form is this
      ticket's to choose and to write down — a decision worth a `D-xxx` either way, including
      the decision to keep prose and say why.
- [ ] `audit 04-domain-contract-and-rules` reports the sweep honestly under the new rule, and
      the reason string names what would change the verdict.
- [ ] `0116`'s remit is unchanged and the ticket says so — this ticket fixes the gate's timing,
      it does not do the sweep or reduce what `0116` must still deliver.
- [ ] `tickets.test.mjs` covers the new rule, including the `na` → live transition.

## Notes

**Do not fix this by reverting to `na` until capability 18.** That trades a gate that always
fails for one that never fires, and loses the regression detection in the second criterion —
which is the only part of this check delivering value before `0116` runs.

Related: the same audit found `vigil-test` reporting
`n/a — no vigil test exists yet, ticket 0030 puts it permanently in CI` **after `0030` closed**
and shipped `src/rules/registry-delta.test.ts`. Probably one stale detector rather than two, and
worth checking while in this code — but if it turns out to be independent, file it separately
rather than widening this ticket.

## Operator validation

None. A change to the ticket tooling's own audit command, with no rendered surface and nothing
deployed. Verify by agent: `audit 04-domain-contract-and-rules` reports the sweep under the new
rule, `tickets.test.mjs` covers the `na` -> live transition, and the regression case is shown to
FAIL before it is trusted to pass — a sweep that has only ever been seen green is the thing this
ticket is about.
