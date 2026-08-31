---
id: 125
slug: pre-commit-hook-has-no-test
title: The pre-commit hook has no test — a silent edit disabled a layer
type: bug
priority: high
status: open
size: s
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T02:59:59Z
started: 2026-08-31T21:04:12Z
---

## Description

The `.githooks/pre-commit` hook is the layer that makes an accidental `git add .` survivable, and it
is the direct remediation of O-005. **It has no test.** A scripted edit on 2026-08-31 inserted a new
check after the first `exit 0` — which was the `[ -z "$staged" ] && exit 0` early return — leaving
the entire literal-pattern scan as unreachable dead code. Commit `30438db` was made with that layer
off, and **nothing surfaced it.** It was found by reading the diff afterwards.

Nothing was smuggled in (gitleaks runs before that point and was unaffected; a full-history scan and
a manual sweep of that commit are clean). The point is that it *could* have been, and the failure
mode was total silence.

Every other guard in this project is tested. This one — the one whose whole job is to catch a
mistake made in a hurry — is the one that is not.

## Acceptance criteria

- [x] A test harness runs `.githooks/pre-commit` against a temporary git repo, per layer.
- [x] One test per layer, each proving it **blocks**: gitleaks (real PAT), literal patterns (PEM
      header, slack token, AWS key id), skill frontmatter (unparseable `SKILL.md`).
- [x] A negative control proves an ordinary file still commits — a hook that blocks everything is as
      broken as one that blocks nothing, and fails less visibly.
- [x] A test proves `gitleaks:allow` exempts a line, and that it exempts **only that line**.
- [x] A structural test asserts there is **exactly one** `exit 0` reachable at the end and no
      unreachable code after an early exit — the specific defect that caused this ticket.
      *NOTE:* included, but it is deliberately **not** the proof. Reachability is established
      behaviourally — stage a PEM header, assert the hook blocks — per this ticket's own warning
      about the 0008 `--force` lesson. The structural check is a cheap extra that names the risk for
      the next person editing the file.
- [x] `bash -n .githooks/pre-commit` runs in CI.
- [x] The suite runs in CI on every push.

## Steps to reproduce

1. Edit `.githooks/pre-commit` with a script that replaces the first occurrence of `exit 0`.
2. Observe that `[ -z "$staged" ] && exit 0` is the first occurrence, not the final one.
3. Commit a file containing `-----BEGIN RSA PRIVATE KEY-----`. It succeeds. <!-- gitleaks:allow -->

## Expected vs actual

**Expected:** any edit that disables a scanning layer fails a test.
**Actual:** the layer became dead code and every commit still reported success. The hook printed its
gitleaks banner as usual, so it looked like it was working.

## Notes

Test the hook by invoking it as git does — stage a file, run the hook, check the exit code — rather
than by grepping its source. The `--force` lesson from 0008 applies: a textual test on a script
whose own error messages quote the patterns it looks for passes for the wrong reasons.

## Operator validation

Break the hook on purpose: comment out the `gitleaks protect` call, run the suite, and confirm it
fails and names the layer. Restore it.

## Resolution

**The hook was still broken when this ticket was picked up — and worse than the ticket described.**
The report named one defect; there were two, from the same scripted edit.

```bash
staged=$(git diff --cached --name-only --diff-filter=ACM)
[ -z "$staged" ] && # ── 3. skill frontmatter ───...
if echo "$staged" | grep -q 'SKILL\.md$'; then   # ← ran ONLY when nothing was staged
...
exit 0                                            # ← layer 2 unreachable below this
```

The edit replaced the **first** `exit 0` in the file, which was the `[ -z "$staged" ] && exit 0`
early return. That left the `&&` dangling onto the next command, so the skill-frontmatter check
(layer 3) became conditional on the staging area being **empty** — exactly inverted — and the hard
`exit 0` orphaned the literal-pattern scan (layer 2) entirely. Confirmed live before touching
anything: a staged `-----BEGIN RSA PRIVATE KEY-----` returned **exit 0**. <!-- gitleaks:allow -->

So for some days the hook ran gitleaks and nothing else, while printing its usual banner. Every
commit in the session that closed this ticket went through it in that state.

**Files touched**

- `.githooks/pre-commit` — both defects repaired, layers restored to 1→2→3 order. The early return
  is now an explicit `if` block rather than `[ -z "$staged" ] && exit 0`, specifically so there is no
  bare mid-file `exit 0` for a future scripted edit to land on, and so the early return cannot
  silently absorb whatever is added after it. The reasoning is written in the file, next to the line.
- `scripts/pre-commit-hook.test.mjs` — new, 18 cases.
- `.github/workflows/gate.yml` — `bash -n .githooks/pre-commit`.

**How the tests work, and why that shape**

They invoke the hook **the way git does** — stage real files in a real temporary repository, run the
script, check the exit code — rather than grepping its source. This ticket's own note called for
that, citing 0008: a textual test on a script whose error messages quote the patterns it searches for
passes for the wrong reasons.

The load-bearing decision is **controlling `gitleaks` rather than depending on it.** Each test builds
a temp `bin/` holding symlinks to only what the hook shells out to, and sets `PATH` to just that.
`gitleaks` is then whatever the test wants: a stub exiting 1 (proves the hook honours a block), a
stub exiting 0 (makes layers 2 and 3 testable at all), absent (proves the fail-closed path), or the
real binary (proves detection, when installed). Without this, "fails closed when gitleaks is missing"
would be untestable on a developer laptop and every layer-2 test would be untestable in CI, which
does not install gitleaks — and **a suite that silently skips its own layers is the failure mode this
ticket exists to prevent.** When the real binary is absent, that is recorded as a visibly skipped
case rather than quietly omitted.

**Proved capable of failing, twice, against real breakage rather than a fixture**

| What was broken | Result |
|---|---|
| The original hook, restored verbatim from git | **8 failures** — layer 2 (all three patterns), layer 3's inversion, the `gitleaks:allow` scoping case, and the structural check. Layer 1 and both negative controls correctly stayed green, because those genuinely still worked |
| `gitleaks protect` replaced with `if false` | **2 failures**, both naming layer 1 |
| The repaired hook | 17 passed, 1 skipped |

That first row is the one that matters: the suite was checked against the actual historical defect,
not a synthetic one, and it discriminates — it fails the layers that were dead and passes the layers
that were alive.

**Two things found while building it**

1. **`execFileSync("bash", ...)` cannot work with a stripped `PATH`.** Node resolves the binary
   against the `PATH` being passed in, so bash failed to spawn and every test reported `status: null`
   before the hook ran a line. Resolved once to an absolute path.
2. **`bash -lc` was a real hazard, caught before it shipped.** A login shell sources the profile,
   which can *replace* `PATH` — in CI that would discard the node `actions/setup-node` installed, so
   `which("node")` would return empty and layer 3 would be skipped for a purely environmental reason.
   Changed to `bash -c`. This is the same class as the gitleaks-availability problem: a test that
   quietly does less in CI than it does locally.

**On `bash -n` in CI.** Added because the ticket asks and it is nearly free, but recorded honestly in
the workflow comment: **it would not have caught this defect.** The broken hook was syntactically
valid throughout. Only the behavioural tests found it.

## Operator validation

- **The hook's layers were verified live, not inferred.** Before the fix, a staged PEM header
  committed with exit 0. After, staged `-----BEGIN RSA PRIVATE KEY-----`, `xoxb-…` and `AKIA…` each <!-- gitleaks:allow -->
  return exit 1 and name the offending file; an ordinary source file returns exit 0.
- **Both break-tests in this ticket's own validation section were performed** — the original hook
  restored from git (8 failures) and `gitleaks protect` disabled (2 failures naming layer 1) — then
  the hook restored and the suite re-run clean. Results tabulated above.
- **The full gate passes locally**, including `npm test` (which carries this suite to both CI
  surfaces) and the new `bash -n` step.
- **Real-gitleaks case ran** on this machine (gitleaks 8.x present) and blocked a real-shaped
  GitHub PAT.

**No device-specific check.** This is genuinely invisible infrastructure — a git hook has no screen.
The nearest thing to a visual confirmation is that the commit closing this ticket was itself blocked
or permitted by the repaired hook, which is stated rather than shown.

**Worth an operator's eye, once:** stage a file containing a fake AWS key id and run
`git commit` for real, to see the block in your own terminal rather than in a test harness. Then
`git reset`. Seeing a guard fire once is worth more than reading that it passed.

## Postscript — the hook blocked this ticket's own commit

The repaired hook refused the commit that closed this ticket:

```
COMMIT BLOCKED: staged content matches a known credential pattern:
  scripts/pre-commit-hook.test.mjs  matches  -----BEGIN [A-Z ]*PRIVATE KEY-----
  tickets/open/0125-pre-commit-hook-has-no-test.md  matches  -----BEGIN [A-Z ]*PRIVATE KEY-----
```

Four lines, all of them **prose quoting the pattern in order to document it** — the header comment
of the test file and three lines of this ticket describing what the broken hook let through. Exactly
the case the hook's own comment anticipates: *"this project's security docs necessarily quote
credential patterns in order to document them, and a scanner that cannot tell documentation from a
secret gets disabled by whoever it blocks at 11pm."*

Resolved the designed way — a `gitleaks:allow` marker on each line, visible in the diff where a
reviewer sees it — and **not** by weakening the pattern, adding a path exclusion, or reaching for
`--no-verify`. The suite already had a test asserting the marker exempts only its own line; that
behaviour is now also load-bearing in practice.

Worth recording for a second reason: one of those four lines was committed in an **earlier** session,
when layer 2 was dead code. The hook is only now seeing it. That is a small, concrete measure of how
long the layer was off.
