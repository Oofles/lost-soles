# Capability Workflow

> **Copied from [TicketSmith](https://github.com/Oofles/ticketsmith) (MIT).** Two project-specific
> edits: references to a single `docs/DECISIONS.md` now point at the `docs/decisions/` **directory**
> (see `CLAUDE.md`, Layout notes), and the ticket lifecycle gains an **`inbox`** state for phone
> captures awaiting triage. Licence retained at `docs/capabilities/TICKETSMITH-LICENSE`.

> How this project grows. The steady-state process for adding new
> capabilities. If you're reading this and about to start a new
> capability, follow it. If it feels wrong for what you're doing,
> that's worth a discussion with the operator before deviating.

## The unit of work: a capability

A **capability** is a coherent operator-facing change to the project.
"User authentication" might be a capability. "Add a button" is not — it's
a ticket within some capability. "Make the project better" is not — it's
a wish.

A good capability has these properties:

- One sentence describes what changes for the operator
- Designable in a single focused session
- Implementable in 3-8 tickets
- Shippable in one or two `/tickets` runs
- Useful on its own, even if nothing else gets built afterward

If your proposed capability fails any of these tests, it's too big.
Split it.

## The cycle

Each capability follows the same five-step cycle:

```
1. DESIGN        → docs/capabilities/NN-name.md exists, filled out,
                   open questions resolved
2. TICKET-WRITE  → tickets/open/NNNN-*.md files exist, one per
                   capability ticket
3. BUILD         → all tickets closed, code merged, capability docs
                   updated with implementation notes
4. USE           → run the project against real work for at least
                   one session
5. REFLECT       → append "Notes from implementation" to the
                   capability doc, mark Status: shipped
```

Don't skip steps 4 and 5. They're where the project actually gets
better, because they're where reality contradicts the design.

For Lost Soles, **USE is not a metaphor — it means going for a run
with the build on your phone.** Steps 4 and 5 are unskippable here in
a way they are not in a desktop tool: the defects that matter (a fog
edge that shimmers, a level-up banner 4px off, a map you cannot read
in sunlight) pass every automated test and are only ever caught by
using it outdoors.

## The `inbox` state — a Lost Soles addition

TicketSmith has two ticket states, mirroring two folders: `open/` and
`closed/`. Lost Soles adds a third, **`inbox/`**, because tickets can
arrive from a phone (D-092) as well as from a session.

```
tickets/inbox/    unnumbered captures, status: inbox
      ↓  triage (agent only — allocates NNNN)
tickets/open/     status: open | blocked
      ↓  close
tickets/closed/   status: closed
```

Why it exists, and why the asymmetry matters: **the phone only ever
creates; the agent only ever numbers, edits and moves.** Captures land
as `YYYY-MM-DDTHHMM-slug.md` with no `id`, because **only the agent
allocates ticket numbers** — that preserves TicketSmith's single-writer
numbering invariant even though two things now write to `tickets/`.
Their write sets are disjoint by construction, so merge conflicts are
structurally impossible and no sync engine exists.

Triage is a deliberate gate, not overhead. A thought at mile six is a
note, not a ticket; it becomes one when someone decides it should.

**Never seed the inbox.** An inbox that starts full teaches you to
ignore it.

## Capability close: the drift audit

One more Lost Soles addition. A capability is not done when its tickets
are closed — it is done when `AUDIT.md` passes (D-153). The governing
rule: *if the implementation diverged from the design doc, either the
code changes or the doc changes, never neither.* REFLECT above is where
that audit's findings get written down.

## Where design happens

**Default: in the AI coding environment, against the actual
codebase.** Reality grounding beats clean separation in almost all
cases.

**Exceptions where you should use a different surface (chat, web UI,
whatever) instead:**

- You're considering changing foundational architecture documents.
  Foundational changes deserve outside perspective.
- You're stuck. The "this doesn't fit and I don't know why" feeling
  means a fresh view is worth more than another pass at the code.
- Cross-capability decisions that affect multiple unbuilt things at
  once.
- Periodic architecture review (see below).

When in doubt: design in the code environment. The escape hatches
are explicit.

## The design protocol

When designing a capability, the session must follow this discipline
or it slips into premature implementation:

**Session opens with `/clear`. First prompt is the design prompt** (see
`prompts/CAPABILITY_DESIGN.md`). The prompt explicitly forbids
implementation proposals until the design doc is filled out.

**Order of operations within the session:**

1. Read foundational docs (`ARCHITECTURE.md`, this `WORKFLOW.md`, recent
   capability docs).
2. Summarize what was found and ask clarifying questions about the
   proposed capability. **No implementation yet.**
3. Iterate on filling out the capability doc from `TEMPLATE.md`.
4. Resolve open questions or explicitly punt them with stated defaults
   before tickets are generated.
5. Generate the ticket markdown files in `tickets/open/`.
6. `/clear`. Fresh session. Run `/tickets` to implement.

The two `/clear`s matter. Design context contaminates implementation
decisions; implementation context contaminates the next capability's
design.

## When to step outside the code environment

Specifically use a fresh chat surface (or any environment that doesn't
have the codebase in context) for:

**Foundational changes.** If a capability would alter the architecture
documents, design it outside first. Paste the current docs, describe
what's pushing the change, work it out without code-inertia.

**Stuckness.** If you've tried designing a capability twice in the code
environment and it keeps coming out wrong, that's a signal. Step
outside, paste the current docs and the failing attempts, ask "what am
I missing?"

**Periodic architecture review.** Every 4-6 capabilities, or every
couple months of active development, do this:

1. Open a fresh chat surface
2. Paste the architecture docs, decisions log, and recent capability
   docs
3. List capabilities shipped since the last review
4. Ask: "What's drifted? What's the docs telling me that's no longer
   true? What patterns have we evolved that aren't reflected here?"
5. Update the foundational docs based on the review

The `prompts/ARCHITECTURE_REVIEW.md` file in this project has a ready
prompt for this. Run it on the cadence above. Skipping it is the most
common way the workflow breaks.

## The capability doc lifecycle

Capability docs live at `docs/capabilities/NN-name.md`, numbered
sequentially. They have five states reflected in the `Status:` line at
the top:

- **draft** — being written, not all sections filled out, open
  questions remain
- **in-design** — actively being designed with the AI, may iterate
- **tickets-generated** — tickets exist in `tickets/open/`,
  implementation pending
- **building** — at least one ticket closed, more in progress
- **shipped** — all tickets closed, capability used on real work at
  least once, "Notes from implementation" section appended

A doc in **shipped** state is historical record. Don't edit it for
style later. If you want to revise the capability, write a new
capability doc that references it.

## Anti-patterns to watch for

**The "while I'm in here" expansion.** Tickets that grow scope because
the AI notices related work. File a new ticket for the related work;
don't expand the current one. The capability doc's "Out of scope"
section is the forcing function.

**The drive-by abstraction.** A capability adds an abstraction that
"we'll need for the next thing." Don't. Add abstractions when the
third use case appears, not the first. Build the next capability
concretely; refactor when the pattern is real.

**Doc drift.** Capability ships, foundational docs don't get updated.
If `ARCHITECTURE.md` says one thing and the code does another, the
docs are lying to future AI sessions. Update them as part of the
capability that changed them, not "later."

**Skipping USE and REFLECT.** Shipping the code without running the
project against real work means you don't actually know if the
capability is good. The first time you'll find out is when the *next*
capability is built on top of a shaky one. Always exercise the
capability against real work before considering it shipped.

**Designing five capabilities ahead.** The temptation to spec out the
next five capabilities now is strong and almost always wrong. Each
capability's design should be informed by the previous one's reality.
The further ahead you plan, the more of the plan you'll throw away.

**Closing tickets without honest operator validation.** Tickets close
with a Resolution section AND an Operator validation section. If the
validation section is always "None," nobody is checking the work.
That's not validation; that's hope.

## Quick reference

- **Starting a new capability?** → `prompts/CAPABILITY_DESIGN.md`
- **Filling out a capability doc?** → `docs/capabilities/TEMPLATE.md`
- **Tickets ready to implement?** → `.claude/commands/tickets.md`
  (`/tickets` slash command)
- **Need an architecture review?** → `prompts/ARCHITECTURE_REVIEW.md`
  in a fresh chat surface
- **Cleaning up after a multi-ticket buildout?** →
  `prompts/CONSOLIDATION_PASS.md`
- **Foundational decision being made?** → append an ADR to
  `docs/decisions/DECISIONS.md`
