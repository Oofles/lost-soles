---
id: 11
slug: validate-the-hand-authored-backlog
title: Validate the entire hand-authored backlog and fix everything it finds
type: chore
priority: high
status: open
size: m
capability: 01-ticket-system
depends_on: [6, 7, 9, 10]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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
  gets a written justification in its `## Notes

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
`. Ticket 0006 is the known, justified exception.

Fixes are made in the tickets, not in the validator. If a rule seems wrong, that is a separate
argument recorded as a `D-xxx` — do not loosen a validation rule to make the seed set pass.

## Acceptance criteria

- [ ] `node tickets.mjs validate` has been run over `tickets/{inbox,open,closed}/` and its **first**
      run's complete output is pasted verbatim into `docs/capabilities/01-ticket-system.md`, errors
      and warnings both.
- [ ] Every reported **error** is fixed in the ticket files, and `validate` now exits 0.
- [ ] Every reported **warning** is either fixed or has a one-line written justification, listed in
      the capability doc against the ticket id.
- [ ] If the first run reported nothing, a deliberate error is injected into a scratch copy of the
      backlog (a dangling `depends_on`, a duplicate id, an enum typo) and `validate` is shown to
      catch each — proving the clean result, not assuming it. The evidence goes in the capability doc.
- [ ] `node tickets.mjs index && node tickets.mjs next` returns a ticket with no unmet `depends_on`,
      and the answer is sanity-checked by eye against `09-roadmap.md` §3's ordering.
- [ ] `/tickets list` prints the **whole** backlog as one table with no missing or duplicated rows;
      the row count equals the file count in `tickets/open/`.
- [ ] The dependency graph over the whole backlog is acyclic, confirmed by the 0009 cycle check.
- [ ] Every `capability` value in the backlog has a corresponding `docs/capabilities/NN-name.md`.
- [ ] A short "what hand-authoring got wrong" section is written into
      `docs/capabilities/01-ticket-system.md`, categorising the errors found and their counts. This
      is the honest record §7.5 asks for and it is the input to any future seeding.
- [ ] This ticket is closed with `/tickets close`, producing a `tickets(#0011): ...` commit — i.e.
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
   watch it exit 0 with no errors. Then read the warnings out loud — every one should be a warning
   you recognise and accepted on purpose.
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
