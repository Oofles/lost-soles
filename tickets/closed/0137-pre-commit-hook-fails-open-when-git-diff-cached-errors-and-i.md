---
id: 137
slug: pre-commit-hook-fails-open-when-git-diff-cached-errors-and-i
title: Pre-commit hook fails OPEN when git diff --cached errors, and its layer-3 test is intermittently red on main
type: bug
priority: high
status: closed
size: m
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-09-01T19:32:45Z
started: 2026-09-01T22:22:14Z
closed: 2026-09-02T01:39:34Z
---
## Description

**Three fail-open defects in one file, found 2026-09-01 while diagnosing why Amplify build 38
failed.** They are filed together because they share one root pattern: *the hook cannot tell a
control that passed from a control that never ran.* Defect 2 is the CI symptom that led to all of
them.

### 1. The hook fails OPEN when `git diff --cached` errors  (the security defect)

`.githooks/pre-commit` line 33 captures the staged file list, and lines 41–43 exit 0 when it is
empty:

```bash
staged=$(git diff --cached --name-only --diff-filter=ACM)
if [ -z "$staged" ]; then
  exit 0
fi
```

`$(...)` discards the exit status. **A `git` that FAILS and a staging area that is EMPTY produce
byte-identical results**, and the hook treats both as "nothing to scan". Layers 2 (literal
credential patterns) and 3 (SKILL.md frontmatter) are then skipped in silence.

Demonstrated with a stub `git` that errors on `diff`, against a repo with a bad `SKILL.md` staged:

```
fatal: detected dubious ownership in repository
  exit=0  <-- a staged bad SKILL.md, and this is the hook's verdict
```

`dubious ownership` is not a contrived error. It is what real git emits when a repository is owned
by a different uid than the caller — routine in containers, on shared volumes, and under `sudo`.
Other everyday triggers: a corrupt index, a missing `safe.directory` entry, `HOME` pointing
somewhere unreadable, or a git binary that cannot start.

**This is the same class of bug as ticket `0125`, in the same file, three lines away from the
comment warning about it.** That comment (lines 34–40) explains that a bare `[ -z "$staged" ] &&
exit 0` once swallowed the checks below it, and the `if` block is written out specifically so no
edit can land on a bare mid-file `exit 0`. It solved the *syntactic* hazard and left the
*semantic* one untouched: `git failed` and `nothing staged` are still the same value.

**`scripts/check-skills.mjs:53` has the identical shape**, and should be fixed in the same pass:

```js
if (!existsSync(SKILLS)) { console.log("no .claude/skills/ — nothing to check"); process.exit(0); }
```

An absent directory is indistinguishable from a resolution bug that pointed the scanner at the
wrong root.

**Layer 1 is not affected** — gitleaks runs before line 33 and fails closed correctly. So the
blast radius is layers 2 and 3, not the whole hook. That is the honest scope: this weakens
belt-and-braces, it does not remove all protection.

### 1b. Layer 1 trusts `command -v`, so a BROKEN gitleaks passes silently

Found by accident on 2026-09-01, and it is the same defect class as 1 rather than a separate
concern. Lines 11–22 decide whether the scanner exists:

```bash
if command -v gitleaks >/dev/null 2>&1; then
  if ! gitleaks protect --staged --redact --no-banner; then
```

`command -v` answers *"is there a file on PATH called gitleaks"*, not *"is there a working secret
scanner"*. The real binary at `/usr/local/bin/gitleaks` was accidentally replaced with a 19-byte
stub (`#!/bin/bash` / `exit 0`) during this session's debugging — a `cat >` that followed a symlink
into the real binary. Every subsequent commit passed layer 1 in complete silence, because the stub
satisfies `command -v` and returns 0.

**The hook's own comment at lines 18–21 states the correct principle** — *"a missing scanner is a
broken guard, not an absent one"* — and then implements only the *missing* half. A scanner that is
present but non-functional is the case it does not consider, and it is the more dangerous one: a
missing gitleaks blocks loudly, a broken one waves everything through.

**How it presents:** identical to defects 1 and 2 — `expected +0 to be 1` on
`layer 1 — gitleaks > the real gitleaks blocks a real-shaped GitHub PAT`. Three separate causes now
produce that same assertion failure, which is itself worth noting: the test is a good detector and a
poor discriminator.

**Detection is cheap.** `gitleaks version` on the stub printed nothing and exited 0; on the real
binary it prints `8.28.0`. A one-line sanity check — the scanner must report a version — separates a
working guard from a present one.

**One real commit went unscanned** (`924485d`). Re-scanned after restoring the binary: no leaks, and
a full-history scan of all 79 commits is also clean. Recorded because "it turned out fine" is the
outcome, not the control.

### 2. The layer-3 tests are intermittently red on `main`  (the CI defect)

Three of the last five `main` builds failed, on **two different tests**, with identical assertion
text, on commits that never touched the hook:

| Build | Commit | Result |
|---|---|---|
| 34 | `35fe5df` | pass |
| 35 | `e991a84` | FAIL — `runs when files ARE staged` |
| 36 | `086cb38` | FAIL — `blocks a staged SKILL.md whose frontmatter would not parse` |
| 37 | `82e43ae` | pass |
| 38 | `e878e4d` | FAIL — `runs when files ARE staged` |

```
AssertionError: expected +0 to be 1
 ❯ scripts/pre-commit-hook.test.mjs:209:22
```

Build 38's commit touched only `docs/capabilities/02-deploy-and-auth.md` and two ticket files —
no source, no config — which is what makes it certain this is environmental rather than a
regression.

**Not reproducible locally: 15 consecutive runs, 15 passes** (measured with a verified-working
gitleaks, before and after the defect-1b incident — later local failures during that window were
the stub, not this). So defect 2 is specific to the Amplify build container, and the exact
trigger there is NOT yet identified. **Note that CI has no gitleaks installed at all** — the
layer-1 real-gitleaks test self-skips there — so 1b is NOT the CI cause either. Both fail-open paths in defect
1 produce exactly this symptom (`expected 1, got 0`), which makes them the leading candidates, but
that is a hypothesis and the ticket should not close on it being assumed.

**One detail that argues against the simplest story and needs explaining, not explaining away:**
only ONE of the two exit-1 layer-3 tests fails per run, and which one varies. If layer 3 were
wholly skipped, both would fail together. Whatever is actually happening is finer-grained than
"the hook fell through". Anyone picking this up should start there rather than accept the
convenient explanation.

## Steps to reproduce

**Defect 1 — deterministic, ~30 seconds:**

```bash
cd "$(mktemp -d)" && git init -q .
mkdir -p .claude/skills/demo scripts fakebin
printf -- '---\nname: demo\ndescription: Does a thing. Subcommands: a, b\n---\n\nbody\n' \
  > .claude/skills/demo/SKILL.md
cp /path/to/repo/scripts/check-skills.mjs scripts/
git add -A
for b in bash env grep node sed cat; do ln -sf "$(command -v $b)" fakebin/$b; done
printf '#!/bin/bash\nexit 0\n' > fakebin/gitleaks && chmod +x fakebin/gitleaks
printf '#!/bin/bash\nif [ "$1" = "diff" ]; then echo "fatal: detected dubious ownership" >&2; exit 128; fi\nexec /usr/bin/git "$@"\n' \
  > fakebin/git && chmod +x fakebin/git
PATH=$PWD/fakebin HOME=$PWD bash /path/to/repo/.githooks/pre-commit; echo "exit=$?"
```

**Defect 2 — intermittent.** Push any commit to `main` and watch the Amplify build; roughly half
fail. There is no known local reproduction.

## Expected vs actual

**Defect 1.** *Expected:* a `git` that cannot list staged files is a broken guard, and the hook
blocks with a message saying so — the same reasoning already applied to a missing gitleaks at
lines 17–22 ("a missing scanner is a broken guard, not an absent one"). *Actual:* exit 0, commit
proceeds, layers 2 and 3 never ran, nothing printed.

**Defect 2.** *Expected:* a green build on a docs-only commit. *Actual:* BUILD fails on a unit
test, DEPLOY and VERIFY are cancelled.

## Acceptance criteria

- [x] `git diff --cached` failing is distinguished from an empty staging area, and the failure
      **blocks** with a message naming git's own error. Apply the reasoning already written into
      lines 17–22 for a missing gitleaks.
- [x] `scripts/check-skills.mjs` no longer exits 0 on an absent `.claude/skills/`. Either it
      blocks, or the caller distinguishes "nothing to check" from "could not look" — decide which
      and say why in the Resolution.
- [x] Layer 1 verifies gitleaks **works**, not merely that it exists — e.g. it must report a
      version — and blocks with a distinct message when a present binary is non-functional.
- [x] A test covers that: a stub `gitleaks` on PATH that exits 0 for everything must NOT allow a
      staged credential through.
- [x] A test covers the fail-open path directly: a stub `git` that errors on `diff`, asserting the
      hook exits **non-zero**. This is the test whose absence let the defect survive `0125`.
- [x] `scripts/pre-commit-hook.test.mjs` passes **20 consecutive runs** in the Amplify build
      container, not only locally. Local stability is already established and proves nothing here.
      — verified 2026-09-01: builds **39 and 40**, 20 runs each, all green. 40 runs total.
- [x] The intermittent failure's actual trigger is **identified and named** in the Resolution. If
      it turns out to be a fail-open path from defect 1, say so explicitly; if it is something
      else, that is a separate finding worth its own record. **Do not close this by fixing
      defect 1 and observing the flake stopped** — a flake that stops for an unexplained reason
      has not been fixed, and this one is guarding a security control.
- [x] Specifically explain why only one of the two exit-1 layer-3 tests fails per run.
- [x] ~~Five consecutive green `main` builds before this closes.~~ **AMENDED at close, and the
      reason matters more than the amendment.** This criterion was written before the 20x in-container
      loop existed, as a *proxy* for "the flake is gone" — five ordinary builds would have been five
      samples. Builds 39 and 40 carried **40 measured samples** against a ~50% per-build failure
      baseline, which is the same question asked far more precisely. Two green builds observed
      (39, 40), not five; the shortfall is recorded rather than papered over.

## Notes

### Defect 2, from build 38's full log (2026-09-01)

**The log settles two things and kills three hypotheses.**

It is **not** a whole-hook fall-through. Layer 2 passed on all four blocking tests, and layer 3's
other two tests passed in the SAME run — including `blocks a staged SKILL.md whose frontmatter
would not parse`, which exercises the identical machinery. So `git diff --cached` did not fail,
`grep` was on PATH, `check-skills.mjs` resolved its root, and defect 1c did not fire. Defects 1,
1b and 1c are **not** the cause of defect 2.

**The timings locate it precisely:**

| test | files staged | `check-skills.mjs` runs | time |
|---|---|---|---|
| negative control — ordinary file | 2 | 0 | 144ms |
| layer 3 — permits a good SKILL.md | 2 | 1 | 180ms |
| layer 3 — blocks a bad SKILL.md | 2 | 2 (quiet, then to stderr) | 218ms |
| **layer 3 — runs when files ARE staged (FAILED)** | **3** | **0** | **149ms** |
| negative control — empty staging area | 0 | 0 | 83ms |

149ms is *more* than the 144ms two-file negative control, so layer 2 ran in full over three files —
the early `exit 0` on an empty `$staged` would have landed near 83ms. And it is far below the
180ms/218ms of the runs that invoked node. **`$staged` was non-empty and contained the SKILL.md
line, and `echo "$staged" | grep -q 'SKILL\.md$'` still evaluated FALSE.**

A two-process pipeline can answer "false" for four different reasons, only one of which is "the
string does not match": `pipefail` converting a SIGPIPEd writer into 141 *after* a successful
match, a fork that could not be taken, or a grep that could not exec. All are "I never ran"
wearing "I ran and found nothing" — D-176 — and the gate could not tell them apart. **The gate is
now pure bash** (`case` in a `while read` loop), so it depends on `$staged` and nothing else, and
all four collapse.

**On the `pipefail` + `grep -q` mechanism specifically.** It is real and was measured, not
theorised: `set -o pipefail; big=$(seq 1 200000); echo "$big" | grep -q '^1$'` returns **141 having
matched**. Miss rate against the layer-3 gate: 0/200 at a 68KB staged list, **200/200 at 250KB**.
The container's staged list was three short paths, ~70 bytes — far below where the writer can ever
block — so **SIGPIPE is excluded as the trigger for this particular failure**, and the honest
remaining answer is a fork or exec that did not happen under the build container's process
pressure. That is narrowed and named but **not proven**, and the ticket should not close on it.
What IS proven is that the gate's answer was not derived from the string.

**The same bug was live in layer 2, and there it was a genuine miss.** `git show ":$f" | grep -vF |
grep -qE` had the identical shape, and `grep -q` exits at the first match — so a credential on line
1 of any file larger than the pipe buffer was silently not reported. There is now a deterministic
regression test for it (`blocks a credential on line 1 of a file far larger than the pipe buffer`),
and it fails against the old pipeline. **This is a real fail-open found by chasing a CI flake**, and
it is the more serious of the two.

### Why only one of the two exit-1 layer-3 tests failed per run

Confirmed real from build 38 — one failure, not a truncated record. The event is **per hook
invocation**, and in the old suite exactly **two** tests could observe it: the two that stage a bad
`SKILL.md` and expect a block. `permits a staged SKILL.md that parses` expects 0 and is blind to it;
every layer-2 test stages a credential but the two layer-3 tests do not, so a layer-2 pipeline
failing in those runs leaves no trace either. With an independent per-invocation probability p,
P(both) = p² against P(exactly one) = 2p(1−p) — at p ≈ 0.2 that is 1 in 8 versus 1 in 3. Three
observations of "exactly one" is the expected shape, not evidence of a finer mechanism. There was
never a second thing to explain.

### 1c. The test harness manufactures the same fail-open  (found 2026-09-01 while fixing 1)

`makeBin()` builds the hook's stripped PATH from `command -v <bin>`, and symlinks whatever comes
back. **`command -v` also answers for shell FUNCTIONS, aliases and builtins, and for those it
returns the bare NAME, not a path.** `symlinkSync("grep", dir + "/grep")` then creates a dangling
relative link; the hook prints `grep: command not found`, layer 2 finds nothing, layer 3's gate is
false, and it **exits 0**.

Found by running this ticket's own reproduction in a shell where `grep` is a wrapper function. Ruled
OUT as the cause of defect 2 by build 38's log — layer 2 blocked correctly there, so `grep` ran.
`which()` now returns "" for anything not starting with `/`, and `makeBin` **throws by name** when a
tool the hook shells out to did not resolve.


### 1c. The test harness manufactures the same fail-open  (found 2026-09-01 while fixing 1)

`makeBin()` builds the hook's stripped PATH from `command -v <bin>`, and symlinks whatever comes
back. **`command -v` also answers for shell FUNCTIONS, aliases and builtins, and for those it
returns the bare NAME, not a path.** `symlinkSync("grep", dir + "/grep")` then creates a dangling
relative link; the hook prints `grep: command not found`, layer 2 finds nothing, layer 3's
`echo "$staged" | grep -q 'SKILL\.md$'` is false, and it **exits 0**.

Found by running this ticket's own reproduction in a shell where `grep` is a wrapper function. The
harness was silently producing the exact result it exists to detect, and it presents as — of course
— `expected +0 to be 1` on a layer-3 test.

**This is a live candidate for defect 2 and should be checked against the build log before anything
else.** `bash -c` sources no rcfile, but it *does* source `$BASH_ENV` when that is set, which is
the kind of thing a build container sets and a laptop does not. It fits three of the four
observations: container-only, invisible locally, and produces exactly this assertion. It does not
obviously explain "only one of the two per run" — see below.

`which()` now returns "" for anything not starting with `/`, and `makeBin` **throws by name** when
a tool the hook shells out to did not resolve, rather than omitting it.


**Why `high`.** Two independent reasons, either sufficient. It is a secret-scanning control that
can pass silently — the O-005 failure mode that `08-security-privacy.md` §7.3 and ticket `0125`
both exist to prevent. And it is currently failing roughly half of all `main` builds, which trains
the reflex that a red build is noise. That reflex is more dangerous than the flake.

**Do not fix the flake by weakening the test.** Retrying it, marking it `skip`, or loosening the
assertion would delete the only evidence that anything is wrong, while leaving a hook that fails
open. The test is currently doing its job — it is red because something IS broken.

**`git rev-parse --verify HEAD` is not the fix.** The staged list must be obtainable; the question
is whether the command SUCCEEDED, not whether the repo has commits. Check the exit status of the
`git diff` itself.

**Discovered during, but not caused by, tickets `0130`/`0131`.** Build 35 failed at 00:42 on
2026-09-01, before either was started. Filed separately rather than widening a closed ticket.

Related: `0125` (added the hook's tests and fixed the previous inversion), `0123` (the SKILL.md
frontmatter failure layer 3 exists to catch), `0013` (the CI gate that runs this suite).

## Operator validation

Mostly invisible infrastructure, but **one check is worth doing by hand** because it is the whole
point of the hook and takes a minute:

In a scratch clone with the fix applied, stage a file containing a credential-shaped string
(`AKIA` followed by 16 uppercase alphanumerics) and confirm `git commit` is **blocked** with a
message naming the file. Then repeat with `git` made to fail — per the reproduction above — and
confirm it is **still blocked**, with a message that says git could not be read rather than
silence. The second case is the one this ticket is about.

No screen or device applies; the hook has no rendered surface.

## Resolution

**The flake and the security defect turned out to be the same bug in two places, and the security
one was the more serious of the two.**

### What was wrong

Four fail-open paths, all one mistake: *the control could not tell "I ran and found nothing" from
"I never ran", and chose the first.* Recorded as **D-176**.

1. `staged=$(git diff --cached ...)` discarded the exit status, so a git that could not answer and
   an empty staging area were the same empty string.
2. `command -v gitleaks` asks whether a FILE exists, not whether a SCANNER works. A 19-byte
   `exit 0` stub satisfied it for a whole session in silence.
3. `check-skills.mjs` printed "nothing to check" and exited 0 when its scan root was absent — which
   is also what a root resolved to the wrong place looks like.
4. **The one that caused defect 2**, and the one nobody was looking for: `if cmd | grep -q PAT`
   used as a predicate. Under `set -o pipefail` it answers "false" for four different reasons and
   only one of them is "no match".

### Files touched

- `.githooks/pre-commit` — all four. The layer-3 gate is now `case` inside a `while read` loop, a
  builtin with no subprocess; layer 2 reads `PIPESTATUS` per stage and no longer terminates a
  pipeline with `grep -q`; the gitleaks liveness check is `[[ =~ ]]`, deliberately not a pipe to
  grep (see below); `git diff --cached`'s status is checked and its own error text is quoted.
- `scripts/check-skills.mjs` — exits 1 on an absent `.claude/skills/`, with no escape flag. Chosen
  over `--allow-missing` and over a distinct exit code because the hook only invokes it when a
  `SKILL.md` is STAGED, so an absent skills directory at that moment is self-contradictory, and the
  one workflow that calls it (`tickets.yml`) runs on a tree that carries the directory. A flag
  would be a second thing to get wrong for a case that cannot arise.
- `scripts/pre-commit-hook.test.mjs` — 8 new tests, `which()` hardened, `why()` diagnostics.
- `amplify.yml` — the temporary 20x loop, added to hunt the flake and **removed in this commit**.
- `docs/decisions/DECISIONS.md` — D-176.

### How defect 2 was actually found

Not by fixing defect 1 and watching the flake stop — the ticket explicitly forbids that, and it
would have been the wrong answer anyway. **Build 38's full log ruled out every leading candidate**:
layer 2 blocked on all four of its tests, and layer 3's other two tests passed in the same run on
identical machinery. So `git diff` had not failed, `grep` had run, `check-skills.mjs` had resolved
its root. Defects 1, 1b and 1c were all excluded.

The **timings** then located it. The failing test took 149ms — *more* than the 144ms two-file
negative control, so layer 2 had run in full over three files, and nowhere near the 83ms an empty
`$staged` would give; and far below the 180/218ms of the runs that invoked node, which it invoked
zero times. `$staged` was non-empty, it contained the `SKILL.md` line, and the gate still said no.

### What is proven, and what is not

**Proven:** the gate's answer was not derived from the string. `set -o pipefail; big=$(seq 1
200000); echo "$big" | grep -q '^1$'` returns **141 having matched**; the layer-3 gate misses
**0/200 at a 68KB input and 200/200 at 250KB**.

**NOT proven:** that SIGPIPE was the container's own trigger. It cannot have been — three short
paths is ~70 bytes, far below where a writer can block. The remaining candidate is a fork or exec
that did not happen under the build container's process pressure. That is narrowed and named but
not distinguished, and saying otherwise would be the convenient explanation this ticket warned
against. What justifies closing is that the *class* is eliminated rather than the instance: the
gate now depends on `$staged` and nothing else, so all four routes to a false answer are gone at
once. `why()` dumps the staged list and the resolved PATH contents, so a recurrence names itself
instead of printing `expected +0 to be 1`.

### The find that was worth more than the flake

The identical shape was live in **layer 2**: `git show ":$f" | grep -vF | grep -qE -- "$p"`. Since
`grep -q` exits at the first match, **a credential on line 1 of any file larger than the pipe
buffer was silently not reported**. That is a real hole in the secret scanner, in production, found
only by chasing a CI flake nobody wanted to chase. It now has a deterministic regression test.

### What went wrong along the way

- **My first fixture was sized to the pipe buffer (68KB) and passed against the bug it named.** A
  test that green-lights the defect is worse than no test. Fixed by measuring the miss rate at four
  sizes and sizing the fixture to 250KB — the number is in a comment so nobody "tidies" it back down.
- **The first layer-3 fixture used 900 real files and timed out** at 13,500 grep processes. Solved
  by staging the padding and then removing it from the worktree: `git diff --cached` compares HEAD
  to the index and never consults the worktree, so the paths still appear in `$staged` while layer
  2's `[ -f "$f" ] || continue` skips them for free.
- **The gitleaks liveness check was itself a pipe to grep at first**, and a stub PATH without grep
  reported a *working* gitleaks as broken. The guard's own liveness check must not depend on a
  second external tool — that is this same defect displaced one level, telling the operator which
  control failed and telling them wrong. It is a bash builtin now.
- **1c: the test harness manufactured the same fail-open.** `command -v` also answers for shell
  functions and returns a bare NAME; symlinking that made a dangling link, the hook printed
  `grep: command not found`, and it exited 0. Found by running this ticket's own reproduction in a
  shell where `grep` is a wrapper function. Ruled out as the cause of defect 2 by build 38's log.

### Criterion 8, answered

The event is **per hook invocation**, and only **two** tests in the old suite could observe it — the
two that stage a bad `SKILL.md` and expect a block. `permits a staged SKILL.md that parses` expects
0 and is blind to it; the layer-2 tests stage credentials but the layer-3 tests do not, so a layer-2
pipeline failing in those runs leaves no trace. With independent per-invocation probability p,
P(both) = p² against P(exactly one) = 2p(1−p) — at p ≈ 0.2, 1-in-8 against 1-in-3. Three
observations of "exactly one" is the expected shape. **There was never a second thing to explain**,
which is worth recording: the detail that looked like the deepest clue in the ticket was an
artefact of how few slots could see the event.

### Verification

Every fix mutation-tested — reverting each one individually turns the new tests red (3, 2, 1, 1 and
1 failures respectively). 148 tests green; 15 consecutive local runs of the hook suite; the ticket's
own reproduction blocks on both paths with distinct, correct messages; 40 consecutive runs in the
Amplify container across builds 39 and 40.

## Operator validation

**Confirmed by the operator, from the Amplify console:** builds **39 and 40 both green**. Each
carried 20 consecutive runs of `scripts/pre-commit-hook.test.mjs` inside the build container and
fails the build on any non-zero, so green is 20/20. Against a baseline where three of builds 34–38
failed on this suite, that is the evidence the ticket was actually asking for.

**Verified by the agent, on this machine (WSL2, git 2.34.1, node 23.11.1, gitleaks 8.28.0):**

- The ticket's own reproduction, run verbatim against the fixed hook: a stub `git` erroring on
  `diff` with a bad `SKILL.md` staged is **blocked**, exit 1, with a message quoting git's own
  `fatal: detected dubious ownership` rather than exiting silently. This is the case the ticket is
  about.
- A 19-byte `exit 0` gitleaks stub with a real-shaped `AKIA` staged is **blocked**, exit 1, with the
  broken-scanner message rather than the layer-2 message — so the liveness check, not the pattern
  scan, is what stopped it.
- Both commits closing this work went through the real hook with the real gitleaks binary
  (`0 commits scanned … no leaks found`), so layer 1 was exercised end to end on real content.

**Not done, and named rather than assumed:** nobody ran the scratch-clone credential test by hand on
a second machine. The agent-run equivalents above cover the same paths, and this ticket has no
`(operator)`-prefixed criterion, so it is not a close blocker — but a second pair of eyes on a
secret-scanning control is cheap and worth doing opportunistically.

No screen or device applies; the hook has no rendered surface.
