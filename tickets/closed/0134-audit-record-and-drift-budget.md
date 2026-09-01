---
id: 134
slug: audit-record-and-drift-budget
title: The audit record: a parseable result block, the explicit divergence list, and the drift budget
type: feature
priority: high
status: closed
size: m
capability: 01-ticket-system
depends_on: [133]
blocked_by: []
source: agent
created: 2026-09-01T04:18:14Z
started: 2026-09-01T04:29:05Z
closed: 2026-09-01T04:35:31Z
---

## Description

Split out of [`0121`](0121-tickets-audit-subcommand.md). `0133` makes the mechanical checks runnable;
this ticket makes an audit a **recorded result** rather than a command someone ran once, and adds the
judgemental half's enforcement.

The audit result appends to `docs/capabilities/NN-name.md` in a block the script can parse back out,
because `0135` has to answer "has capability `01` passed its audit?" without a human in the loop.

## Acceptance criteria

- [x] An audit writes a timestamped, **machine-parseable** result block to
      `docs/capabilities/NN-name.md`, and the script can read it back. The format is recorded as a
      `D-xxx` — it becomes load-bearing for `0135`, so it is a decision, not an implementation detail.
- [x] The skill drives `AUDIT.md` §2 and §3 interactively: it lists the design sections this
      capability's tickets cited, and **requires an explicit divergence list. An empty list must be
      asserted, never assumed by omission.**
- [x] Each divergence is resolved as `code-was-wrong` (files a ticket) or `design-was-wrong` (amends
      the doc and records a `D-xxx`). **Neither is not an allowed outcome** — the audit exits
      non-zero while any divergence is unresolved.
- [x] **The drift budget is enforced**: more than three divergences fails the audit and prints the
      instruction to run a DESIGN session rather than continue.
- [x] A capability's REFLECT section must be non-empty before the audit passes.
- [x] `--force` overrides a failing audit **and records the override, with its reason, in the
      capability doc.** Skipping is visible, not impossible.

## Notes

The existing hand-run audits in `00-preflight-and-repo.md` and `01-ticket-system.md` are the format's
first readers — whatever block shape is chosen has to sit alongside them without making them look
malformed, or `0121`'s retroactive run turns into a rewrite of both documents.

## Operator validation

Delete the REFLECT section from a scratch copy of a capability doc and confirm the audit fails
naming it; restore it and confirm it passes. Then assert an empty divergence list explicitly and
confirm that is accepted, while omitting the list entirely is not.

## Resolution

**`.claude/skills/tickets/scripts/tickets.mjs`** — `audit` gains two modes beside the bare run:

- **`--sections`** — the §2 reading list: every design-doc section this capability's tickets cite.
  Mechanical work in service of the judgemental half. For `01-ticket-system` it produces
  `07-ticketsmith.md §2.1, §2.3, §3.2, §3.3, §3.3.1, §4.1, §4.2, §4.3, §4.6, §4.7, §7.5, §7.5.1`
  plus `02-data-model.md §9`, `08-security-privacy.md §7.1` and `09-roadmap.md §3, §4.1` — which
  matches the list capability `01`'s hand-run audit assembled by reading, plus what this session
  added.
- **`--record`** — writes the result, refusing until it has earned it.

**The record format is `D-172`**: a human-readable write-up followed by one
`<!-- audit-record {json} -->` line. `0135` must answer "did capability N pass?" with no human in
the loop, and parsing prose for a gating answer is how the record starts lying. Append-only — a
re-audit adds a line, the last stands.

**Four refusals, each tested, each writing nothing:**

| Refusal | Why it is not advisory |
|---|---|
| no divergence assertion | a §2 that found nothing and a §2 that never ran produce identical silence |
| a divergence with no resolution or no ref | AUDIT.md allows no third option; unreferenced *is* "we'll remember" |
| more than three divergences | the design is stale, not the code — run a DESIGN session |
| REFLECT still a placeholder | see below |

**`--force` records `verdict: forced`, never `pass`**, with the reason in the doc, and a bare
`--force` with no reason is refused. A forced audit recording as a pass would be worse than no
audit, because it would satisfy `0135`'s gate.

### The REFLECT check nearly passed everything

The obvious implementation — does `## Reflection` exist — would have passed **every capability from
the day its doc was created**, because the template ships the heading already present holding
`_Filled in at the REFLECT step, after USE._`. Found by running the check against capability `02`,
which has exactly that. So the check strips italic placeholder lines and requires real substance,
and it accepts any heading depth: capability `00` keeps its real reflection at `### §6 Reflection`
inside its hand-run audit while its `## Reflection` at the end of the file is still the stub. A
depth-fixed or heading-only check would have got capability `00` exactly wrong in both directions.

That is the third time in this chain that the honest-looking implementation silently passes
everything — D-169's pre-ticked criterion, D-171's `n/a`, and now this. It is the same bug each
time: **an absence and a negative result rendering identically.**

### The flag parser changed

`--divergence` is passed once per finding, and repeated flags previously overwrote. Repeats now
accumulate into a list. Every other flag in the script is passed once, so nothing else changes
behaviour.

### A test of mine went stale, correctly

`0133`'s test asserting the table footer names ticket `0134` failed the moment `0134` existed. The
test was right that the footer must say a green table is not a passed audit; naming a ticket number
in output that outlives the ticket was the stale part. The footer now names the commands and the
`AUDIT.md` sections, and the test asserts those. Recorded rather than quietly rewritten, because a
test edited to make a build pass is the failure this chain is about.

**Tests** — 10 new cases (93 total, was 83): omission refused; `--no-divergences` recorded and
labelled as an assertion; both flags together refused rather than guessed at; three bad divergence
shapes; three pass and a fourth fails naming the DESIGN session; the placeholder REFLECT; a REFLECT
at `### §6` depth accepted; `--force` bare refused and with a reason recording `forced`;
append-only across two audits; and `--sections` excluding both ticket filenames (`0121-…md` reads as
`21-…md` from the middle) and capability docs, which share the naming scheme exactly.

**Docs** — `07-ticketsmith.md` §4.3 gains the `--sections` and `--record` rows (normative),
`reference.md` gains the full contract, and `SKILL.md` gains a seven-step `## audit` procedure that
drives §2 and §3 and hands off to `--record`. `D-172` in `DECISIONS.md`.

**Not done here:** `next` refusing across a capability boundary is `0135`; the retroactive audits of
capabilities `00` and `01` are `0121`. No audit record was written to any real capability doc by
this ticket — the write path was exercised against a scratch copy, deliberately, so that `0121`
performs those runs rather than this one doing it by side effect.

## Operator validation — 2026-09-01

Ran on the laptop against the real repo, all of which are refusals that write nothing:

- `audit 01-ticket-system --record` → refused, "an empty list must be asserted, never assumed by
  omission". ✔
- `... --record --no-divergences` → refused, naming the failing mechanical checks. ✔
- `... --record --divergence "we-will-remember|x|y"` → refused, naming the two allowed resolutions. ✔
- `... --record --no-divergences --force` → refused, "--force needs a reason". ✔
- `git status` clean after all four. ✔

The write path was exercised against a **scratch copy** of `tickets/` and `docs/` in the session
scratchpad: capability `02` refused on its placeholder REFLECT, and capability `00` recorded a
`verdict: pass` with two divergences, producing a readable write-up plus a parseable record line.
Done in scratch on purpose — writing an audit record into a real capability doc is `0121`'s job, and
doing it here as a side effect would have pre-empted the retroactive run that ticket exists for.

`audit 01-ticket-system --sections` was read by eye against capability `01`'s hand-assembled list
and agrees with it.

No `(operator)` criterion. The one genuinely human judgement in this ticket — whether each `n/a`
reason and each refusal message actually *reads* usefully — is in the ticket text above for you to
disagree with, not asserted as checked.
