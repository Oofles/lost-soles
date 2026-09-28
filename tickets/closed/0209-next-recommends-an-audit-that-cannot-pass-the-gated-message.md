---
id: 209
slug: next-recommends-an-audit-that-cannot-pass-the-gated-message
title: next recommends an audit that cannot pass — the gated message never checks the capability's own open tickets
type: bug
priority: high
status: closed
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-12T17:10:00Z
started: 2026-09-28T02:49:40Z
closed: 2026-09-28T02:52:03Z
---

## Description

`tickets.mjs next` tells the reader to run a capability audit **without checking whether that
capability still has open tickets**, so the only action it offers is one that is guaranteed to fail
`capability-tickets-closed`.

Two sites, neither of which consults the blocker's own ticket list:

- **`tickets.mjs:1273`** — the informational tail:
  > `19 higher-priority ticket(s) are gated on capability '08-map-and-fog-renderer' —`
  > `its audit has not passed. 'tickets.mjs audit 08-map-and-fog-renderer' to start it.`
- **`tickets.mjs:1253`** — the `die` when every ready ticket is gated. Stronger, and it opens with
  *"A capability is not done when its tickets are closed. It is done when its audit passes"* — true
  in itself, but placed here it reads as *step past the tickets, go to the audit*.

At the time the message above was printed, capability `08` had **eight open tickets**.

**This has caused a real, repeated failure.** The operator reports the agent proposing a premature
audit **roughly six times across separate sessions**, and said so plainly on 2026-09-12:
*"this is like the 6th time an audit has been recommended before the tickets are complete… I'm
starting to lose faith in your ability to analyze where we are at in the overall project."* That it
recurs across fresh contexts is the point: it is not a memory failure, it is a stable prompt
producing the same misreading.

### Why the misreading is easy, and why it will keep happening

Measured 2026-09-12: the plan had **121 tickets and there are now 208**, with **80 of the 87 new ones
`source: agent`** — filed while building. Split the open backlog by whether a ticket predates
planning:

| | planned open (id ≤ 121) | discovered open (id > 121) |
|---|---|---|
| `08`, just built | 1 | **7** |
| `09`–`17`, not yet worked | 5–8 each | 0–1 each |
| `00`, `01`, `02`, `06`, `07`, past | 0 | 21 between them |

**A capability's planned tickets run out well before the capability is finished, because building it
generates roughly seven more.** `0059` genuinely was the last *planned* ticket in `08` — its own
title, `BUILD-ORDER.md` and `09-roadmap.md` all say so, and all three were correct on 2026-08-30 and
stale four days later. So the moment the last planned ticket closes, every narrative source says
"done" and only `index.json` disagrees. **The tool is the one thing positioned to say otherwise, and
right now it says the opposite.**

This is not an `08` problem. `09` has 8 planned and 1 discovered today; it will hit the same false
ending.

## Steps to reproduce

With capability `08` holding eight open tickets (`0119`, `0186`, `0188`, `0191`, `0199`, `0200`,
`0203`, `0208`), as it did on 2026-09-12 immediately after `0059` closed:

```
node .claude/skills/tickets/scripts/tickets.mjs next
node .claude/skills/tickets/scripts/tickets.mjs audit 08-map-and-fog-renderer
```

The first prints the recommendation. The second is what it recommends, and it fails.

`tickets.mjs next --all` in the same state lists all eight as ready and ungated, which is the
contradiction: the data needed to suppress the recommendation is already loaded when the message is
printed.

## Expected vs actual

**Actual** — `next` ends with:

```
  19 higher-priority ticket(s) are gated on capability '08-map-and-fog-renderer' —
  its audit has not passed. 'tickets.mjs audit 08-map-and-fog-renderer' to start it.
```

Following it produces:

```
  FAIL  capability-tickets-closed  8 still open: 0119, 0186, 0188, 0191, 0199, 0200, 0203, 0208
  9 passed, 1 failed, 2 n/a
```

**Expected** — the message names the eight, and recommends closing them rather than an audit that
cannot pass. Something of the shape:

```
  19 higher-priority ticket(s) are gated on capability '08-map-and-fog-renderer'.
  Its audit cannot pass yet — 8 tickets in it are still open:
    0119, 0186, 0188, 0191, 0199, 0200, 0203, 0208
  Close those first; 'tickets.mjs next --all' lists them with the rest of the backlog.
```

With zero open in the blocking capability, the current wording is correct and should stand.

## Acceptance criteria

- [x] Both messages state how many tickets are **still open in the blocking capability**, and list
      their ids, whenever that count is non-zero.
- [x] When the blocking capability has open tickets, neither message recommends `audit` as the next
      action. It names closing those tickets instead, and may mention the audit only as what follows.
- [x] When the blocking capability has **zero** open tickets, the messages are unchanged — the audit
      really is next, and that path must not get noisier.
- [x] Deferred tickets are excluded from the count, matching `capability-tickets-closed`'s own rule
      (`tickets.mjs:772-774`) so the two can never disagree.
- [x] A script test covers both branches: a capability with open tickets, and one with none.
- [x] `node --test tickets.test.mjs` passes.

## Notes

Filed 2026-09-12 from the session that closed `0059`, immediately after the agent recommended the
`08` audit and the operator pushed back.

`0144` is adjacent but distinct and neither blocks the other. `0144` is the catch-22 *inside* the
audit — §2 tells you to file a ticket for a `code-was-wrong` divergence, and filing it fails
`capability-tickets-closed` on the capability being closed. This ticket is about the message that
sends you into the audit too early in the first place. Fixing both would mean the check is honest at
entry *and* at exit.

Worth considering while in here, but **out of scope unless it is free**: `next --all` already shows
the blocking capability's open tickets plainly, which is what settled the question when the operator
challenged it. Part of the fix may simply be that the gated message points at `next --all` rather
than at `audit`.

Priority high because the cost is not a wasted command — it is the agent confidently misreporting
project state to the operator, which is the expensive kind of wrong.

## Operator validation

None required — the check is that the two messages say something true, which a script test asserts.
The operator has already supplied the evidence that they currently do not.

## Resolution

**Files**
- `.claude/skills/tickets/scripts/tickets.mjs`
  - New `openInCapability(capability, tickets)`: tickets in the capability that are neither
    `closed` nor `deferred`, sorted by id. **`capability-tickets-closed` now calls it** in place of
    its inline filter, so the audit row and the `next` messages share one definition and cannot
    disagree (criterion 4). The audit row's behaviour is unchanged.
  - `next` tail (success path): when the blocker has open tickets, it prints the count and ids,
    says the audit cannot pass yet, and points at `next --all`. With zero open, it prints the
    original two lines, byte-for-byte.
  - `next` refusal (every ready ticket gated): the same split. With open tickets, the message also
    says **none of them is ready**, which must be true here or one would have been offered, so they
    are blocked or waiting on dependencies. It points at `tickets.mjs show <id>` rather than the
    audit commands. With zero open, the original refusal text and audit commands are unchanged.
- `.claude/skills/tickets/scripts/tickets.test.mjs`: new `0209` describe block with four tests,
  covering the tail and the refusal, each with open tickets in the blocker and with none. The
  zero-open fixtures include a **deferred** ticket in the blocker, so criterion 4 is exercised
  rather than assumed. The open-tail test also runs the real `audit 01-b` and asserts it reports
  the same ids, pinning the "cannot disagree" property end to end. An `in-progress` ticket counts
  as open, matching the audit.
- `.claude/skills/tickets/SKILL.md` `## next`: the instruction was "if it refuses because every
  ready ticket is gated … **run the audit it names**", the same misreading in prose form. A fixed
  message under an unfixed instruction would still send the agent to the audit. It now says to
  follow what the message says, not to propose the audit while it lists open tickets, and gives the
  reason. This is one paragraph and part of the same fix, not new scope.

**Checked that the tests bite.** Against the pre-change `tickets.mjs`, the two open-ticket tests
fail and the two zero-open tests pass. That is the intended shape: the first pair proves the bug,
the second pins the path that must not get noisier.

**State at close.** Capability `08` has **7** open tickets, not the 8 in the Description: `0199` has
closed since. Real `next` now ends with *"Its audit cannot pass yet — 7 ticket(s) in it are still
open: 0119, 0186, 0188, 0191, 0200, 0203, 0208"*, and `audit 08-map-and-fog-renderer` fails
`capability-tickets-closed` on exactly those seven.

**Not done:** `0144` (the catch-22 inside the audit) is adjacent, as the Notes say, and untouched.

## Operator validation

None needed from the operator: this is CLI message text asserted by tests. Verified by the agent:

- `node --test tickets.test.mjs`: **157/157 pass**, including the four new `0209` tests.
- The new tests run against the old script: 2 fail (the bug), 2 pass (the unchanged path).
- Real repo: `tickets.mjs next` lists 08's seven open tickets and does not recommend the audit, and
  `tickets.mjs audit 08-map-and-fog-renderer` names the same seven under `capability-tickets-closed`.
- `tickets.mjs validate`: 0 errors, 0 warnings.

