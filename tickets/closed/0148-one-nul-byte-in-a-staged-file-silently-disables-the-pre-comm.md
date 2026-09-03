---
id: 148
slug: one-nul-byte-in-a-staged-file-silently-disables-the-pre-comm
title: One NUL byte in a staged file silently disables the pre-commit literal secret scan
type: bug
priority: high
status: closed
size: s
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-09-02T14:48:30Z
started: 2026-09-03T01:26:20Z
closed: 2026-09-03T01:33:31Z
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

- [x] A staged file containing both a NUL byte and a credential pattern **blocks the commit**.
- [x] The fix is `grep -a` on **BOTH** stages of the layer-2 pipeline. Verified: `-a` on only the
      second grep still fails (`exit=1`), because the first grep is where the content is discarded.
      This is the trap — the one-character fix that looks correct and is not.
- [x] `gitleaks:allow` still exempts its own line in a file that also contains a NUL. Verified
      working with `-a` on both stages; must not regress, or the security docs that quote credential
      patterns start blocking their own commits.
- [x] `scripts/pre-commit-hook.test.mjs` gains a case for this, with the NUL written as an **escape**
      in the fixture. A test fixture that itself contains a literal NUL is the bug testing itself.
- [x] The existing layer-2 tests still pass unchanged — this must not weaken detection on ordinary
      text files.
- [x] Consider, and decide explicitly either way: whether the hook should **also** reject a staged
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

**Validation, as scoped when this was filed:** none by the operator. A shell guard with a
self-contained reproduction and its own test harness; the repro above plus a green
`scripts/pre-commit-hook.test.mjs` is the evidence, and both are the agent's to run (D-181).
Nothing here has a screen. Carried out as written — see `## Operator validation` below.

---

## Resolution

**`grep -a` on both stages of the layer-2 pipeline**, in `.githooks/pre-commit:130`, plus four
tests in `scripts/pre-commit-hook.test.mjs`. The diagnosis in the ticket was correct in every
particular, including that the plausible one-character fix is the wrong one.

### Files touched

- **`.githooks/pre-commit`** — `grep -a -vF … | grep -a -E …`, with an 18-line comment recording
  the measured exit-status table, because the deceptive fix is the one a future tidy-up would
  reach for.
- **`scripts/pre-commit-hook.test.mjs`** — a new `describe("a NUL byte cannot blind the literal
  scan (0148)")` with four cases. The NUL is written `"\u0000"`; no literal NUL enters this repo.

### The reproduction, and a wrong measurement on the way to it

First attempt reproduced the bug but **measured the wrong `grep`**. This shell has a Claude Code
`grep` *function* on it that routes to ugrep with `-I` (skip binary files); the hook runs under
plain bash and gets GNU grep 3.7. The two disagree, and one variant read backwards under ugrep.
Re-ran everything against `/usr/bin/grep` in `env -i`. The harness had already been bitten by this
once — `which()` in the test file carries a comment about `grep` being a function — which is why
the test suite resolves its tools through `command -v` and was never affected.

Against real GNU grep 3.7, with an `AKIA`-shaped key in a file containing one NUL:

| pipeline | `PIPESTATUS[2]` | |
|---|---|---|
| `-a` on neither | 1 | **the bug** — key not detected, hook reports clean |
| `-a` on second only | 1 | **the trap** — still not detected |
| `-a` on first only | 0 | detected, but see below |
| `-a` on **both** | 0 | the fix |

The first grep is where the content is destroyed, exactly as the ticket said.

### A test that could never fail, written and deleted

The first draft included a fifth test asserting the hook's stderr stays clean of grep's
`binary file matches` warning, on the reasoning that it would discriminate *`-a` on first only*
from *`-a` on both*. **It passed against all three broken variants.** GNU grep suppresses that
diagnostic when stdout is `/dev/null`, which is precisely how the hook invokes it, so the message
never existed to assert on. It was a permanently green check inside the one ticket about controls
that pass without running — deleted, and the structural test's comment now records why no
behavioural test can reach that distinction.

That is also why the fourth test asserts the pipeline **as text**. `-a` on the first grep alone
already yields the right exit status, so behaviour alone cannot stop a future edit from dropping
the second `-a`. Verified by patching the hook to each of the three broken shapes and re-running:

| hook variant | behavioural test | structural test |
|---|---|---|
| no `-a` | **fails** | **fails** |
| `-a` on second only | **fails** | **fails** |
| `-a` on first only | passes | **fails** |
| `-a` on both | passes | passes |

The other two cases — the `gitleaks:allow` exemption surviving inside a NUL file, and an innocent
NUL file still committing — pass in every variant by design. They are regression guards for
criteria 3 and 5, not discriminators, and their job is to fail if the fix is ever bought by
over-blocking.

One more self-inflicted detour worth recording: the first variant-matrix script patched the hook
with a regex and sent its own errors to `/dev/null`. The patch failed, the failure was invisible,
and all four variants reported failing tests — including the correct one. A harness that hides its
own errors produced a result indistinguishable from a broken fix, which is this ticket's subject
matter arriving one level up. Rewritten with a literal string replace and an assertion on the
anchor count.

### Criterion 6 — decided: the scanner is fixed, the NUL is not banned

**Decision: do (1), do not do (2).** Taken with the operator before implementation.

Rejecting NULs in staged text files outright would catch the *cause* rather than this symptom, and
every occurrence so far has been an accident. It was declined for now because it needs a real
binary allowlist — images, fonts, `.pmtiles` fixtures later — and a guard that fires on legitimate
files is a guard someone disables, which is the reasoning that earned `gitleaks:allow` its
per-line exemption in the first place. Bundling a new guard into a bug fix would also have widened
the ticket (D-152).

**No `D-xxx` was recorded**, per the ticket's own framing — "treat (2) as a separate decision with
its own `D-xxx` **if taken**". Nothing about the architecture changed; the scanner now does what it
always claimed to. This paragraph is the durable record that the alternative was considered and
declined, and on what grounds.

## Operator validation

**None, and the ticket said so — correctly.** This is a shell guard with a self-contained
reproduction and its own test harness; nothing here has a screen (D-181). All of it was mine to
run, and was run:

- **The reproduction, before the fix**, against `/usr/bin/grep` (GNU grep 3.7) in a clean
  `env -i` shell: an `AKIA`-shaped key in a NUL-bearing file yields `PIPESTATUS[2]=1` — not
  detected. The same file without the NUL yields `0`.
- **The fix, through the real hook.** `runHook` stages files in a throwaway git repo and executes
  `.githooks/pre-commit` as git would; the NUL-plus-credential file now exits 1 with
  `matches a known credential pattern` and names the file.
- **All three broken variants fail the new tests**, matrix above — so the tests are known to
  discriminate, not merely known to be green.
- **`scripts/pre-commit-hook.test.mjs`: 29 passed, 1 skipped** (the skip is the real-gitleaks case,
  which ran — 30 tests, up from 26).
- **Full project suite: 288 passed, 1 skipped, 17 files.** No existing test changed.
- **`bash -n .githooks/pre-commit`** clean, and this ticket's own commit passes through the
  repaired hook.

