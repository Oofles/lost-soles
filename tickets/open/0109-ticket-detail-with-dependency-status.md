---
id: 109
slug: ticket-detail-with-dependency-status
title: /dev/tickets/:id detail with depends_on status resolved inline
type: feature
priority: med
status: open
size: m
capability: 17-tickets-ui
depends_on: [108, 110]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Screen 3 (`07-ticketsmith.md` §5.5): tap a row, get a rendered markdown detail view.

- The body renders as markdown, using the same renderer as the rest of the app.
- **Acceptance criteria render as read-only checkboxes.** They show state; they do **not** accept
  taps. Tapping one would be an edit, and §2.2 Move 2 forbids edits from the phone. Make them
  structurally inert — not a disabled input that could be re-enabled, but non-interactive marks.
- `depends_on` and `blocked_by` render as **tappable links to those tickets, with their current
  status inline** — `#0103 open`, `#0059 closed`. That inline status is the whole value of the
  screen: standing outside, the question is "can this be started yet", and the answer is whether
  every dependency is closed.
- The `capability` name links to the rendered capability doc.
- The `## Operator validation` section is rendered with the same prominence as the description —
  it is the section the operator is standing there to read.

Where a `depends_on` id is not in the cache (an id that does not exist, or a stale mirror), render
it as a plain unresolved reference with the id, not as an error and not as a broken link. The
cache is a cache; a missing row is a freshness fact, not a failure.

## Acceptance criteria

- [ ] `/dev/tickets/:id` renders the ticket's markdown body with headings, lists and code blocks.
- [ ] Acceptance-criteria checkboxes render their checked/unchecked state and are non-interactive:
      a test asserts tapping one produces no state change, no navigation and no network call.
- [ ] Each `depends_on` and `blocked_by` entry renders as a link with the target's current status
      inline; a fixture with a mix of open/closed dependencies renders both correctly.
- [ ] An unresolvable dependency id renders as plain text with the id, no error state.
- [ ] The capability name links to the rendered capability doc and the link resolves.
- [ ] The detail view works offline from the cache, including the `depends_on` statuses.
- [ ] There is no edit, close, comment, assign or reorder control anywhere on the screen —
      asserted by the same interactive-element count test 0111 owns.
- [ ] The Android back button returns to the browse list at the previous scroll position, at every
      depth.

## Notes

The "can I start this" reading is why status is inline rather than a tap away. If a dependency's
status required navigation, the operator would have to hold four ids in their head while
navigating — which is the state the whole ticket system exists to avoid.

Rendering markdown means rendering *the agent's* markdown. Do not sanitise it into a different
document: the tables in these tickets carry the specification, and a renderer that drops table
support silently deletes the acceptance criteria's context.

## Operator validation

On the Android phone, open a ticket you know is blocked — 0117 is a good one — and read its
`depends_on` list. Every dependency should show its status without a tap. Tap one, read it, press
the Android back button, and confirm you land where you left the list. Then tap an acceptance
checkbox deliberately several times: nothing may move, tick, or flash. If a checkbox responds at
all, the phone has gained a write path and the invariant in 0111 is broken.
