---
id: 148
slug: one-nul-byte-in-a-staged-file-silently-disables-the-pre-comm
title: One NUL byte in a staged file silently disables the pre-commit literal secret scan
type: bug
priority: high
status: open
size: s
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-09-02T14:48:30Z
---

## Description

**A single NUL byte anywhere in a staged file makes layer 2 of `.githooks/pre-commit` — the literal
credential-pattern scan — pass that file silently.** Not "report a problem": pass. The file is
scanned, nothing is found, the commit proceeds.

The mechanism is the pipeline in layer 2:

```sh
git show ":$f" | grep -vF 'gitleaks:allow' | grep -E -- "$p" >/dev/null
```

GNU grep switches to binary mode on input containing a NUL. In binary mode it does **not** write
matching lines to stdout — it writes `grep: (standard input): binary file matches` to stderr and
stops. So the FIRST grep emits nothing, the second grep reads an empty stream, and `PIPESTATUS[2]`
is 1: *no match*. The hook reads that as "this file is clean."

**This is D-176's exact failure class** — "I never ran" wearing "I ran and found nothing" — in the
one place the project has already been bitten by it. `0125` and `0137` both hardened this hook
against precisely this shape of bug; this is a third instance they did not reach.

**It is not theoretical, and layer 1 does not cover it.** Ticket `0018`'s Resolution records this
happening for real: 10,000 literal NUL bytes in a test fixture made that file read as binary, *"which
meant the pre-commit hook's literal-pattern scan was silently skipping it. Once the NULs became
escapes, the same scan immediately caught token-shaped fixtures inside that file which **gitleaks had
passed**."* So on that day, layer 1 passed and layer 2 was disabled — the belt and the braces were
both off, and nobody knew until the NULs were removed for an unrelated reason.

Found again on 2026-09-02 while building `0019`, where literal NULs were written into source **three
separate times** in one session. They are invisible at the point of writing, invisible in a diff, and
invisible to `grep` — which reports the whole file as binary and finds nothing.

## Steps to reproduce

```sh
python3 -c "open('f.txt','wb').write(b'AKIA' + b'3NPRZQ7XWFTKLMVD' + b'\nnul:\x00\n')"
cat f.txt | grep -vF 'gitleaks:allow' | grep -E -- 'AKIA[0-9A-Z]{16}' >/dev/null
echo "exit=${PIPESTATUS[2]}"     # 1  — the key is NOT detected
```

Remove the `\x00` and re-run: `exit=0`, detected. Verified 2026-09-02 on this machine.

## Expected vs actual

**Expected:** a staged file containing an `AKIA`-shaped key blocks the commit, whatever other
bytes the file contains. (Written as a shape rather than a literal: gitleaks blocked an
earlier draft of this very ticket for quoting one, which is layer 1 behaving correctly.)

**Actual:** the commit is allowed. The scan ran, found nothing, and reported success.

## Acceptance criteria

- [ ] A staged file containing both a NUL byte and a credential pattern **blocks the commit**.
- [ ] The fix is `grep -a` on **BOTH** stages of the layer-2 pipeline. Verified: `-a` on only the
      second grep still fails (`exit=1`), because the first grep is where the content is discarded.
      This is the trap — the one-character fix that looks correct and is not.
- [ ] `gitleaks:allow` still exempts its own line in a file that also contains a NUL. Verified
      working with `-a` on both stages; must not regress, or the security docs that quote credential
      patterns start blocking their own commits.
- [ ] `scripts/pre-commit-hook.test.mjs` gains a case for this, with the NUL written as an **escape**
      in the fixture. A test fixture that itself contains a literal NUL is the bug testing itself.
- [ ] The existing layer-2 tests still pass unchanged — this must not weaken detection on ordinary
      text files.
- [ ] Consider, and decide explicitly either way: whether the hook should **also** reject a staged
      text file containing a NUL outright. See Notes.

## Notes

**Two candidate fixes; they are not alternatives, and the second is the interesting one.**

1. **`grep -a` on both stages.** Makes the scan actually work on such a file. This is the fix, and
   it is verified. Necessary but arguably not sufficient — it makes the *scanner* correct while
   leaving the *file* wrong.
2. **Also refuse a NUL in a staged non-binary file.** Every occurrence so far has been an accident —
   an agent writing a control character into TypeScript where an escape belonged, three times in one
   session — and `capture-format.ts` already strips NULs from captured bodies for the same reason.
   A NUL in `.ts`/`.md`/`.mjs`/`.sh` has no legitimate use here, and rejecting it is a two-line
   check that also catches the *next* thing a binary-looking file silently breaks.

   The cost is that it needs a real binary allowlist (images, fonts, `.pmtiles` fixtures later), and
   a guard that fires on legitimate files is a guard someone disables — the same reasoning that
   earned `gitleaks:allow` its per-line exemption. **Decide it explicitly rather than letting it
   drift.** Recommendation: do (1) now since it is verified and strictly a fix, and treat (2) as a
   separate decision with its own `D-xxx` if taken.

**Why this is `high` and not `med`.** It is a security control that fails open, on an input this
project has produced accidentally at least four times, in a repo where GitHub push protection is
unavailable (`0019` Notes — it needs Advanced Security, which a private personal repo does not have).
Layer 2 is not a nice-to-have here; on the one recorded occasion it mattered, it was the layer that
was right and gitleaks that was wrong.

**Related:** `0125` (the hook had no test), `0137` (the hook failed open on a `git diff` error and
on a SIGPIPE'd `grep -q`), D-176.

## Operator validation

**None.** A shell guard with a self-contained reproduction and its own test harness; the repro above
plus a green `scripts/pre-commit-hook.test.mjs` is the evidence, and both are the agent's to run
(D-181). Nothing here has a screen.
