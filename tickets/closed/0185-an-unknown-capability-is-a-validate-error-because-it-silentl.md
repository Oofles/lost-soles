---
id: 185
slug: an-unknown-capability-is-a-validate-error-because-it-silentl
title: An unknown capability is a validate error, because it silently gates every ticket above it
type: bug
priority: high
status: closed
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-08T19:46:47Z
closed: 2026-09-08T19:47:40Z
---

## Description

Found while trying to run `audit 00-foundations` at the operator's request. **There is no such
capability, and one ticket saying there was had gated 18 for four days.**

`auditBlockers()` builds its list of blocking capabilities from **ticket frontmatter**:

```js
const lower = [...new Set(tickets.map((t) => t.fm?.capability).filter(...))]
return lower.filter((c) => !["pass", "forced"].includes(latestAuditRecord(c)?.verdict));
```

Not from `docs/capabilities/`. So any value in a `capability:` field is treated as a real
capability that must record a passing audit before anything above it can start. A typo therefore
invents a phantom capability which:

- sorts below the real ones, so it gates broadly;
- has no doc, so `audit <name>` refuses it outright — *"no capability 'x'. These exist: …"*;
- can therefore **never** record a verdict, so the gate it creates is permanent.

`0181` carried `capability: 00-foundations`. Every other foundational ticket uses
`00-preflight-and-repo`, which has a passing record. `00-foundations` appears in no roadmap, no
doc, and no other ticket.

**The signal existed and was the wrong volume.** `validate` had a `missing-capability-doc`
**warning**, printed at the tail of every run alongside stale-inbox notices, and reported as
`0 error(s), 1 warning(s)`. A condition that hard-blocks 18 tickets must not be indistinguishable
from a note that an inbox item is a fortnight old — and a `0 errors` line is read as "clean".

## Steps to reproduce

```
node .claude/skills/tickets/scripts/tickets.mjs next
#   18 higher-priority ticket(s) are gated on capability '00-foundations' —
#   its audit has not passed.
node .claude/skills/tickets/scripts/tickets.mjs audit 00-foundations
#   no capability '00-foundations'. These exist: …          <-- and it never can
node .claude/skills/tickets/scripts/tickets.mjs validate
#   0 error(s), 1 warning(s)                                <-- the only signal
```

## Expected vs actual

**Expected:** a `capability:` naming no doc fails `validate`, with a message saying what it costs,
so it is caught at the moment it is written rather than the moment somebody wonders why the
backlog stopped moving.

**Actual:** a warning, and a permanent gate on every ticket in capability >= 02.

## Acceptance criteria

- [x] A ticket whose `capability` has no `docs/capabilities/<name>.md` is a validate **ERROR**.
- [x] The message says what it costs — that the capability can never pass an audit and gates
      every ticket above it — not merely that a file is missing.
- [x] `capability: null` remains legal and unflagged: "no home yet" is not a typo.
- [x] `tickets.test.mjs` covers it, and proves the gate is real by showing a phantom capability
      gating a ticket and one word lifting it.
- [x] `0181` is moved to the capability it actually belongs to, and `validate` is clean.

## Notes

**This is the fourth detector in this session reporting something other than the truth**, after
`vigil-test` (matched a filename), `invariant-sweep` (matched any `I-n` in any test file, `0161`)
and the two `AUDIT.md` §4 rows (match nothing at all, `0184`). This one is different in kind and
worth separating: the others were checks that could not see: this one **saw the problem and said
it quietly**. The `04` REFLECT's line — *a green-looking row is worse than a red one because
nobody reads it twice* — extends to severity, not just to wording.

Deliberately NOT done here: making `auditBlockers` read `docs/capabilities/` instead of ticket
frontmatter. It would fix the phantom differently — by ignoring it — and ignoring an unknown
capability is how the ticket would have gone unnoticed instead of being caught. Frontmatter is the
right source; the fix is that a bad value cannot survive `validate`.

## Resolution

**Files touched**

- `.claude/skills/tickets/scripts/tickets.mjs` — `missing-capability-doc` (warning) becomes
  `unknown-capability` (error), with a message naming the consequence. The comment records why:
  `auditBlockers` reads frontmatter, so a bad value is not cosmetic.
- `.claude/skills/tickets/scripts/tickets.test.mjs` — three tests, and the shared `repo()` fixture
  now writes `docs/capabilities/00-x.md`. That fixture change was forced and is the interesting
  part: four existing tests failed the moment the rule tightened, all because the fixture repo had
  been building tickets in a capability with no doc — **the same defect as `0181`, sitting in the
  test harness the whole time.** Fixed in the fixture rather than by softening the rule.
- `tickets/open/0181-…md` — `capability: 00-foundations` → `02-deploy-and-auth`, with a dated note
  explaining what the wrong value cost.

**The rule was renamed, not just re-levelled.** `missing-capability-doc` describes a missing file;
`unknown-capability` describes the actual fault. The old name is why the warning read as a
documentation chore rather than a broken reference.

**Considered and rejected: making `auditBlockers` read `docs/capabilities/` instead.** It removes
the phantom by ignoring any capability it does not recognise — which means a typo would silently
detach a ticket from the gate entirely, and nobody would find out at all. Frontmatter is the right
source of truth; the fix is that a bad value cannot survive `validate`.

**Where 0181 went, and the honest cost.** `02-deploy-and-auth` on the merits — Cognito user pool
clients, `amplify_outputs.json`, the CloudFormation auth stack. That capability already has a
recorded audit (`forced`, 2026-09-05), so a re-audit of `02` will now fail
`capability-tickets-closed` until `0181` closes. That is correct: the capability does have open
work, and the alternative — filing a Cognito bug under repo scaffolding to keep a table green — is
the dishonesty this system exists to prevent.

## Operator validation

**None required — agent-verified** (D-181). Ticket tooling, no rendered surface, nothing deployed.
Run on this machine, 2026-09-08:

- `node --test tickets.test.mjs` — **139 tests, 139 pass** (136 before; 3 added, 4 pre-existing
  fixed by the fixture change).
- **The gate was shown to be real, not theorised.** Before: `next` reported *"18 higher-priority
  ticket(s) are gated on capability '00-foundations'"* and `audit 00-foundations` refused with
  *"no capability '00-foundations'"*. After correcting one field: the gate names
  `07-fog-projection-and-cells` — a real capability with real tickets and no audit record, which
  is D-153 working as designed — and 16 tickets remain gated on something that can actually be
  unblocked.
- **The new error fires, and on the right input.** A fixture ticket with `capability:
  00-foundations` exits non-zero with `unknown-capability`; `capability: null` still exits 0.
- `tickets.mjs validate` — **0 errors, 0 warnings**, down from 1 warning that had been standing
  long enough to read as furniture.
