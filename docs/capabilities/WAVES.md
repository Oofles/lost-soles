# Waves — building a capability's tickets in parallel

**D-312.** One agent per ticket, each in its own git worktree, a wave at a time. The main session
orchestrates: it plans, merges, pushes **once per wave**, runs the smoke tests, and brings the
operator one batch of perceptual checks. The Amplify build (~9 min) is paid per wave, not per
ticket, and each ticket gets a fresh context that holds only its own ticket and cited sections.

Everything in `CLAUDE.md`'s working agreement still holds. D-152 (ask before implementing what the
plan does not cover), D-229 (operator validation is for perception only), and the hard constraints
bind every agent exactly as they bind the main session.

---

## 1. Plan

```
node .claude/skills/tickets/scripts/tickets.mjs waves              # the capability next would pick
node .claude/skills/tickets/scripts/tickets.mjs waves <cap> --max 3
```

Wave 1 is ready now. Wave *k* becomes ready once waves 1..*k*-1 have merged. `held` says why a
ticket cannot be scheduled. Width defaults to 4, because merge cost grows with width: tickets in one
capability touch the same files (D-151). Capabilities `08`, `09` and `12` stay at width 1.

**Propose the wave to the operator and wait for a yes**, as for any session's batch. The exception
is **`/tickets wave <n>`** (ticket `0271`): typing it is the yes for that capability's next ready
wave, and the skill runs this whole procedure from it.

**Before spawning, read each ticket's Description and Notes for a dependency on another ticket in
the same wave that `depends_on` does not declare.** For example, one ticket says it "follows" or
"builds from" another. The script layers only what is declared. Capability 13's first wave paired
`0086` with `0187`, which was rewriting the section `0086` builds from. On a hit, add the
`depends_on` (after the operator agrees) and re-plan.

## 2. Before spawning

1. The main checkout is clean and level with `origin/main`.
2. At a capability's first wave, the orchestrator reads `DECISIONS.md` in full (D-151). Agents
   do not.
3. `tickets.mjs start <id>` for every ticket in the wave. Then commit and push those ticket
   changes: they are tickets-only, so they carry the skip token and cost no build (D-311).
   **Agents branch from HEAD at spawn time**, so anything they need must be committed first.
4. Spawn one agent per ticket, **all in one message**, each with `isolation: "worktree"` and the
   prompt in §6. The worktree lands at `.claude/worktrees/agent-<id>` on branch
   `worktree-agent-<id>`. It is gitignored, and neither `tsc` nor `vitest` sees it.

## 3. What an agent may and may not touch

Each agent works **only its own ticket**. Shared, append-only and generated files are the
orchestrator's, because parallel edits to them always conflict:

| An agent must not | Instead |
|---|---|
| edit `docs/decisions/DECISIONS.md` or allocate a `D-xxx` | propose it in the report as `D-NEW-a` |
| run `tickets.mjs create`, `start`, `close`, or allocate an id | propose new tickets in the report |
| edit `tickets/index.json` or `docs/INDEX.md` | leave them; the orchestrator regenerates both |
| edit any other ticket's file | mention it in the report |
| push, or touch `origin` at all | commit locally on its worktree branch |
| create, change or delete AWS resources | read-only AWS; post-deploy checks go in the report |
| ask the operator anything directly | stop and return the question (D-152) |

An agent **may** edit design docs its ticket requires, under the usual rule: a wrong doc is a
finding. Say so in the report.

## 4. Merge, push, validate (orchestrator)

1. **Read the reports, not the diffs.** `git show --stat <sha>` is enough unless something is off.
   A report with an open question waits: put it to the operator, then `SendMessage` the answer to
   that agent, which still holds its context.
2. **Cherry-pick each agent's commit onto `main`**, in the wave's printed order. History stays
   linear, one commit per ticket (D-150). On a conflict, resolve it if it is mechanical. Otherwise,
   `SendMessage` the agent to rebase onto the new `main` (`git rebase main` in its worktree) and
   report the new sha.
3. **Do the shared-file work in one commit:** the proposed `D-NEW` become real `D-xxx` (fix the
   references in the merged commits' text), proposed tickets are created, and
   `node scripts/build-index.mjs` and `tickets.mjs index` are run. Message: `wave <n>: decisions
   and indexes`.
4. **Run the full local gate on `main`:** `amplify.yml`'s guard scripts, typecheck, lint, the full
   suite, `npm run build` (~40 s). Per memory, run it on a clean tree.
5. **Push once.** One Amplify build.
6. **When it is green, run every ticket's smoke tests.** Either run the reported commands, or
   `SendMessage` each agent to run its own; they still hold the context. Then bring the operator
   **all** the wave's perceptual checks in one sitting, on the desktop browser (D-227).
7. **Close each ticket** (`tickets.mjs close`) with its `## Operator validation`. Close commits are
   tickets-only, so they push without a build.
8. **Clean up.** `git worktree remove` each agent worktree and delete its `worktree-agent-*`
   branch. These branches are local and short-lived, and are never pushed; the remote stays
   trunk-only.

**If the Amplify build fails,** fix it on `main` in the main session, or `SendMessage` the agent
whose change broke it. A failed build leaves the previous deployment live.

## 5. Context

The orchestrator holds plans, reports and decisions, never an agent's file reads. Clear between
waves when context passes ~50%. The handoff is the same as ever: each ticket's `## Resolution`,
plus this file. A wave of one is the old serial protocol, so nothing is lost by using it everywhere.

## 6. The agent prompt

Fill in the `<…>`s. Keep the rest verbatim: it is the contract in §3.

```
You are building ticket <NNNN> of the Lost Soles project, in your own git worktree, as one of
several agents working a wave in parallel. CLAUDE.md is loaded; its hard constraints and working
agreement bind you. docs/capabilities/WAVES.md §3 lists what you must not touch. Read it first.

Ticket: tickets/open/<NNNN-slug>.md. Read it in full, then ONLY the design sections it cites
(use docs/INDEX.md to find line ranges; never read a design doc end to end).

Setup, once, from your worktree root:
  export PATH="$(ls -d ~/.local/share/fnm/node-versions/v22*/installation/bin | head -1):$PATH"
  node scripts/worktree-prepare.mjs
If the sandbox refuses a compound git command, run each git command as its own call.

Rules:
- D-152: if the acceptance criteria do not settle a question, or the design looks wrong, STOP
  and return the question with the options you see. Do not choose and proceed. The orchestrator
  will relay the answer.
- Do not edit DECISIONS.md, tickets/index.json, docs/INDEX.md or any other ticket. Do not run
  tickets.mjs create/start/close. Do not push. AWS is read-only for you.
- Before committing, all of these must pass in your worktree: the guard scripts listed in
  amplify.yml's build phase, npm run typecheck, npm run lint, npx vitest run, npm run build.
- Tick each acceptance criterion you have actually satisfied (`- [x]`), and amend in place, with a
  reason, any you could not. Leave `(operator)` criteria unticked.
- Append a full `## Resolution` to your ticket (files touched, decisions made, why). Leave the
  ticket in tickets/open with status as it is; the orchestrator closes it after deploy.
- Make exactly ONE commit containing the code and the ticket file: `<NNNN>: <ticket title>`.
  Never type the bracketed Amplify skip token in a message (D-311).

Report, in this order and nothing else:
1. Commit sha and branch.
2. Files touched (one line each).
3. Verification: each check and its result.
4. Proposed decisions: D-NEW-a, D-NEW-b… with one paragraph each, or "none".
5. Proposed new tickets: title, type, priority, one-line why, or "none".
6. Post-deploy smoke test: the exact commands to run against the deployed app.
7. Perceptual checks for the operator (D-229's test: would two competent people disagree by
   looking?), or "none".
8. Open questions, or "none".
```
