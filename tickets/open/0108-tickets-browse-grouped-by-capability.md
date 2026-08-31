---
id: 108
slug: tickets-browse-grouped-by-capability
title: Browse tickets, grouped by capability, priority-then-id within group
type: feature
priority: med
status: open
size: m
capability: 17-tickets-ui
depends_on: [107, 110]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Screen 2 of the in-app ticket UI (`07-ticketsmith.md` §5.4): a **read-only** list rendered from
the cached mirror.

- Default filter `status != closed`, **grouped by `capability`**, sorted **priority then id**
  within each group.
- Row format: `#0042 · feature · high · Award half Wayfaring XP on explored ground`.
- **Inbox items pinned at the top** with a distinct "untriaged" treatment, so the user can see
  their capture landed and can watch the untriaged pile grow. That pile growing is information —
  it is the signal that triage is overdue — so it must be visible, not tucked behind a filter.
- Filter chips: status, type, priority, capability. **Nothing more.**
- A `closed` filter exists but is not the default. `closed/` is an archive to consult, not a feed
  to scroll.

Read-only means read-only: **no swipe actions, no checkboxes, no long-press menu, no drag to
reorder.** The phone only ever *creates*; the agent only ever *edits and moves*. Every row here is
a link and nothing else.

Offline is the normal case, not the exception: the list renders from the local mirror of the cache
with the radio off, plus any optimistic `pending` rows from IndexedDB (0107). It never blanks and
never shows an offline banner — a banner announcing a condition the user cannot fix is chrome that
exists to blame the world (`06-ui-ux.md` §9.5).

## Acceptance criteria

- [ ] The list groups by `capability` with the capability name as a section header, and sorts
      `high` → `med` → `low` then ascending id within each group — asserted against a fixture with
      shuffled input.
- [ ] Default view excludes `closed`; the `closed` chip includes them and is not sticky across
      app restarts.
- [ ] Inbox (untriaged) items pin above all capability groups with a visually distinct treatment,
      regardless of the active filters except an explicit status filter.
- [ ] Rows render in the `#0042 · type · priority · title` format with zero-padded ids.
- [ ] Exactly four filter chip groups exist (status, type, priority, capability) — a test asserts
      the chip group count so a fifth fails.
- [ ] No row exposes any mutating affordance: no swipe handler, no checkbox, no context menu — a
      test asserts the row component renders no `button` other than the row link itself.
- [ ] With the radio off, the list renders from the local mirror in under 1 s and shows
      `pending` captures at the top.

## Notes

**Ordering note:** the read cache (0110) is listed after browse in the capability table but is a
hard prerequisite for it — this ticket's `depends_on` reflects that rather than the table order.
Build 0110 first, or ship browse against the local IndexedDB rows only and light the cache up
after; do not invent a second read path from the UI to GitHub to work around it.

Sorting by priority *then* id rather than by date is deliberate: this list is consulted to decide
what to do next, not to see what happened recently. The chronicle is the recency surface; this
is not.

## Operator validation

On the Android phone in airplane mode, open `/dev/tickets`. The list must paint immediately,
grouped by capability, with your most recent captures pinned at the top marked untriaged. Scroll
to a capability you have finished and confirm its closed tickets are absent by default. Try to
swipe a row left and right and long-press it — nothing may happen. Then in sunlight, at arm's
length, read three row titles: if the `· type · priority ·` metadata is competing with the title
for attention, the row hierarchy is wrong.
