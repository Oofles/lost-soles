# Capability: <Name>

> **Copied from [TicketSmith](https://github.com/Oofles/ticketsmith) (MIT).** Two project-specific
> edits: references to a single `docs/DECISIONS.md` now point at the `docs/decisions/` **directory**
> (see `CLAUDE.md`, Layout notes), and the ticket lifecycle gains an **`inbox`** state for phone
> captures awaiting triage. Licence retained at `docs/capabilities/TICKETSMITH-LICENSE`.

> Status: draft | in-design | tickets-generated | building | shipped
> Started: <date>
> Shipped: <date>

## What and why

One paragraph. What does this add to the project? Why now, and not
later? If you can't answer "why now," consider whether this should
wait.

## User-facing changes

What does the operator (or end user, if this isn't a single-operator
project) see or do differently after this ships? Be concrete. "There's
a new button on the X page that does Y" is better than "the project
gains the ability to Y."

## Architectural impact

What in the foundational architecture documents changes as part of
this capability? Most capabilities should answer "nothing" or a short
list.

If anything changes, those docs get updated as part of this
capability's tickets — not in a separate cleanup pass later.

## New abstractions

Any new classes, interfaces, base types, or file patterns this
capability introduces. Justify each one. The best answer is
"none — extends existing patterns."

Watch for: new abstractions that duplicate something existing under a
different name. If the new thing looks like a generalization of an
existing thing, generalize the existing thing instead of adding a
parallel one.

## Data model changes

New tables, new columns on existing tables, new fields on existing
data structures. Migrations needed? Backwards compatibility concerns?

If this section isn't applicable (e.g., a frontend-only capability),
write "N/A."

## API surface changes

New endpoints, new events, new request/response shapes. Reference the
project's existing API conventions; don't invent new ones.

If this section isn't applicable, write "N/A."

## UI changes

New routes, new views, new components. Where do they live in the
navigation? What's the empty state? What's the loading state? What's
the error state?

These get skipped if they aren't called out. Call them out.

If this section isn't applicable, write "N/A."

## Out of scope

Things that sound related but aren't being built in this capability.
Be generous here — most "obviously related" features should be
deferred. A capability that ships smaller and sooner beats one that
ships bigger and later.

## Open questions

Things to resolve before implementation starts. Each open question
should either:

1. Get answered in this doc before tickets are generated, or
2. Be explicitly punted with a default ("we'll do X for now and
   revisit if it turns out wrong")

Unanswered open questions are the #1 cause of ticket churn. Don't
generate tickets while questions are still open.

## Tickets

Numbered list of tickets this capability decomposes into. Format:

```
- NNNN: <title> — <one-line description>
```

Aim for tickets sized so each is a focused 30 minute - 2 hour session.
If a ticket sounds bigger than that, split it. If a ticket sounds
smaller (5 minutes of mechanical edits), merge it with a related one.

## Acceptance for the capability as a whole

How will you know this capability is done? A short list of
operator-facing behaviors that should work end-to-end. This is *not*
a sum of the per-ticket acceptance criteria — it's the
integration-level check.

## Dependencies

Other capabilities or tickets this depends on. If this depends on
something unbuilt, either build that first or note what assumptions
you're making about it.

## Notes from implementation

(Appended after the capability ships. What surprised you? What would
you do differently? What's the next capability that should build on
this?)
