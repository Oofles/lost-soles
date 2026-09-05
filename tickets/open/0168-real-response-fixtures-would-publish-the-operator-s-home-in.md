---
id: 168
slug: real-response-fixtures-would-publish-the-operator-s-home-in
title: Real-response fixtures would publish the operator's home in a public repo
type: bug
priority: high
status: open
size: s
capability: 05-strava-adapter
depends_on: []
blocked_by: []
source: agent
created: 2026-09-05T00:53:57Z
---

## Description

`github.com/Oofles/lost-soles` is a **public repository**. Ticket `0038` instructs:

> **Fixtures.** Capture **real** responses (**redacted of tokens, not of shape**) and commit them
> [...] Required set: 1. An outdoor run: detail + streams, **~2,700 `latlng` points**, with
> `original_size` intact.

"Redacted of tokens, not of shape" is explicit that the coordinates stay. Committing fixture 1
publishes ~2,700 GPS points of a real run by the only user of this system — which means the street
they start on, the street they finish on, and the route between. Fixture 7 (*"a trace containing a
real signal-loss jump — tunnel or urban canyon"*) has the same problem, and fixture 8 (a
DST-boundary activity) pins a date to a place.

**This is not a hypothetical exposure.** The connected account is a real person's, the traces are
their actual movements, and a public git repo is permanent, cloneable and indexed. `git rm` after
the fact does not help — the blob stays in history, and by then it has been fetched.

**Why the instruction reads reasonably and is still wrong.** `0038`'s reasoning is sound on its own
terms: contract §5 makes `normalize()` unit-testable from a checked-in fixture with zero mocking,
and after 2026 those responses may not be re-acquirable. Both are true. What the ticket never
considers is that the archive it is protecting against loss is exactly the data `08-security-privacy.md`
treats as the sensitive asset — and that this repo is the one place it must not go.

Note the asymmetry with the rest of the system: the raw archive lives in a private, versioned,
block-all-public-access S3 bucket with a delete-deny policy (§3.2), and the explored-cell set is
owner-scoped in AppSync. A fixture directory is the one place the same coordinates would be world
readable, and it is the one place nobody wrote a rule about.

Found while building `0035`, which needs a ~2,700-point stream fixture for its own criterion 5.
That ticket used a **synthetic** fixture and verified the real point count with a live smoke test
instead, which is the pattern this ticket should probably generalise.

## Acceptance criteria

- [ ] `0038`'s fixture instruction is amended: real responses are captured for **shape**, and any
      `latlng` payload committed to this repo is **spatially transformed**, not merely
      token-redacted.
- [ ] The chosen transformation preserves everything the tests actually assert — point COUNT,
      index alignment, equal stream lengths, the 1 Hz cadence, the signal-loss jump's magnitude,
      `original_size` — while placing the track somewhere that is not anywhere the operator has
      been. A fixed offset is NOT sufficient on its own: an offset track is still the operator's
      route shape, and a distinctive loop is identifying even when moved.
- [ ] A test or check asserts no committed fixture contains a coordinate within a generous radius
      of the operator's real activity area, so a future hand-added fixture cannot quietly reintroduce
      this.
- [ ] The decision is recorded as a `D-xxx`, because "real fixtures, synthetic geometry" is a
      standing rule for every adapter that follows, not a one-off for Strava.
- [ ] `docs/08-security-privacy.md` gains a line naming the repository as a place trace data must
      never go — the omission that made `0038` read as reasonable.

## Steps to reproduce

1. `gh api repos/Oofles/lost-soles --jq .visibility` → `public`.
2. Read `tickets/open/0038-*.md`, "Fixtures", required set item 1.

## Expected vs actual

**Expected:** committed test fixtures carry the *shape* of a real response and no real location.

**Actual:** as written, `0038` commits ~2,700 real GPS points of the operator's run to a public
repository, permanently.

## Notes

Three candidate transformations, for whoever picks this up:

1. **Capture real, then relocate and rotate** the whole track as a rigid body to open water or an
   uninhabited grid square. Preserves every metric property the tests assert; destroys the location.
   Rigid transform alone leaves the route SHAPE, which is why it is paired with relocation rather
   than offered instead of it.
2. **Synthesise from a real response's metadata** — take the real `original_size`, cadence and gap
   structure, generate coordinates along a synthetic path. Nothing real survives; slightly weaker as
   a "this is what Strava actually sends" artifact, which is the whole point of fixtures.
3. **Keep real fixtures out of git entirely** — private S3, fetched by CI. Strongest privacy,
   worst developer experience, and it breaks contract §5's "unit-testable with zero mocking".

(1) looks best: the fixtures stay real responses in every respect the code cares about.

**Do not treat this as blocking `0038` from starting** — it is a change to *how* fixtures are
captured, and the rate-limit backoff half of `0038` is untouched by it.

## Operator validation

**Operator judgement IS required here, unusually for this capability, and on one question only:**
whether the transformed fixture's geometry is acceptable to publish. Only the operator knows where
they actually run, so only they can say whether a relocated track still resembles a route they
recognise. Everything else — the count assertions, the alignment checks, the radius check — is a
script's job and belongs in a smoke test at close.
