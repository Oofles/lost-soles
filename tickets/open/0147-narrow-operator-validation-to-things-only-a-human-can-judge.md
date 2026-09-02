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

- [ ] **D-181 is recorded** and states the test explicitly: a criterion earns `(operator)` only if a
      human eye or hand is the *only* instrument that can answer it. Deployed-infrastructure facts,
      HTTP status codes, IAM/DynamoDB/GitHub state and anything reachable with AWS credentials or
      `curl` are the agent's job.
- [ ] **D-169's mechanism is explicitly preserved** — `(operator)` still blocks close, is still never
      the agent's to tick, and still requires a dated result on the criterion. Only the test for
      *earning the prefix* changes. Recorded as a narrowing, not a repeal.
- [ ] `.claude/skills/tickets/reference.md` and `SKILL.md` state the narrowed test, and the close
      procedure stops demanding "a screen and a device" for work that has neither.
- [ ] `docs/07-ticketsmith.md` §3.3.1 (normative) matches.
- [ ] `docs/capabilities/AUDIT.md` §3 keeps the real-run requirement for the capabilities where it
      is genuinely experiential — `08-map-and-fog-renderer`, `09-xp-engine-and-ledger`,
      `12-post-run-moment` — and drops it as a blanket rule elsewhere.
- [ ] `CLAUDE.md` reflects the change, including that the agent has AWS credentials and is expected
      to use them rather than route infrastructure questions to a human.
- [ ] **Every open ticket is swept.** Each `(operator)` criterion is either kept with a one-line
      reason it needs a human, or rewritten as an agent smoke test. The count before and after is
      reported.
- [ ] A ticket whose validation is genuinely "None" says so and says why, rather than inventing
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

## Operator validation

**(operator) Read D-181 and the amended `reference.md` and confirm the line is drawn where you want
it** — this is the one judgement in this ticket that is genuinely yours, since the whole point is to
match the process to how you want to spend your effort. Everything else here is text and tooling the
agent can check.
