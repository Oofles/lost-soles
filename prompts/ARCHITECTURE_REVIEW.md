# Architecture Review Prompt

> **Copied from [TicketSmith](https://github.com/Oofles/ticketsmith) (MIT).** Two project-specific
> edits: references to a single `docs/DECISIONS.md` now point at the `docs/decisions/` **directory**
> (see `CLAUDE.md`, Layout notes), and the ticket lifecycle gains an **`inbox`** state for phone
> captures awaiting triage. Licence retained at `docs/capabilities/TICKETSMITH-LICENSE`.

> Run this periodically — every 4-6 capabilities, or every few months
> of active development. The purpose is to catch documentation drift
> before it bites.

## Why this exists

Architecture documents drift. Code evolves, decisions get made, patterns
emerge — and the docs that describe the system slowly stop matching
reality. By the time the drift is bad enough to notice, capabilities
built against the stale docs have made wrong choices.

A periodic review catches drift early. It's lightweight (no code
changes during the review itself, just doc updates) and the cadence is
flexible. Once every few capabilities is plenty; once a year is too
infrequent.

## When to run

- After shipping 4-6 capabilities since the last review
- When you notice a doc saying something you know isn't true anymore
- When a new capability's design keeps fighting with the architecture
  docs (the docs might be wrong, not the design)
- After a long break from the project, before starting new work
- Before onboarding a contributor or sharing the project externally

## When NOT to run

- During an active capability buildout (finish the capability first)
- More than once per 2-3 capabilities (the cadence isn't worth it)
- As a way to avoid doing actual capability work

## Where to run this

This is one of the few activities that **benefits from running outside
the code environment**. The whole point is to look at the project with
fresh eyes — pulling docs into a chat surface that doesn't have the
codebase in context forces the review to focus on what the docs say
rather than what the code does.

In practice: paste the prompt below into a fresh web-UI chat session
(Claude.ai, ChatGPT, whatever), along with the relevant doc contents.
The output is a list of suggested doc updates. You then apply the
updates in the code environment.

## The prompt

```
You're helping me run a periodic architecture review on this project.
I'm going to paste in the current state of foundational documents, plus
a summary of capabilities shipped since the last review. Your job is to
find drift between docs and reality, and produce a list of doc updates
that would close the gaps.

This is a READ-ONLY exercise. You will not modify any files. You will
produce recommendations that I'll apply in a separate session.

═══════════════════════════════════════════════════════════════════════
INPUTS
═══════════════════════════════════════════════════════════════════════

I'll paste each of these below, in order:

1. CLAUDE.md (current contents)
2. docs/ARCHITECTURE.md (current contents)
3. docs/decisions/DECISIONS.md (current contents)
4. List of capabilities shipped since the last review, with brief
   descriptions of what each one changed structurally
5. Anything else I think is relevant (a specific file that's troubling
   me, a recent capability doc, etc.)

═══════════════════════════════════════════════════════════════════════
WHAT TO LOOK FOR
═══════════════════════════════════════════════════════════════════════

For each foundational doc, ask:

  STALENESS
  - Does this still describe the project accurately?
  - Are constraints listed that no longer apply?
  - Are constraints missing that have emerged from recent work?

  CONTRADICTIONS
  - Do any two docs say contradictory things?
  - Do the docs match what the capability summaries imply was built?

  MISSING ENTRIES
  - Has a recent capability introduced a pattern that should be
    documented but isn't?
  - Did any decisions get made (per capability docs or commits) that
    deserve an ADR but don't have one?

  OUTDATED EMPHASIS
  - Is the doc emphasizing things that mattered earlier but matter
    less now?
  - Is the doc under-emphasizing things that have become load-bearing?

For each capability shipped:

  - What did it change architecturally?
  - Is that change reflected in the docs?
  - Did it introduce a new pattern that should be documented?

═══════════════════════════════════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════════════════════════════════

Produce a Drift Report with this exact structure:

  ## CLAUDE.md
  ### Drift found
  [specific items, with quoted lines or section references]
  ### Recommended updates
  [specific suggested edits, in diff-ish form]

  ## docs/ARCHITECTURE.md
  ### Drift found
  ...
  ### Recommended updates
  ...

  ## docs/decisions/DECISIONS.md
  ### Missing ADRs
  [decisions that should be recorded as ADRs but aren't]
  ### Recommended new entries
  [proposed ADR text for each missing entry]

  ## Cross-cutting concerns
  [drift that spans multiple docs, or systemic issues that need
   coordinated updates]

  ## Suggested next steps
  - [Concrete actions, in priority order]
  - [Each action should be a single focused change]

═══════════════════════════════════════════════════════════════════════
CONSTRAINTS
═══════════════════════════════════════════════════════════════════════

- Read-only. No file modifications. The output is a report I'll apply
  separately.
- Be specific. "The architecture doc is out of date" is not a finding;
  "Section §Process model still says 'single tool at a time' but
  capability #12 added concurrent execution" is a finding.
- Be honest. If a doc looks fine, say so. Not every review needs to
  produce a long list of updates.
- Don't propose code changes. This is about docs, not code. If you
  spot code issues during the review, mention them briefly in
  "Cross-cutting concerns" but don't suggest implementations.
- Don't propose new architecture. The job is to surface drift, not to
  redesign the system.

I'll paste the inputs in my next message.
```

## How to apply the output

After the review produces a Drift Report:

1. **Skim the report.** Disagree with anything? Note it. Reviews
   sometimes flag things that look like drift but are actually
   intentional (you'll spot these because the report can't see your
   reasoning).
2. **Open a fresh code session.** `/clear`. Don't carry over the
   review conversation.
3. **Apply the recommended updates** as ordinary doc edits. Use the
   report as a checklist. Commit with `docs:` prefixes.
4. **If new ADRs were proposed**, write them into `docs/decisions/DECISIONS.md`
   using the existing format. ADRs should match the style of existing
   entries.
5. **If the report surfaced code-level issues**, file tickets for
   them. Don't fix them as part of the review pass — that's
   scope creep.
6. **Commit the review's outputs** as a single milestone:
   `chore: periodic architecture review (NN capabilities since last)`.

## Cadence recommendation

For most projects, run the review:

- After every 4-6 shipped capabilities, OR
- Every 2-3 months of active development, OR
- Whenever drift becomes obvious

Whichever comes first. Pick the cadence that fits your project's
pace. The point is regularity, not frequency.

For projects in heavy active development (multiple capabilities per
month), lean toward more frequent and shorter reviews. For projects in
maintenance mode, less frequent is fine.

## What "done" looks like

The review is complete when:

- The Drift Report has been generated
- You've reviewed each finding and either agreed or noted disagreement
- The agreed updates have been applied as doc edits
- New ADRs (if any) have been added to the decisions log
- New tickets (if any) have been filed for code-level issues
- The updates are committed

The codebase is now ready for the next capability with accurate
architectural documentation backing it up.
