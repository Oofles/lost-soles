# Capability close audit

**A capability is not done when its tickets are closed. It is done when this audit passes.** (D-153)

Run it as the REFLECT step, before starting the next capability. It takes 20–40 minutes and it is
the only thing standing between a 19-capability build and architectural drift.

> **The governing rule:** if the implementation diverged from the design doc, **either the code
> changes or the doc changes — never neither.** Silent divergence *is* the drift. Every finding
> below resolves one way or the other, and nothing is left as "we'll remember."

---

## 1. Automated — must be green, no exceptions

- [ ] `tsc --noEmit`, ESLint, and the full `vitest` suite pass.
- [ ] **Invariant sweep**: every applicable invariant from `02-data-model.md` §9 (`I-1`…`I-30`)
      has a passing test. Any marked `[S]` (structural) is still structurally enforced, not
      downgraded to a test that could be deleted.
- [ ] **Boundary greps clean**: `grep -ri strava src/domain src/pipeline` returns nothing;
      no skill id string appears anywhere in `src/`; `normalize()` is still pure.
- [ ] **The Vigil test passes** — adding a workout type is still a YAML row and zero code (D-031,
      D-141). This is the canary for the whole modularity claim; if it ever needs a code change to
      pass, stop and fix the schema, do not amend the test.
- [ ] `/tickets validate` reports no errors across `open/` and `closed/`.

## 2. Design conformance — the manual half, and the part that actually catches drift

For each design-doc section this capability's tickets cited:

- [ ] Re-read the section. **List every place the implementation differs from it.**
- [ ] For each difference, choose explicitly and record which:
      - **the code was wrong** → file a `bug` ticket, or fix now if trivial; or
      - **the design was wrong** → amend the doc *in this commit*, record a new `D-xxx` in
        `DECISIONS.md` with the reasoning, and note which earlier decision it supersedes.
- [ ] Check the **canonical contract** (`docs/contracts/ingestion-contract.md`) is still accurate.
      If a type drifted, the contract is wrong or the code is — resolve it here, never later.
- [ ] Scan `DECISIONS.md` for any `D-xxx` this capability's work has quietly falsified. A decision
      contradicted by shipped code and left standing is the most expensive kind of drift, because
      the next session will trust it.

**Drift budget: three.** More than three divergences in one capability means the design is stale,
not that the code is sloppy. Stop shipping tickets and run a DESIGN session on the affected doc.

## 3. Operator validation — did it actually happen

- [ ] Every closed ticket has a real `## Operator validation` result — an operator's dated report,
      or **the agent's smoke test against real infrastructure** (D-181), not a restatement of the
      instruction and not "None" where something was observable.
- [ ] **The real-run requirement applies to `08-map-and-fog-renderer`, `09-xp-engine-and-ledger`
      and `12-post-run-moment`** — for those, the USE step means *you went for an actual run with
      this build on your phone*, and it is not a metaphor. It is **not** a blanket rule: a
      backend capability with no screen has no run to go for, and demanding one there is the
      ceremony D-181 removes.
- [ ] Anything that looked wrong but passed its tests is filed as a ticket, not tolerated.

## 4. Regression against earlier capabilities

- [ ] Did this capability change anything an earlier one depends on? If so, that earlier
      capability's validation is re-run — for a visual capability, at minimum load the map and
      import a run; for a backend one, re-run its smoke test.
- [ ] `explored-r10.bin` still regenerates and no cell has re-fogged (D-020, `I-7`).
- [ ] Total XP is unchanged or higher, never lower (D-135, `I-16`).

## 5. Cost and hygiene

- [ ] AWS spend still tracks the D-083 target (~$1–5/mo). Check the Billing console, not an
      estimate. A NAT Gateway appearing anywhere means something went badly wrong (D-081).
- [ ] No `blocked_by` left pointing at a closed ticket.
- [ ] Any scope discovered mid-capability was filed as a new ticket (`source: agent`), not absorbed
      silently (D-152).

## 6. Write the REFLECT section

In `docs/capabilities/NN-name.md`, record:

- What the design got wrong, and what it got right that was non-obvious.
- Divergences found above, and how each was resolved.
- Estimate vs. actual sessions, and what drove the difference.
- **What the next capability should do differently.** If nothing, say so — but say it deliberately.

Then commit, push, and clear context (D-151).
