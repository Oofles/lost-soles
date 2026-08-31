# Capability Design Prompt

> **Copied from [TicketSmith](https://github.com/Oofles/ticketsmith) (MIT).** Two project-specific
> edits: references to a single `docs/DECISIONS.md` now point at the `docs/decisions/` **directory**
> (see `CLAUDE.md`, Layout notes), and the ticket lifecycle gains an **`inbox`** state for phone
> captures awaiting triage. Licence retained at `docs/capabilities/TICKETSMITH-LICENSE`.

> Paste this into a fresh AI coding session (`/clear` first) when you're
> ready to design a new capability. Fill in the placeholder at the top
> with what you want to build.

## How to use

1. `/clear` to start fresh.
2. Replace `<CAPABILITY_NAME>` and `<ONE_LINE_DESCRIPTION>` at the top
   of the prompt below with what you actually want to build.
3. Paste the whole prompt.
4. Iterate with the AI on the capability doc until it's filled out and
   open questions are resolved.
5. When the doc looks good, ask the AI to generate the ticket files.
6. `/clear`. New session. Run `/tickets` to implement.

## The prompt

```
We're designing a new capability for this project.

CAPABILITY: <CAPABILITY_NAME>
SHORT DESCRIPTION: <ONE_LINE_DESCRIPTION>

Before proposing anything, read in order:

1. CLAUDE.md (orientation)
2. docs/ARCHITECTURE.md (source of truth on architecture)
3. docs/capabilities/WORKFLOW.md (how capabilities are designed and shipped)
4. docs/capabilities/TEMPLATE.md (the capability doc format you'll fill out)
5. The most recent 2-3 capability docs in docs/capabilities/ (for shape
   and recent patterns)
6. docs/decisions/DECISIONS.md if it exists
7. docs/capabilities/ROADMAP.md if it exists (to see how this capability
   was framed)
8. The relevant existing code. Use your judgment about what's relevant,
   but at minimum look at: any modules that the new capability would
   extend, any adjacent domain code, the data model definitions.

Then do this, in order, stopping for my input between each step:

STEP 1: Confirm understanding.
Summarize, in your own words:
- What this capability adds and why now
- Which existing code it builds on or extends
- Which parts of the architecture and decisions are relevant
- Anything that's currently ambiguous about the scope as I described it

Then ask me clarifying questions. Group them — don't drip them. Wait
for my response.

DO NOT propose implementation yet. DO NOT start drafting code. The
point of this step is to surface ambiguity, not to solve it.

STEP 2: Draft the capability doc.
Once my answers to clarifying questions are settled, create a new file
at docs/capabilities/NN-<capability-name>.md where NN is the next
sequential number. Fill it out using TEMPLATE.md as the structure. Be
especially thoughtful about:

- "New abstractions" — default to "none, extends existing patterns"
  unless you can specifically justify a new one
- "Out of scope" — be generous, defer aggressively
- "Open questions" — surface them rather than hiding them with
  assumptions

Show me the draft. We'll iterate. I'll push back on scope, abstractions,
and open questions. The goal of this step is a capability doc both of
us are confident in.

STEP 3: Resolve open questions.
Don't proceed to tickets while open questions remain. Either:
- Answer them in conversation and update the doc, or
- Explicitly punt them with a stated default ("we'll do X for now and
  revisit if it turns out wrong"), recorded in the doc

When all open questions are either answered or explicitly punted, set
the doc's Status to "tickets-generated" (you'll generate them next).

STEP 4: Generate the ticket files.
Create ticket markdown files in tickets/open/, one per ticket listed
in the capability doc. Use the next available ticket numbers (read
existing ticket numbers in tickets/open/ and tickets/closed/, take
max + 1, increment from there). Follow the markdown format from the
project's existing tickets (or docs/TICKET_FORMAT.md if it exists).

For each ticket:
- Title and type and priority from the capability doc's tickets list
- Description that gives a future AI session enough context to
  implement without re-reading this whole conversation
- Acceptance criteria as concrete, checkable items
- Reference back to the capability doc by path
- Initial status: open

Show me the list of ticket files created.

STEP 5: Stop and hand off.
Don't start implementing. The implementation happens in a fresh
/tickets session with a clean context window. Summarize what's ready
to be built and stop.

Constraints throughout:
- Don't change ARCHITECTURE.md or other foundational docs unless this
  capability explicitly requires changes there — and if it does, those
  changes are themselves tickets within this capability.
- Don't propose abstractions until the third concrete use case exists.
  If this is the first or second, build concretely.
- If you find yourself wanting to do "while I'm in here" improvements,
  surface them as separate tickets in the capability or as standalone
  tickets, not bundled into the capability work.
- If you have clarifying questions, ask all of them per step rather
  than one at a time.
```

## A note on iteration

The first draft of the capability doc usually isn't right. Expect to
push back on:

- **Scope creep**: "this includes A AND B AND C" — split it
- **Premature abstractions**: a new base class proposed for one use
  case — defer
- **Implicit assumptions in 'out of scope'**: things claimed to be
  out of scope that are actually load-bearing for the capability —
  they're in scope
- **Vague acceptance**: "the capability is done when X works" — too
  vague, demand specifics

Pushing back is the whole point of having a design step. Don't accept
the first draft if it feels off.

## What "done" looks like for this prompt

You stop and `/clear` when:

- A capability doc exists at `docs/capabilities/NN-name.md`, fully
  filled out
- Status is `tickets-generated`
- All open questions are answered or explicitly punted
- Ticket markdown files exist in `tickets/open/`, one per capability
  ticket
- The plan is something you'd be comfortable handing to a fresh AI
  session for implementation

Then open a new session, `/clear`, and run `/tickets`.
