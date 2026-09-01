---
id: 137
slug: pre-commit-hook-fails-open-when-git-diff-cached-errors-and-i
title: Pre-commit hook fails OPEN when git diff --cached errors, and its layer-3 test is intermittently red on main
type: bug
priority: high
status: open
size: m
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-09-01T19:32:45Z
---
## Description

**Two defects in one file, found 2026-09-01 while diagnosing why Amplify build 38 failed.** They
are filed together because the second is how the first stayed invisible.

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

**Not reproducible locally: 15 consecutive runs, 15 passes.** So it is specific to the Amplify
build container, and the exact trigger there is NOT yet identified. Both fail-open paths in defect
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

- [ ] `git diff --cached` failing is distinguished from an empty staging area, and the failure
      **blocks** with a message naming git's own error. Apply the reasoning already written into
      lines 17–22 for a missing gitleaks.
- [ ] `scripts/check-skills.mjs` no longer exits 0 on an absent `.claude/skills/`. Either it
      blocks, or the caller distinguishes "nothing to check" from "could not look" — decide which
      and say why in the Resolution.
- [ ] A test covers the fail-open path directly: a stub `git` that errors on `diff`, asserting the
      hook exits **non-zero**. This is the test whose absence let the defect survive `0125`.
- [ ] `scripts/pre-commit-hook.test.mjs` passes **20 consecutive runs** in the Amplify build
      container, not only locally. Local stability is already established and proves nothing here.
- [ ] The intermittent failure's actual trigger is **identified and named** in the Resolution. If
      it turns out to be a fail-open path from defect 1, say so explicitly; if it is something
      else, that is a separate finding worth its own record. **Do not close this by fixing
      defect 1 and observing the flake stopped** — a flake that stops for an unexplained reason
      has not been fixed, and this one is guarding a security control.
- [ ] Specifically explain why only one of the two exit-1 layer-3 tests fails per run.
- [ ] Five consecutive green `main` builds before this closes.

## Notes

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
