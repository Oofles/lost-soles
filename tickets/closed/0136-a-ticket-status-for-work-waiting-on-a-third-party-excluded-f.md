---
id: 136
slug: a-ticket-status-for-work-waiting-on-a-third-party-excluded-f
title: A ticket status for work waiting on a third party, excluded from the capability close gate
type: feature
priority: high
status: closed
size: m
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-01T19:04:02Z
started: 2026-09-01T20:25:19Z
closed: 2026-09-01T20:34:55Z
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

- [x] A fifth status exists for work that is specified, correct, and waiting on something outside
      the project's control. It carries a **mandatory reason** and a **mandatory re-check
      condition** — the cheap test that says whether the wait is over. `0128` already has exactly
      such a test in its Notes; the status should make recording one compulsory rather than lucky.
- [x] The status is **excluded from the audit's `capability-tickets-closed` check**, so a capability
      can close with deferred tickets outstanding. The audit record must **name them**, so a
      capability that passed with three deferred tickets never looks like one that passed clean.
- [x] `next` does not offer a deferred ticket as workable, and says how many are deferred alongside
      the existing `N ready, M gated` line.
- [x] There is a script command to enter and leave the state, maintaining `index.json` and the
      `git mv` like every other transition. **No hand-edited frontmatter** — that is the standing
      rule this ticket must not create an exception to.
- [x] Leaving the state is **not automatic**. Something must re-run the re-check condition and a
      human or agent must read the result; a ticket that silently un-defers is a ticket nobody
      looks at.
- [x] `validate` treats a deferred ticket with no reason, or no re-check condition, as an error.
- [x] `0128` is migrated to it, with its reproduction as the re-check condition, and capability
      `02`'s audit is re-run to confirm **`0128` no longer holds it** — `capability-tickets-closed`
      passes on the deferral alone, with no `--force`. *(Amended: the original wording said the
      audit passes outright. It does not, and not because of anything here — `0129` is still
      genuinely open. See ## Resolution.)*
- [x] `docs/07-ticketsmith.md` §3 and `docs/TICKET_FORMAT.md` document the status, including the
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

## Resolution

**What was built.** A fifth status, `deferred`, for work that is specified, correct, and waiting on
something outside the project. Recorded as **D-174**.

Files touched:

- `.claude/skills/tickets/scripts/tickets.mjs` — `deferred` added to `ENUMS.status` and a `deferred:`
  timestamp to `FIELD_ORDER`; a `deferral()` parser for the `## Deferred` body section; four new
  `validate` rules; `capability-tickets-closed` excludes deferred tickets and names them; the audit
  record grows a `deferred: [...]` field and a prose line; `next` counts deferrals aloud and marks
  them in `--all`; three new commands, `defer`, `resume` and `recheck`.
- `.claude/skills/tickets/scripts/tickets.test.mjs` — 14 tests, taking the suite from 101 to 115.
- `docs/07-ticketsmith.md` §3 and `docs/TICKET_FORMAT.md` — the status, the `## Deferred` section,
  and the `blocked` vs `deferred` sentence, in both (§3 is normative; they change together).
- `docs/decisions/DECISIONS.md` — D-174.
- `.claude/skills/tickets/SKILL.md` and `reference.md` — routing rows, a `## defer` procedure, the
  command list, the validation-rule list, and `recheck` added to the `sync` step.
- `tickets/open/0128-…md` — migrated to `deferred` via `defer`, not by hand.

**Decisions made, both settled with the operator before any code was written** (the ticket's Notes
asked for exactly this):

1. **The re-check is runnable shell, run on demand, reported and never acted on.** The alternative
   was prose. `0128`'s check was already three shell lines, and a check only a human can evaluate is
   one nobody evaluates. The thing this buys — `sync` saying "0128's wait may be over" — is the
   whole reason the status is not just a label. What it must not buy is automatic un-deferring, so
   `recheck` exits 0 whichever way the check went and prints `resume` as a suggestion, never runs it.
2. **`deferred` lives in `open/`**, exactly as `blocked` does, so there is no `git mv` and no fourth
   folder. Criterion 4's phrase "the `git mv` like every other transition" reads as if it assumed a
   move; the substance of the criterion — a script command that maintains `index.json` so no
   frontmatter is ever hand-edited into the state — is met, and `block` sets the precedent for a
   status change with no move.

**Two things went differently than planned.**

*The re-check's first draft reported badly.* It ran correctly and reported `npm error A complete log
of this run can be found in: /root/.npm/_logs/…` — because `runCheck` returns the last output line,
and `npm ci`'s last line is a log path. A report whose entire product is legibility had produced a
line nobody can act on. The block now prints a one-line verdict on both paths, and the reported
line is `npm ci still fails on ^1.24.0: npm error Missing: @aws-cdk/toolkit-lib@1.19.0 from lock
file`. The general lesson is in the SKILL.md procedure: write the re-check so its **last line** is
the verdict.

*Capability `02` still does not pass, and criterion 7 had to be amended.* `0128` is out of the way —
`capability-tickets-closed` now reads `1 closed; 1 deferred (0128)` where it read
`4 still open: 0128, 0129, 0130, 0131`. But `0129` (cross-app SSO — evaluate Google sign-in against
`08` §5.1) is still open, and it is *genuinely* open: it is waiting on an operator decision about
whether to add a federated IdP against `08-security-privacy.md` §5.1's explicit prohibition, which
is work inside this project and precisely what `open` means. `0130` and `0131`, both open when this
ticket was filed, closed in the meantime. So the ticket's premise — that `0128` was the only thing
holding `02` — was true on 2026-09-01 and is no longer the whole story. Deferring `0129` too would
be the exact abuse of this status the ticket exists to prevent, and no `--force` was used. The
criterion was amended to what is verifiable and this paragraph says why.

**`0128`'s re-check was run twice against the real repo today** and the upstream defect is still
live, so its premise is re-verified as of 2026-09-01.

## Operator validation

None — this is ticket-system tooling with no user-visible surface. What was actually checked, at the
keyboard in `/home/vivicat/lost-soles`:

- `node --test .claude/skills/tickets/scripts/tickets.test.mjs` — 115 pass, 0 fail (101 before).
- `tickets.mjs validate` — 0 errors, 0 warnings, with `0128` deferred.
- `tickets.mjs recheck` against the live repo, twice, ~60s each: reports `waits 0128  npm ci still
  fails on ^1.24.0: npm error Missing: @aws-cdk/toolkit-lib@1.19.0 from lock file`, exits 0, and the
  ticket file is byte-identical afterwards.
- `tickets.mjs audit 02-deploy-and-auth` — `capability-tickets-closed` now reads
  `1 still open: 0129; 1 deferred (0128)`. Before the migration it read `2 still open: 0128, 0129`.
  A test covers the case that matters and cannot be shown here — the same check going FAIL → pass
  → recorded with `deferred: ["0002"]` and `verdict: "pass"` once the last non-deferred ticket
  closes.
- `tickets.mjs next` offers `0136`, not `0128`, and prints
  `1 ticket(s) deferred, waiting on something outside the project (0128).`
- `tickets.mjs next --all` marks it `[DEFERRED]` and ends
  `11 ready, 8 gated on an unaudited capability, 1 deferred on something outside the project`.
