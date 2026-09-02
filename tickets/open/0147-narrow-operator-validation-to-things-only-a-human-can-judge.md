---
id: 147
slug: narrow-operator-validation-to-things-only-a-human-can-judge
title: Narrow operator validation to things only a human can judge
type: chore
priority: high
status: open
size: m
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: operator
created: 2026-09-02T13:54:36Z
---

## Description

**The operator's words, 2026-09-02:** *"We have been working on this app for a while now and I've
barely got a functional web page — the additional tickets that keep getting added on are all backend
validation and double/triple checking things that are extremely low risk of causing issues."*
And: *"If you can do a smoke test, I'm willing to accept the risk that the production system will
work. Operator validation should encompass design functions and things that you legitimately need my
manual effort on."*

Recorded as **D-181**, which narrows **D-169** rather than repealing it.

**The diagnosis matters more than the complaint.** Operator validation did not grow because anyone
decided backend correctness needed a human. It grew because the agent had **no AWS credentials**, so
every infrastructure question — "did the table deploy", "did the IAM grant attach", "does the rate
limiter refuse at the cap" — had exactly one available answer: *ask the operator*. Ticket `0019` is
the clean example. It shipped with four manual steps; once the operator supplied
`--profile devault`, the agent ran all four itself in about ninety seconds, and two of them proved
things no unit test could have (a real conditional-expression refusal at the cap, and GitHub's
actual `422 "sha" wasn't supplied`).

So this is not lowering a safety bar. It is removing a workaround for a constraint that no longer
exists, and pointing the remaining human effort at the thing it is genuinely irreplaceable for:
**whether the app looks and feels right on a phone.**

## Acceptance criteria

- [x] **D-181 is recorded** and states the test explicitly: a criterion earns `(operator)` only if a
      human eye or hand is the *only* instrument that can answer it. Deployed-infrastructure facts,
      HTTP status codes, IAM/DynamoDB/GitHub state and anything reachable with AWS credentials or
      `curl` are the agent's job.
- [x] **D-169's mechanism is explicitly preserved** — `(operator)` still blocks close, is still never
      the agent's to tick, and still requires a dated result on the criterion. Only the test for
      *earning the prefix* changes. Recorded as a narrowing, not a repeal.
- [x] `.claude/skills/tickets/reference.md` and `SKILL.md` state the narrowed test, and the close
      procedure stops demanding "a screen and a device" for work that has neither.
- [x] `docs/07-ticketsmith.md` §3.3.1 (normative) matches.
- [x] `docs/capabilities/AUDIT.md` §3 keeps the real-run requirement for the capabilities where it
      is genuinely experiential — `08-map-and-fog-renderer`, `09-xp-engine-and-ledger`,
      `12-post-run-moment` — and drops it as a blanket rule elsewhere.
- [x] `CLAUDE.md` reflects the change, including that the agent has AWS credentials and is expected
      to use them rather than route infrastructure questions to a human.
- [x] **Every open ticket is swept.** Each `(operator)` criterion is either kept with a one-line
      reason it needs a human, or rewritten as an agent smoke test. The count before and after is
      reported.
- [x] A ticket whose validation is genuinely "None" says so and says why, rather than inventing
      ceremony to fill the section. `0126` and `0127` already set this precedent.

## Notes

**What must NOT be lost.** Two things earned their place and should survive the sweep:

1. **`0018`'s browser POST.** It was the only evidence that the deployed SSR compute role worked,
   because reaching the handler needed a Cognito session. Note that even this is now partly
   agent-reachable — the agent can verify the role, the policy and the SSM read directly; what it
   still cannot do is hold a **production** Cognito session, since a second production account fires
   `08-security-privacy.md` §2.4 Trigger A and `0130` exists precisely so troubleshooting does not
   need one.
2. **Anything visual.** Fog legibility (D-051), the post-run moment, the plinth, map performance on
   a real phone over real cell data. No smoke test substitutes for looking at it.

**The likely failure mode of this change** is over-correction: an agent that stops verifying at all
because it is no longer required to write a manual step. D-181 should be explicit that the
verification burden does not decrease — it **moves**, from the operator's hands to the agent's, and
the evidence still gets written down. A ticket that closes with neither an operator check nor a
smoke test is worse than what we have now.

## Resolution

**The measurement changed the shape of the job, and it is the most useful thing here.** The
assumption was that `(operator)` criteria had proliferated. They had not — **zero** of the 108 open
tickets carried one. D-169's blocking mechanism was never the problem and is untouched. The entire
burden lived in `## Operator validation` **prose**, written at ticket-authoring time, months before
anyone would read it.

That also explains why it felt relentless: nobody was adding blocking gates, so nobody noticed the
instructions accumulating.

**Documents amended** — `docs/07-ticketsmith.md` §3.3.1 (the earns-the-prefix table) and §3.5,
`docs/capabilities/AUDIT.md` §3 and §4, `.claude/skills/tickets/reference.md`,
`.claude/skills/tickets/SKILL.md`, `CLAUDE.md`, `docs/decisions/DECISIONS.md` (D-181).

### The sweep: 56 swept, 51 deliberately left alone

Applied per **ticket**, not per capability, because several backend capabilities contain one
genuinely visual ticket — the OAuth consent screen (`0032`), the manual-sync button (`0043`), the
push notification (`0096`), the offline and accessibility passes (`0112`, `0113`) — and a blanket
per-capability rule would have stripped exactly the checks worth keeping.

Swept: `01` ×4, `02` ×2, `03` ×2, `04` ×6, `05` ×6, `06` ×5, `07` ×7, `09` ×8, `14` ×5, `16` ×5,
`18` ×5, plus `0138`.

Left alone: every ticket in `08-map-and-fog-renderer` (×10), `10-add-workout` (×5),
`11-skills-panel` (×5), `12-post-run-moment` (×8), `13-home-plinth-and-chronicle` (×5),
`15-two-map-modes` (×5), `17-tickets-ui` (×5), plus the eight visual exceptions above. **That is the
point of the exercise, not an omission.** The operator's complaint was *"I've barely got a functional
web page"* — the fix is to stop spending their attention on DynamoDB rows so there is some left for
the screens, not to stop looking at the screens.

### Why a banner rather than rewriting 56 sections

Each swept section keeps its original text under a directive block that re-points **who** performs
it. Two reasons, and the second is the stronger:

1. Rewriting 56 sections of prose the agent did not author, months before the work, is a large
   change with a real chance of quietly dropping something.
2. **Several of those sections contain genuine insight that a rewrite would flatten.** `0095` asks
   the operator to disable the webhook, go for a run, and *see the run fail to appear* — "worth
   seeing once with your own eyes so you know what a silent drop looks like." That is not ceremony
   and no smoke test replaces it. The banner leaves it standing while removing the console-poking
   around it.

The banner is a triage instruction to the session that works the ticket, at the moment it has the
context to judge — which is the only moment the judgement can actually be made.

### What this does NOT do, stated so it is not discovered later

- **It does not sweep closed tickets.** Their validation already happened; rewriting the record of
  what someone did would be falsifying history.
- **It does not touch `tickets.mjs`.** No code change was needed — the refusals are D-169's and
  they stand. This was a documentation and judgement change throughout.
- **It leaves the banner as prose, not a machine check.** Nothing enforces that a swept ticket
  actually gets triaged at close; that relies on the session reading it. A stricter mechanism was
  considered and rejected as the same over-engineering this ticket exists to undo.


## Operator validation

**(operator) Read D-181 and confirm the line is drawn where you want it**
— **verified 2026-09-02: passed.** The operator: *"I read through D-181 and I'm good with that
decision."*

This was the one judgement in this ticket that was genuinely theirs, since the whole point is to
match the process to how they want to spend their effort. Everything else was text and tooling the
agent checked itself — which is, appropriately, exactly the split D-181 now mandates.

Nothing else is required here. This ticket changed documentation, a skill, and the
`## Operator validation` section of 56 open tickets; `validate` reports 0 errors across all
folders, `check-skills.mjs` passes, and the 243-test suite is green. No deployed behaviour
changed, so there is nothing to smoke test.
