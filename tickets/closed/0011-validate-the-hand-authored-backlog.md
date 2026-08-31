---
id: 11
slug: validate-the-hand-authored-backlog
title: Validate the entire hand-authored backlog and fix everything it finds
type: chore
priority: high
status: closed
size: m
capability: 01-ticket-system
depends_on: [6, 7, 9, 10]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-08-31T03:18:25Z
---

## Description

Run `tickets.mjs validate` over the whole seed backlog — the ~112 tickets 0006 wrote by hand, with
no tooling, in a format that nothing checked at the time — and fix every error it reports. Then close
this ticket, and the whole `01-ticket-system` capability, **using the system itself**. That closure
is the moment the bootstrap completes (`09-roadmap.md` §4.1 step 3).

**This backlog is not clean, and this ticket exists because it is not.** `07-ticketsmith.md` §7.5.1
is explicit: the first four tickets are written in a format nothing validates yet, so a frontmatter
error is found only after the validator ships. §7.5 adds the standing instruction: **treat a clean
first run as suspicious.** A validator that reports nothing over 112 hand-typed YAML blocks is far
more likely to be broken than the backlog is to be perfect — if the first run is clean, the correct
response is to go and prove the validator can fail, not to celebrate.

The seed set was authored in parallel across several id ranges (see 0006's notes), which makes the
likely error classes predictable. Look for them specifically:

- **`depends_on` ids that do not exist**, especially cross-range references where one authoring
  session guessed at another's numbering.
- **Duplicate or skipped ids** at range boundaries.
- **`id` / `slug` / filename disagreement** — a renamed file whose frontmatter was not updated, or a
  padded id written into the `id` field where a bare integer belongs.
- **`capability` values with no matching `docs/capabilities/NN-name.md`** (a warning, but it usually
  means a typo'd capability name).
- **`design` tickets missing `## Options considered` / `## Open questions`**, or whose acceptance
  criteria say "the feature works" instead of "a capability doc exists with no open questions".
- **Missing `## Operator validation`**, or a reflexive "None" on something the operator can plainly
  see.
- **Dependency cycles**, which hand-authoring across ranges makes genuinely possible.
- **`size: l` tickets** — the validator warns; each warning is either split into `s`/`m` tickets or
  gets a written justification in its `## Notes`. Ticket 0006 is the known, justified exception.

**Baseline from the planning-session validation pass (2026-08-30).** An ad-hoc validator (not
`tickets.mjs`) already ran over the seed set and reported: 117 files, ids 1–117 with no gaps or
duplicates, no dangling `depends_on`, no cycles, no self-references, all four body sections present
everywhere, and exactly one `size: l` (0006, deliberate). It fixed 8 missing cross-capability
dependency edges, generated 19 capability stubs, and split 0055/0056 into 0118/0119 — see 0006's
`## Resolution` for the full list.

So the obvious errors are already gone, which **raises the bar for this ticket rather than lowering
it**: `tickets.mjs` finding nothing is now the expected outcome, not evidence that it works. The
deliberate-error injection criterion below is therefore the load-bearing part of this ticket, not a
formality. Four known-remaining oddities it should have an opinion about: 4 forward dependencies
(68→70, 69→70, 108→110, 109→110 — a ticket depending on a higher id, legal but worth flagging),
0006 being closed-on-arrival, the capability docs being stubs rather than real DESIGN output, and
whether `size: l` should be an error or a warning.

Fixes are made in the tickets, not in the validator. If a rule seems wrong, that is a separate
argument recorded as a `D-xxx` — do not loosen a validation rule to make the seed set pass.

## Acceptance criteria

- [x] `node tickets.mjs validate` has been run over `tickets/{inbox,open,closed}/` and its **first**
      run's complete output is pasted verbatim into `docs/capabilities/01-ticket-system.md`, errors
      and warnings both.
- [x] Every reported **error** is fixed in the ticket files, and `validate` now exits 0.
- [x] Every reported **warning** is either fixed or has a one-line written justification, listed in
      the capability doc against the ticket id.
- [x] If the first run reported nothing, a deliberate error is injected into a scratch copy of the
      backlog (a dangling `depends_on`, a duplicate id, an enum typo) and `validate` is shown to
      catch each — proving the clean result, not assuming it. The evidence goes in the capability doc.
- [x] `node tickets.mjs index && node tickets.mjs next` returns a ticket with no unmet `depends_on`,
      and the answer is sanity-checked by eye against `09-roadmap.md` §3's ordering.
- [x] `/tickets list` prints the **whole** backlog as one table with no missing or duplicated rows;
      the row count equals the file count in `tickets/open/`.
- [x] The dependency graph over the whole backlog is acyclic, confirmed by the 0009 cycle check.
- [x] Every `capability` value in the backlog has a corresponding `docs/capabilities/NN-name.md`.
- [x] A short "what hand-authoring got wrong" section is written into
      `docs/capabilities/01-ticket-system.md`, categorising the errors found and their counts. This
      is the honest record §7.5 asks for and it is the input to any future seeding.
- [x] This ticket is closed with `/tickets close`, producing a `tickets(#0011): ...` commit — i.e.
      **the system closes itself using itself**, and the capability's `## Operator validation` is
      filled in for real.

## Notes

`09-roadmap.md` §3 states the capability's done condition: `/tickets list` prints the whole backlog
as one table; `/tickets next` returns a ticket with no unmet `depends_on`; `validate` is clean; and
the capability is closed *using the system itself*, with `## Operator validation` filled in.

This is a `chore`, not a `bug`: the seed backlog was authored under known conditions with a known
absence of tooling, so its errors are expected output of a planned process rather than a defect
report. Individual findings that turn out to be design mistakes (a wrong dependency direction, a
ticket that should not exist) get their own tickets via `/tickets create` with `source: agent`
rather than being silently rewritten here — this ticket fixes **format**, not **plan**.

Expect the fix pass itself to be the first real use of `tickets.mjs` mutating commands at scale. If
something about them is awkward, file it; do not work around it by hand-editing, because a
hand-edited fix teaches nothing about whether the tool works.

## Operator validation

1. On the laptop, run `node .claude/skills/tickets/scripts/tickets.mjs validate` in a terminal and
   watch it exit 0. It prints `0 error(s), 0 warning(s)` — there are genuinely no warnings to read
   aloud, and §"Warnings" in `docs/capabilities/01-ticket-system.md` explains why that is correct
   rather than a miss. **A clean run is not the check.** The check is the next line: open that
   capability doc and read the seventeen-row injection table. If you are not convinced by it that
   the validator can fail, this ticket is not done.
2. In Claude Code, type `/tickets list`. Count the rows against `ls tickets/open/ | wc -l`. They must
   match exactly.
3. In Claude Code, type `/tickets next` and confirm the returned ticket is one you would actually
   pick up next given the roadmap — this is a judgement check the script cannot make for you.
4. In a desktop browser on GitHub, open the commit produced by closing this ticket. It must be a
   single `tickets(#0011)` commit, and `tickets/closed/0011-validate-the-hand-authored-backlog.md`
   must be present in the tree with `## Resolution` and `## Operator validation` filled in.
5. On the Android phone, open `docs/capabilities/01-ticket-system.md` in the GitHub mobile web view
   and read the "what hand-authoring got wrong" section. If it is not honest and specific enough to
   be useful, it is not done.

## Resolution

**The first run was clean — 0 errors, 0 warnings over 125 files — and the whole value of this ticket
is in what was done about that.**

### What was actually run

`validate` over `tickets/{inbox,open,closed}/`, output captured before anything was touched and
pasted verbatim into `docs/capabilities/01-ticket-system.md`. It found nothing. Per
`07-ticketsmith.md` §7.5 that is a result to distrust, not to bank, so the bulk of the session went
into falsifying it: **seventeen deliberate defects injected one at a time into a scratch copy of the
backlog** (`TICKETS_ROOT` pointed at a throwaway tree — the real `tickets/` was never modified).
All seventeen were caught; every error case exited 1 and every warning case exited 0. The full table
is in the capability doc.

Then the reverse: four probes for defects the validator *should* catch and does not. All four passed
clean, including **a ticket whose body was deleted entirely, leaving frontmatter only**.

### What went wrong along the way

- **I recorded injection 16 as a miss, and it was not.** `size: l` on ticket 0012 produced no
  warning, which looked like a hole in the rule. It is not: the rule is `size === "l" &&
  isReady(...)`, and 0012 depends on the still-open 0011, so it is correctly outside the ready set.
  Re-run against 0011, which *is* ready, it fires — and `next` additionally refuses the ticket
  outright. Both the wrong reading and the correction are recorded in the capability doc, because the
  correction is the useful part.
- **I first wrote up the four gaps as "the validator under-implements its own spec". That was
  wrong.** Checking §4.7 line by line shows `tickets.mjs` implements **all 13 error rules and all 5
  warning rules** faithfully, with nothing extra. The real finding is narrower and more interesting:
  **§3 and §4.7 of the same document disagree** — §3 makes the four body sections normative, §4.7's
  rule list has no check for them. Ticket `0126` was rewritten to settle the design question and
  amend §4.7 with a `D-xxx` *before* touching the validator, rather than quietly extending it.
- **`node --test <directory>` over the scripts dir reports a spurious failure** on Node 23.11.1 — it
  tries to execute `tickets.mjs`, which prints usage and exits 1. I briefly took this for a real test
  failure. CI and `.githooks` both use the explicit file path, where all **48 tests pass**. Noted in
  the audit so nobody "simplifies" CI into the broken form.

### Findings, and where each went

| Finding | Disposition |
|---|---|
| Prose splice in 0011's own body — a paste landed mid-bullet, truncating it at ``its `## Notes`` and stranding its tail 18 lines lower | **Fixed here.** The only defect hand-authoring actually left behind, and no validator would have caught it. |
| §3 vs §4.7 disagree on empty ticket bodies | Filed as `0126` (`source: agent`) — design amendment first, then the check. |
| `create` slug derivation trims hyphens *before* truncating, so a long title yields an invalid slug and `create` dies | Filed as `0127` (`source: agent`). Hit for real while filing `0126`. |
| 4 forward dependencies (`0068→0070`, `0069→0070`, `0108→0110`, `0109→0110`) | **No fix, no rule.** All legal and acyclic; a warning here would fire on four correct tickets and train the operator to ignore warnings. Reasoning in the capability doc. |
| Should `size: l` be an error? | **No.** Warning in `validate`, hard refusal in `next` — enforcement at the moment of pickup. Recorded as **D-161**. |
| 0006 closed-on-arrival; capability docs are stubs | Both correct as-is; reasoning recorded rather than changed. |

### On criterion 6's wording

The criterion asks that `/tickets list` print the whole backlog and that "the row count equals the
file count in `tickets/open/`". Those are two different numbers whenever anything is closed. Both
were checked and both hold: bare `list` prints **127 rows for 127 files** (116 open + 11 closed) with
no missing or duplicated rows, and `list --status open` prints **116, exactly matching
`ls tickets/open/*.md | wc -l`**. Recorded rather than silently reinterpreted.

### Scope

Two tickets were filed rather than fixed inline (D-152), and this capability's ticket count went 5 →
8 as a result. The capability's drift audit was run by hand against `AUDIT.md` and appended to
`docs/capabilities/01-ticket-system.md`: **two divergences against a budget of three**, so `02` may
start without a DESIGN session on `07-ticketsmith.md`.

### On closing with `--allow-dirty`

`close` was run with `--allow-dirty`, deliberately. D-158's exemption covers exactly one path — the
ticket being closed — but D-150 requires the ticket file and the work satisfying it to land in **one**
commit, and this ticket's deliverables are four other files (the capability doc, `DECISIONS.md`, two
new tickets). Committing them first to get a clean tree would produce two commits and break D-150;
the hatch is the correct resolution, and D-158's own comment invites it ("pass `--allow-dirty` if you
have considered it").

Worth flagging as recurring friction rather than a one-off: **every capability-closing ticket will
hit this**, because closing a capability always writes the audit into the capability doc. Not filed
as a ticket — the hatch works and the reasoning is now on record — but if a third or fourth close
reaches for `--allow-dirty` for this same reason, the exemption should take a list of paths instead
of one, and D-158 should say so.

### Files touched

- `tickets/open/0011-...md` — splice repaired, criteria ticked, this section.
- `docs/capabilities/01-ticket-system.md` — first-run output verbatim, injection evidence, §4.7
  conformance, the four oddities, "what hand-authoring got wrong", the full audit, and REFLECT.
- `docs/decisions/DECISIONS.md` — **D-161**.
- `tickets/open/0126-...md`, `tickets/open/0127-...md` — new, `source: agent`.
- `tickets/index.json` — regenerated.

**This ticket closes `01-ticket-system`, and with it the bootstrap** (`09-roadmap.md` §4.1 step 3):
the system is now maintained by itself. `next` after this close is `0012`, the Next.js + Amplify
skeleton — which is exactly what roadmap §3 puts first in `02-deploy-and-auth`.
