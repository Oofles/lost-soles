# Consolidation Pass Prompt

> **Copied from [TicketSmith](https://github.com/Oofles/ticketsmith) (MIT).** Two project-specific
> edits: references to a single `docs/DECISIONS.md` now point at the `docs/decisions/` **directory**
> (see `CLAUDE.md`, Layout notes), and the ticket lifecycle gains an **`inbox`** state for phone
> captures awaiting triage. Licence retained at `docs/capabilities/TICKETSMITH-LICENSE`.

> Paste this into a fresh AI coding session (`/clear` first) when you've
> finished a multi-ticket buildout (a capability with many tickets, or a
> phase of work) and want to clean up technical debt before moving on.

## Why this exists

When work is built ticket-by-ticket, each ticket makes locally-correct
decisions without seeing the full picture. The result is technically
working code with seams between tickets:

- Duplicated patterns that should be one shared utility
- Inconsistent naming across files written at different times
- Awkward integrations where two ticket boundaries meet
- Dead code or commented-out exploration
- Documentation that drifted from final implementation
- TODO comments that need to either become tickets or get resolved

A consolidation pass addresses these *before* new work piles more code
on top, while everything is still fresh.

This is not a refactor for refactor's sake. The goal is to make
upcoming work faster and cleaner, not to chase perfection.

## When to run a consolidation pass

- After completing a capability with more than 5 tickets
- After a major buildout phase (e.g., a "Phase 2" milestone)
- When you notice yourself thinking "ugh, the codebase feels rough"
- Before starting a major new capability that builds heavily on
  recent work

Do NOT run a consolidation pass:

- After single tickets (overkill)
- When the project is in flux and patterns haven't stabilized
- As a substitute for actually shipping new capabilities

## The prompt

```
We just finished a multi-ticket buildout. Before starting new work,
we're doing a consolidation pass to clean up seams from the
ticket-by-ticket build.

This is NOT a feature pass. We are not adding capabilities. We are
auditing what was built and addressing technical debt that accumulated
across ticket boundaries.

SCOPE OF THIS PASS: <FILL IN — e.g., "the last 8 tickets that built
out the authentication capability" or "Phase 2 walking skeleton">

Read these in order before doing anything else:

1. CLAUDE.md
2. docs/ARCHITECTURE.md
3. docs/decisions/DECISIONS.md if it exists
4. docs/capabilities/WORKFLOW.md if it exists
5. Every closed ticket in scope (from the list above)

Then audit the codebase against the docs. Specifically, produce a
read-only report covering these categories. For each category, list
specific findings with file paths and line references. DO NOT make any
changes yet — this step is read-only analysis.

CATEGORY 1: Doc drift
What does the architecture documentation say that no longer matches
the code? What did the recent work build that the docs don't describe?
Examples to look for:
- Data model fields added during implementation that aren't in
  ARCHITECTURE.md's schema
- API endpoints that drifted from the documented surface
- Conventions that drifted from documented standards
- Folder structure that differs from what was specified

CATEGORY 2: Duplicated patterns
Where are similar things implemented two or more different ways?
Examples:
- Multiple ways of producing the same kind of response
- Multiple approaches to the same operation
- Multiple validation patterns for the same kind of input
- Configuration loading scattered across files

CATEGORY 3: Naming inconsistency
Same concept named differently in different files. Examples:
- snake_case vs camelCase for the same field
- Abbreviated vs full names for the same identifier
- Inconsistent table/column/type naming conventions

CATEGORY 4: Awkward seams
Places where the integration between tickets is technically correct
but shows the seam. Examples:
- A handler that converts between two near-identical data shapes
- A module that exports something only one other module uses, where
  merging them would be cleaner
- Logic split across modules that should be in one place
- Components that re-implement logic that lives in a utility (or vice
  versa)

CATEGORY 5: Dead code and TODOs
- Functions/classes that aren't referenced anywhere
- Commented-out blocks left over from exploration
- TODO/FIXME/XXX comments — each needs to either become a ticket or
  get resolved in this pass
- Unused dependencies in the project manifest

CATEGORY 6: Test coverage gaps
What was specified in ticket acceptance criteria but doesn't have a
test? Don't aim for arbitrary coverage targets — focus on:
- Logic that would be expensive to debug if it broke silently
- Critical safety/correctness paths (authentication, scope
  enforcement, money handling, etc.)
- Parser/serializer correctness on edge cases
- Anything noted in tickets as "should have a test" that doesn't

CATEGORY 7: Setup and onboarding friction
If a future operator (or you, in three months) cloned this repo
today, what would trip them up? Examples:
- Missing or wrong instructions in setup docs
- Required env vars not documented
- Required system dependencies not called out
- First-run experience that doesn't make sense without context

After producing the report, STOP. Don't start fixing things. We'll
triage the report together and decide what to address in this pass
vs what to file as new tickets.
```

## After the audit

The AI returns the report. Review and triage with this rubric:

**Address now (in this consolidation pass):**

- Doc drift on foundational docs (`ARCHITECTURE.md`, decisions log).
  Future capabilities will be designed against these docs, so they need
  to be accurate.
- Naming inconsistencies that show up in 3+ places. These get harder to
  fix the more code is added on top.
- Duplicated patterns where the duplication is exact or near-exact. If
  there are real differences, leave them — premature consolidation is
  its own problem.
- Dead code, unused imports, leftover commented-out blocks. Pure
  deletions.
- TODO/FIXME comments — resolve, or convert to filed tickets, or delete
  if no longer relevant.
- Missing tests for non-negotiable behaviors (correctness paths, safety
  paths).
- Setup friction that would block fresh-environment onboarding.

**File as new tickets, don't fix now:**

- Awkward seams that work fine but could be cleaner. These often
  resolve themselves as the right abstraction emerges from future
  capabilities.
- Test coverage gaps that aren't on critical paths.
- Duplicated patterns where the right consolidation isn't obvious.
- Larger refactors that touch many files.

**Don't do at all:**

- Renaming for taste rather than consistency.
- Reorganizing folder structure unless docs specify a different one
  than what exists.
- Adding abstractions in anticipation of future needs.
- Performance optimization without a concrete reason.

## The execution prompt

After triage, paste this to execute:

```
Here's the triage from the audit report. For each item marked
"address now," implement the fix. For each item marked "file as
ticket," create a properly formatted ticket markdown file in
tickets/open/ following the project's ticket format.

Approach:
- Group fixes by file to minimize churn.
- Each meaningful fix should be a separate commit if a VCS is in use.
- Run tests after each group of fixes.
- If a fix turns out to be larger than expected, stop and file it as
  a ticket instead of expanding scope.
- If you discover something during fixes that should have been on the
  audit report but wasn't, surface it before continuing.

When done, produce a summary of:
- Fixes applied (with file paths)
- Tickets filed (with IDs and titles)
- Anything that needed manual operator verification
- Any new findings discovered during the fixes themselves

After the summary, the codebase should be ready for the next
capability work.
```

## When this pass is done

The repo is in a clean state to start the next capability. Specifically:

- Foundational docs accurately reflect reality
- Naming is consistent in the places that matter
- Dead code and stale TODOs are gone
- New tickets exist for anything punted

Commit the consolidation pass as its own milestone (multiple commits
is fine; one logical milestone). Then `/clear` and design the next
capability normally.

## Note on frequency

A consolidation pass is heavyweight. Once you've done one and started
doing periodic architecture reviews (see
`prompts/ARCHITECTURE_REVIEW.md`), the reviews catch drift
incrementally and you may rarely need a full consolidation pass again.
The pass is mostly for projects that have built up debt before they
adopted this workflow, or after rare big-bang buildouts where 10+
tickets shipped without intermediate review.
