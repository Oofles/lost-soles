---
id: 111
slug: enforce-tickets-ui-v1-non-goals
title: Enforce the v1 non-goals — create and browse only, no write path from the phone
type: chore
priority: high
status: closed
size: s
capability: 17-tickets-ui
depends_on: [107, 108, 109, 110]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-09-28T17:43:02Z
---

## Description

`07-ticketsmith.md` §5.6 lists the v1 non-goals: **no editing, no closing, no reordering, no
comments, no kanban board, no charts, no notifications, no assignment** (there is one human). This
ticket makes them structural instead of aspirational.

**Why this is an invariant and not a preference.** D-092 requires create + browse; §2.2 Move 2
limits v1 to exactly that. The reason is write-set disjointness: **the phone only ever creates;
the agent only ever edits and moves.** The phone's only write is a new file in `tickets/inbox/`.
The agent's writes are edits and moves of files under `tickets/open/` and `tickets/closed/`. Two
writers that never touch the same bytes **cannot conflict** — merge conflicts are not "unlikely
here", they are structurally impossible. Add editing or closing from the phone and that property
is gone: not degraded, gone, and the failure shows up as a lost edit during a session weeks later.

Also on the forbidden list from §5.2 / `06-ui-ux.md` §7.3, because they are how the form dies by
increments: acceptance-criteria fields, a capability picker, a size picker, a dependency selector,
a slug field. Every one of them is triage's job. **Resist every temptation.**

## Acceptance criteria

**Withdrawn 2026-09-28 — D-252.** Declined: capability `17` is withdrawn and no in-app ticket UI
will be built. The original criteria are preserved verbatim in `## Resolution`.

- [x] Closed as declined, with a `## Resolution` recording the decision, and moved to `closed/`
      rather than deleted.

## Notes

The most likely breach is not someone building a kanban board. It is a "just let me tick the
checkbox off from the couch" change, made in five minutes, that quietly gives the phone a write
into `open/`. That is why the checkbox inertness has its own criterion and why the grep is a build
failure rather than a lint warning.

Size `s` deliberately: this ticket adds almost no code. It adds two greps, a rendered-tree
assertion, and a paragraph in the capability doc. Its value is entirely in being closed *before*
anyone has the idea.

## Resolution

**Declined 2026-09-28. Recorded as D-252.** Operator's decision, answering the question put during
`0215`'s sweep: *"Close all of cap 17."*

D-092 required in-app ticket creation because it was **phone-friendly**: a thought at mile six
captured before it was lost. Everything in capability `17` followed from that. The capture sheet
was sized for a thumb, and browse and detail were read-only mirrors so the phone never needed
GitHub. D-251 removed the phone as a viewing surface. The operator then removed it as an input
surface too: *"I don't use /log or capture from my phone."* At the desktop, the repo, GitHub,
`tickets.mjs` and the agent already do everything this ticket planned, so building it would
duplicate tools that are already open.

**What stays:**
- the capture endpoint `/api/tickets/capture` (capability `03`, `0018`) and its bearer auth
  (`0149`);
- the `inbox/` triage flow.

They are built, harmless and cost nothing. The two `/dev/tickets` stub routes from `0016` are
removed under `0216`.

Nothing was built under this ticket, and no code changed. It is the same shape as `0020` and `0021`
under D-184: a capture path declined because its reason for existing went away.

### Original acceptance criteria (verbatim)

- [ ] `grep -r` over the Next.js app finds **no** call to the GitHub Contents API with a `sha`
      parameter and no `PATCH`/`DELETE` against any ticket path — and that grep **fails the
      build**.
- [ ] The capture endpoint has no update and no delete handler — absent, not disabled (restating
      0018's criterion at the UI layer, verified from the client side).
- [ ] The capture sheet renders exactly four inputs (title, body, type chips, priority chips); a
      test asserts the count so adding a fifth fails the build.
- [ ] Browse rows and detail views expose zero mutating affordances: a test walks the rendered
      tree for `/dev/tickets` and `/dev/tickets/:id` and asserts no interactive element other than
      navigation links, filter chips, and the capture FAB.
- [ ] Acceptance-criteria checkboxes in detail are non-interactive marks, not disabled inputs.
- [ ] There is no notification registration, no board view, and no chart component under the
      `/dev` route tree.
- [ ] `docs/capabilities/17-tickets-ui.md` records the non-goal list and the write-set-disjointness
      reason, so a future reader hits the argument before the temptation.
- [ ] The capability's own done-condition is verified: browse and detail work offline from the
      cache, capture still works when the cache is stale, and **no write path exists from the
      phone other than `inbox/`**.

## Operator validation

On the Android phone, go through every `/dev` screen and deliberately try to change something: tap
an acceptance checkbox, long-press a row, swipe a row both directions, look for an edit pencil, a
close button, an overflow menu. You should find nothing at all. Then on the laptop, add a
`PATCH` handler to the tickets API in a scratch branch and push — CI must go red on the forbidden
grep. If it does not, this ticket is not done, whatever the UI looks like.

**Declined, 2026-09-28.** Nothing was built, so there is nothing to observe or smoke-test. The
check is the record: D-252 exists and `09` §3 marks capability `17` withdrawn.
