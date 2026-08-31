---
id: 107
slug: dev-tickets-capture-sheet
title: /dev/tickets capture sheet — title, body, two chip rows, Save
type: feature
priority: high
status: open
size: m
capability: 17-tickets-ui
depends_on: [24, 90]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The capture sheet at `/dev/tickets` (`06-ui-ux.md` §7.3, `07-ticketsmith.md` §5.2). This is the
screen that satisfies D-092 as an *experience*; 0018/0019 already satisfied it as plumbing.

A full-width FAB on every `/dev` screen opens a sheet:

| Field | Control | Default | Required |
|---|---|---|---|
| **Title** | single-line text, **autofocused** so the keyboard is already up | — | **yes — the only required field** |
| Body | optional textarea, 3 rows, grows | empty | no |
| Type | chip row: `feature` · `bug` · `design` · `chore` | `feature` | no |
| Priority | chip row: `low` · `med` · `high` | `med` | no |
| — | **Save**, thumb-reachable bottom-right, 56dp, above the keyboard | — | — |

**That is the entire form.** Two taps and a sentence: under fifteen seconds, one-handed, while
catching your breath.

Interaction requirements, all testable:

- Autofocus the title and raise the keyboard on sheet-open. **No tap to focus.**
- Save reachable by the right thumb without a grip change.
- **Voice dictation must work** — the fastest input mid-recovery, and the reason the title is a
  plain text field with no formatting affordances, no markdown toolbar, no `#` autocomplete.
- Chips are single-tap. No dropdowns, no long-press, no multi-select.
- **Save dismisses immediately. Never show a spinner.** The write is local; the network is not the
  user's problem.

Offline behaviour (§5.3 / §7.4) is part of this ticket because capture must never fail visibly:
Save writes to **IndexedDB immediately** and the item renders optimistically at the top of the
browse list with a `pending` marker; a background-sync queue flushes to `POST /api/dev/tickets`
with exponential backoff and a client-generated UUID idempotency key, so a retried flush cannot
create two files. A small **`N pending`** badge in the app bar is the **entire** sync UI: no manual
sync button, no error toast, no retry dialog, no red state. A failed flush that is still retrying
is not a user-facing event.

The route is owner-only (`07-ticketsmith.md` §6.4, restated as D-123 gate item A-6) — a hard
allowlist check on top of the session, so the route is invisible and inaccessible to anyone else.

Legibility wins over atmosphere here as it does on the map (D-051): a capture form in
lantern-light you cannot read in bright sun is a capture form that does not get used. D-148 binds
— gold as fill or rule only, floating chrome opaque.

## Acceptance criteria

- [ ] Opening the sheet focuses the title input and raises the soft keyboard with no user tap
      (asserted in an instrumented test on Android).
- [ ] Save is enabled with a non-empty title and disabled with an empty one; type defaults to
      `feature`, priority to `med`.
- [ ] Save closes the sheet in the same frame and never renders a spinner or progress indicator —
      asserted by a test that the sheet is unmounted before the network call resolves.
- [ ] Saving with the network disabled writes to IndexedDB, renders the optimistic row with a
      `pending` marker, and shows an `N pending` badge; re-enabling the network flushes it.
- [ ] The same capture flushed twice (forced retry) creates **one** file — the idempotency key is
      sent and honoured.
- [ ] There is no manual sync button, no error toast, and no red state anywhere in the flow.
- [ ] The sheet contains exactly the four inputs above — a test asserts the rendered form control
      count, so adding a fifth field fails.
- [ ] A non-owner session gets a 404 on `/dev/tickets` (not a 403 — the route is invisible).

## Notes

The fifteen-second target is the real acceptance criterion and the others exist to protect it.
**A capture form that takes ninety seconds is a capture form that does not get used after a run**,
and per D-013 a feature whose upkeep exceeds its value gets abandoned — the constraint that
governs the app governs its ticket system too.

Everything that is *not* on this form (acceptance criteria, capability, size, dependencies, slug)
is triage's job, done later, at a keyboard, by someone who can think. 0111 makes that structural.

## Operator validation

On the Android phone, immediately after a real run, standing outside, breathing hard, one-handed,
in sunlight: open the app, tap the FAB, dictate a sentence with the voice key, tap `high`, tap
Save. Time it. If it took more than fifteen seconds or needed a second hand, the ticket is not
done. Then put the phone in airplane mode and do it again — it must behave identically, with a
`1 pending` badge and no error of any kind.
