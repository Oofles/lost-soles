---
id: 136
slug: a-ticket-status-for-work-waiting-on-a-third-party-excluded-f
title: A ticket status for work waiting on a third party, excluded from the capability close gate
type: feature
priority: high
status: open
size: m
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-01T19:04:02Z
---
## Description

**Found on 2026-09-01, when capability `02`'s audit could not pass and no honest route existed
around it.**

Ticket `0128` restores `npm ci` to `amplify.yml` once the Amplify Gen 2 bundled-dependency defect
is fixed **upstream**. Its premise was re-verified the day this ticket was filed — the two-line
reproduction still fails:

```
npm error Missing: buffer@6.0.3 from lock file
npm error Missing: at-least-node@1.0.0 from lock file
npm error Missing: jsonfile@6.2.1 from lock file
ci exit=1
```

`0128` is therefore **correct, well-specified, and unworkable** — and will stay that way until a
third party we do not control ships a fix. It is not blocked by another ticket, so `blocked_by`
cannot express it. It is not closed, because its acceptance criteria are genuinely unmet and
`close` rightly has no `--force`.

**The consequence is out of all proportion to the cause.** The audit's §5 check is:

```
FAIL  capability-tickets-closed  4 still open: 0128, 0129, 0130, 0131
```

so capability `02` cannot be audited, and D-153's gate then holds **eight** high-priority tickets
(`0019`, `0023`, `0024`, `0026`, `0028`, `0052`, `0062`, `0070`) across five later capabilities.
An npm packaging defect in someone else's tarball is currently the critical path of this entire
project.

**The status vocabulary has no word for this.** `tickets.mjs:35` declares
`status: ["inbox", "open", "blocked", "closed"]`. Every one of them is wrong here:

| Status | Why it does not fit |
|---|---|
| `open` | Implies it is workable. It is not, and a future session will re-derive that at cost. |
| `blocked` | `blocked_by` holds ticket ids. There is no ticket for "npm fixes its tarballs". |
| `closed` | The work is not done and the criteria are not met. Closing it is a lie in the record. |
| `inbox` | Untriaged. This is the opposite — it is thoroughly triaged. |

## Acceptance criteria

- [ ] A fifth status exists for work that is specified, correct, and waiting on something outside
      the project's control. It carries a **mandatory reason** and a **mandatory re-check
      condition** — the cheap test that says whether the wait is over. `0128` already has exactly
      such a test in its Notes; the status should make recording one compulsory rather than lucky.
- [ ] The status is **excluded from the audit's `capability-tickets-closed` check**, so a capability
      can close with deferred tickets outstanding. The audit record must **name them**, so a
      capability that passed with three deferred tickets never looks like one that passed clean.
- [ ] `next` does not offer a deferred ticket as workable, and says how many are deferred alongside
      the existing `N ready, M gated` line.
- [ ] There is a script command to enter and leave the state, maintaining `index.json` and the
      `git mv` like every other transition. **No hand-edited frontmatter** — that is the standing
      rule this ticket must not create an exception to.
- [ ] Leaving the state is **not automatic**. Something must re-run the re-check condition and a
      human or agent must read the result; a ticket that silently un-defers is a ticket nobody
      looks at.
- [ ] `validate` treats a deferred ticket with no reason, or no re-check condition, as an error.
- [ ] `0128` is migrated to it, with its two-line reproduction as the re-check condition, and
      capability `02`'s audit is re-run to confirm it passes without a `--force`.
- [ ] `docs/07-ticketsmith.md` §3 and `docs/TICKET_FORMAT.md` document the status, including the
      distinction from `blocked` — the sentence that stops the next person conflating them.

## Notes

**The failure mode this is guarding against is a `--force`, not a stuck backlog.** `audit --force`
exists and would clear capability `02` today. The reason not to reach for it: a forced audit
records `verdict: forced` for the *whole capability*, which permanently understates `02` — its
design conformance and operator validation are fine, and one npm bug should not put an asterisk on
all six of its tickets forever. Forcing also trains the reflex that the gate is negotiable, which
is the precise thing D-153 was written to prevent.

**Why `high` priority for a tooling ticket.** It is on the critical path of eight high-priority
tickets right now. It stops being urgent the moment npm ships a fix — but betting the schedule on
someone else's release cadence is what got us here.

**Design question for whoever picks this up, worth settling before writing code.** Is the
re-check condition a *shell command the script can run* (so `sync` could report "0128's re-check
now passes"), or *prose a human reads*? A runnable check is far more valuable and only slightly
harder — `0128`'s is already literally two shell lines. But a runnable check invites automatic
un-deferring, which criterion 5 forbids. The likely resolution is: runnable, run on `sync`,
**reported and never acted on**. Confirm before building.

Related: `0128` (the ticket that occasioned this), `0133` (the audit implementation),
`0135` (the gate that turns one open ticket into eight blocked ones).

## Operator validation

None — this is ticket-system tooling with no user-visible surface. The check that matters is that
`node .claude/skills/tickets/scripts/tickets.mjs audit 02-deploy-and-auth` reports
`capability-tickets-closed` as passing with `0128` deferred, and that `next` no longer offers
`0128`.
