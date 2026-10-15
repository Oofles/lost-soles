---
id: 269
slug: wave-workflow
title: Wave workflow: tickets.mjs waves, worktree-prepare, and the parallel-agent protocol
type: chore
priority: high
status: closed
size: m
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: operator
created: 2026-10-15T15:45:03Z
started: 2026-10-15T15:45:15Z
closed: 2026-10-15T15:47:35Z
---

## Description

The operator asked (2026-10-15) for tickets inside a capability to be worked in parallel by agents,
so context stays controlled and the Amplify build wait (~9 min a push) is paid once per batch
instead of once per ticket. `0214` cut the docs-only builds first. This ticket adds the parallel
half: D-312.

## Acceptance criteria

- [x] `tickets.mjs waves [<capability>] [--max N] [--json]` layers a capability's open tickets by
      `depends_on` into waves, splits a wide wave in priority order, keeps D-151's overrun-risk
      capabilities at width 1, and lists what it holds back and why. Tested.
- [x] `scripts/worktree-prepare.mjs` makes a fresh agent worktree runnable. Proven by running
      typecheck, lint, the full suite, the guard scripts and `next build` inside one.
- [x] `docs/capabilities/WAVES.md` is the protocol: who does what, what an agent may not touch
      (shared files, id allocation, pushes), the agent prompt, and the merge/push/validate order.
- [x] D-312 records the change to D-150/D-151. CLAUDE.md's session protocol points at it.

## Notes

Piloted on capability `13` wave 1 in a later session. Related: D-150, D-151, D-152, D-311, `0214`.

## Resolution

**D-312: waves of parallel agents, one worktree each. The procedure is
`docs/capabilities/WAVES.md`.**

- **`tickets.mjs waves [<cap>] [--max N] [--json]`** (`planWaves`, exported). It reuses
  `openInCapability` and `auditBlockers`. It layers by in-capability `depends_on`, treats any
  closed dependency as met, splits a wide layer by priority then id (default width 4), and pins
  `08`/`09`/`12` to width 1 (D-151). It holds `blocked_by`, an unclosed dependency outside the
  capability, `size: l`, anything depending on a held ticket, and cycles, each with its reason.
  With no capability it plans the one `next` would hand out from. 6 new `node:test` cases (194/194).
  Live: capability `13` plans as wave 1 = `0086 0187 0249`, wave 2 = `0087 0088 0089 0090`.
- **`scripts/worktree-prepare.mjs`** hard-links `node_modules` (`cp -al`, ~7 s), copies
  `amplify_outputs.json`, and runs the maplibre prebuild. It refuses to run in the main checkout.
  **A symlinked `node_modules` was tried first and fails:** the CDK bundler in every
  `amplify/*.test.ts` resolves the real path and throws `PathNotUnderRoot`.
- **Proven in a real worktree** (`.claude/worktrees/probe`, since removed): typecheck, lint, all 9
  guard scripts, the full suite (191 files, 3,433 tests) and `next build` (40 s) all pass. A probe
  agent with `isolation: "worktree"` confirmed where the Agent tool puts a worktree
  (`.claude/worktrees/agent-<id>`, branch `worktree-agent-<id>`, cut from HEAD). It also confirmed
  that `AWS_PROFILE` and the absolute `core.hooksPath` are inherited, and that its sandbox may refuse
  a compound git command (the prompt says to split them). With a worktree present, the main
  checkout's `tsc --listFilesOnly` and `vitest list` include none of its files, and its guards and
  lint stay green. No `tsconfig` change was needed.
- **The contract keeps agents off shared files:** `DECISIONS.md`, id allocation,
  `tickets/index.json` and `docs/INDEX.md`. They propose `D-NEW-x` decisions and new tickets
  instead. Parallel appends are guaranteed conflicts, and colliding ids break the never-renumber
  rule.
- **`CLAUDE.md`'s session protocol now points at WAVES.md, and so does the `/tickets` routing
  table.**
- **Found along the way, not changed:** `create --body` is the Description only. Passing full
  sections duplicates them, which `validate` catches. That was my misuse twice today; WAVES.md's
  agents do not run `create`.

## Operator validation

None needed: tooling, nothing on screen. Agent-checked 2026-10-15: `worktree-prepare` in a real
worktree, with the full gate and `next build` passing there (see Resolution); `waves` on the live
backlog for capability `13`. The real proof is the first wave, the capability `13` pilot.
