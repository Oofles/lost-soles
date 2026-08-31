# TicketSmith upstream diff

Recorded 2026-08-30 for ticket 0005. Upstream: https://github.com/Oofles/ticketsmith @ e3338fe

Every local change to a copied file, so a future session can tell our edits from upstream text
and re-sync deliberately rather than by guesswork.

## `docs/capabilities/WORKFLOW.md`

`40` changed line(s) vs `templates/docs/capabilities/WORKFLOW.md`.

```diff
@@ -1,5 +1,10 @@
 # Capability Workflow
 
+> **Copied from [TicketSmith](https://github.com/Oofles/ticketsmith) (MIT).** Two project-specific
+> edits: references to a single `docs/DECISIONS.md` now point at the `docs/decisions/` **directory**
+> (see `CLAUDE.md`, Layout notes), and the ticket lifecycle gains an **`inbox`** state for phone
+> captures awaiting triage. Licence retained at `docs/capabilities/TICKETSMITH-LICENSE`.
+
 > How this project grows. The steady-state process for adding new
 > capabilities. If you're reading this and about to start a new
 > capability, follow it. If it feels wrong for what you're doing,
@@ -43,6 +48,49 @@
 Don't skip steps 4 and 5. They're where the project actually gets
 better, because they're where reality contradicts the design.
 
+For Lost Soles, **USE is not a metaphor — it means going for a run
+with the build on your phone.** Steps 4 and 5 are unskippable here in
+a way they are not in a desktop tool: the defects that matter (a fog
+edge that shimmers, a level-up banner 4px off, a map you cannot read
+in sunlight) pass every automated test and are only ever caught by
+using it outdoors.
+
+## The `inbox` state — a Lost Soles addition
+
+TicketSmith has two ticket states, mirroring two folders: `open/` and
+`closed/`. Lost Soles adds a third, **`inbox/`**, because tickets can
+arrive from a phone (D-092) as well as from a session.
+
+```
+tickets/inbox/    unnumbered captures, status: inbox
+      ↓  triage (agent only — allocates NNNN)
+tickets/open/     status: open | blocked
+      ↓  close
+tickets/closed/   status: closed
+```
+
+Why it exists, and why the asymmetry matters: **the phone only ever
+creates; the agent only ever numbers, edits and moves.** Captures land
+as `YYYY-MM-DDTHHMM-slug.md` with no `id`, because **only the agent
+allocates ticket numbers** — that preserves TicketSmith's single-writer
+numbering invariant even though two things now write to `tickets/`.
+Their write sets are disjoint by construction, so merge conflicts are
+structurally impossible and no sync engine exists.
+
+Triage is a deliberate gate, not overhead. A thought at mile six is a
+note, not a ticket; it becomes one when someone decides it should.
+
+**Never seed the inbox.** An inbox that starts full teaches you to
+ignore it.
+
+## Capability close: the drift audit
+
+One more Lost Soles addition. A capability is not done when its tickets
+are closed — it is done when `AUDIT.md` passes (D-153). The governing
+rule: *if the implementation diverged from the design doc, either the
+code changes or the doc changes, never neither.* REFLECT above is where
+that audit's findings get written down.
+
 ## Where design happens
 
```

## `docs/capabilities/TEMPLATE.md`

`4` changed line(s) vs `templates/docs/capabilities/TEMPLATE.md`.

```diff
@@ -1,5 +1,10 @@
 # Capability: <Name>
 
+> **Copied from [TicketSmith](https://github.com/Oofles/ticketsmith) (MIT).** Two project-specific
+> edits: references to a single `docs/DECISIONS.md` now point at the `docs/decisions/` **directory**
+> (see `CLAUDE.md`, Layout notes), and the ticket lifecycle gains an **`inbox`** state for phone
+> captures awaiting triage. Licence retained at `docs/capabilities/TICKETSMITH-LICENSE`.
+
 > Status: draft | in-design | tickets-generated | building | shipped
 > Started: <date>
 > Shipped: <date>
```

## `prompts/CAPABILITY_DESIGN.md`

`6` changed line(s) vs `templates/prompts/CAPABILITY_DESIGN.md`.

```diff
@@ -1,5 +1,10 @@
 # Capability Design Prompt
 
+> **Copied from [TicketSmith](https://github.com/Oofles/ticketsmith) (MIT).** Two project-specific
+> edits: references to a single `docs/DECISIONS.md` now point at the `docs/decisions/` **directory**
+> (see `CLAUDE.md`, Layout notes), and the ticket lifecycle gains an **`inbox`** state for phone
+> captures awaiting triage. Licence retained at `docs/capabilities/TICKETSMITH-LICENSE`.
+
 > Paste this into a fresh AI coding session (`/clear` first) when you're
 > ready to design a new capability. Fill in the placeholder at the top
 > with what you want to build.
@@ -31,7 +36,7 @@
 4. docs/capabilities/TEMPLATE.md (the capability doc format you'll fill out)
 5. The most recent 2-3 capability docs in docs/capabilities/ (for shape
    and recent patterns)
-6. docs/DECISIONS.md if it exists
+6. docs/decisions/DECISIONS.md if it exists
 7. docs/capabilities/ROADMAP.md if it exists (to see how this capability
    was framed)
 8. The relevant existing code. Use your judgment about what's relevant,
```

## `prompts/CONSOLIDATION_PASS.md`

`6` changed line(s) vs `templates/prompts/CONSOLIDATION_PASS.md`.

```diff
@@ -1,5 +1,10 @@
 # Consolidation Pass Prompt
 
+> **Copied from [TicketSmith](https://github.com/Oofles/ticketsmith) (MIT).** Two project-specific
+> edits: references to a single `docs/DECISIONS.md` now point at the `docs/decisions/` **directory**
+> (see `CLAUDE.md`, Layout notes), and the ticket lifecycle gains an **`inbox`** state for phone
+> captures awaiting triage. Licence retained at `docs/capabilities/TICKETSMITH-LICENSE`.
+
 > Paste this into a fresh AI coding session (`/clear` first) when you've
 > finished a multi-ticket buildout (a capability with many tickets, or a
 > phase of work) and want to clean up technical debt before moving on.
@@ -55,7 +60,7 @@
 
 1. CLAUDE.md
 2. docs/ARCHITECTURE.md
-3. docs/DECISIONS.md if it exists
+3. docs/decisions/DECISIONS.md if it exists
 4. docs/capabilities/WORKFLOW.md if it exists
 5. Every closed ticket in scope (from the list above)
 
```

## `prompts/ARCHITECTURE_REVIEW.md`

`10` changed line(s) vs `templates/prompts/ARCHITECTURE_REVIEW.md`.

```diff
@@ -1,5 +1,10 @@
 # Architecture Review Prompt
 
+> **Copied from [TicketSmith](https://github.com/Oofles/ticketsmith) (MIT).** Two project-specific
+> edits: references to a single `docs/DECISIONS.md` now point at the `docs/decisions/` **directory**
+> (see `CLAUDE.md`, Layout notes), and the ticket lifecycle gains an **`inbox`** state for phone
+> captures awaiting triage. Licence retained at `docs/capabilities/TICKETSMITH-LICENSE`.
+
 > Run this periodically — every 4-6 capabilities, or every few months
 > of active development. The purpose is to catch documentation drift
 > before it bites.
@@ -64,7 +69,7 @@
 
 1. CLAUDE.md (current contents)
 2. docs/ARCHITECTURE.md (current contents)
-3. docs/DECISIONS.md (current contents)
+3. docs/decisions/DECISIONS.md (current contents)
 4. List of capabilities shipped since the last review, with brief
    descriptions of what each one changed structurally
 5. Anything else I think is relevant (a specific file that's troubling
@@ -120,7 +125,7 @@
   ### Recommended updates
   ...
 
-  ## docs/DECISIONS.md
+  ## docs/decisions/DECISIONS.md
   ### Missing ADRs
   [decisions that should be recorded as ADRs but aren't]
   ### Recommended new entries
@@ -166,7 +171,7 @@
    review conversation.
 3. **Apply the recommended updates** as ordinary doc edits. Use the
    report as a checklist. Commit with `docs:` prefixes.
-4. **If new ADRs were proposed**, write them into `docs/DECISIONS.md`
+4. **If new ADRs were proposed**, write them into `docs/decisions/DECISIONS.md`
    using the existing format. ADRs should match the style of existing
    entries.
 5. **If the report surfaced code-level issues**, file tickets for
```

