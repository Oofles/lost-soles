---
id: 271
slug: tickets-wave-runs-the-next-wave
title: /tickets wave <cap> — run a capability's next wave end to end
type: chore
priority: med
status: closed
size: s
capability: null
depends_on: []
blocked_by: []
source: operator
created: 2026-10-15T17:55:59Z
started: 2026-10-15T17:57:46Z
closed: 2026-10-15T17:57:46Z
---


## Description

The operator, after capability 13's second wave: *"I want to work on the next wave in a new context
session. Instead of me saying 'continue with wave 3' can we add that into the '/tickets'
functionality to do something like '/tickets wave 13'?"*

`/tickets waves` already plans a capability's waves, then stops to propose wave 1 and wait for a go.
A fresh session needs one command that runs the next ready wave, with the invocation as the go.

## Acceptance criteria

- [x] `tickets.mjs waves 13` resolves a bare capability number to the one capability whose slug
      starts with it. No match, or two matches, is refused by name. Tested.
- [x] `/tickets wave [cap]` is a routed action in `SKILL.md`. It runs the next ready wave end to end
      under `docs/capabilities/WAVES.md`. The invocation is the go, and every other stop in WAVES.md
      still applies (D-152 questions, gate failures, the batched perceptual checks).
- [x] Before spawning, the action checks for an undeclared dependency between tickets in the same
      wave, and stops to ask on a hit.
- [x] WAVES.md's §6 agent prompt tells agents to tick the criteria they satisfied.
- [x] One wave per invocation. The action ends by naming the next wave and does not roll on.

## Notes

- Lessons from capability 13's first two waves are written into the procedure. First, `waves`
  paired `0086` with `0187`, whose output `0086` builds from, because nothing declared the
  dependency. Second, wave 1's agents left every criterion unticked, so `close` refused until the
  orchestrator checked them.

## Operator validation

None: a tooling change. The first real test is the operator typing `/tickets wave 13` in a fresh
session.

**Done 2026-10-15 (agent).** `node --test .claude/skills/tickets/scripts/tickets.test.mjs`: 195
pass, 0 fail, including the new 0271 case. `tickets.mjs waves 13` prints capability 13's plan.
`check-skills.mjs`: all skills parse.

## Resolution

- `.claude/skills/tickets/scripts/tickets.mjs`: added `resolveCapability`, used by `waves`. It
  resolves `13`, or `8` for `08-…`, to the unique capability slug with that number, refuses none or
  two by name, and passes any other argument through. The usage line says so.
- `.claude/skills/tickets/scripts/tickets.test.mjs`: one CLI test covering resolve, none and
  ambiguous.
- `.claude/skills/tickets/SKILL.md`: a `wave` row in the routing table and a `## wave` section. The
  section covers planning, the undeclared-coupling check, when to read `DECISIONS.md`, spawning,
  merging, the gate, an untrusted-tick check, where it stops, and one wave per invocation. The
  description and argument hint now list `waves` and `wave`.
- `docs/capabilities/WAVES.md`: §1 names `/tickets wave <n>` as the exception to propose-and-wait
  and adds the coupling check. §6's prompt now has the tick-criteria rule.
- `CLAUDE.md`: the session protocol points at `/tickets wave <n>`.
- No decision is recorded: this is an entry point to the D-312 procedure, not a change to it.
