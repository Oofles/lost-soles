---
id: 132
slug: bundle-leak-ssm-path-and-error-truncation
title: check-bundle-leak: SSM read asks for /amplify recursively and truncates its own error
type: bug
priority: high
status: closed
size: s
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T20:26:26Z
started: 2026-08-31T20:33:17Z
closed: 2026-08-31T20:53:57Z
---

## Description

`scripts/check-bundle-leak.mjs` (ticket 0017) failed the first `main` deploy that ran it — Amplify
build 15, commit `f54efb1`. It failed **closed**, which is the designed behaviour, but for reasons
that are defects in the script rather than a real leak.

**Three problems, in descending order of importance.**

1. **The SSM read asks for far more than it needs.** `fromSsm()` calls
   `aws ssm get-parameters-by-path --path /amplify --recursive`, which requires
   `ssm:GetParametersByPath` across **every Amplify app in the account**. The Amplify build role is
   scoped narrower than that. It passed locally only because `cli-user` holds broad SSM read, so the
   over-broad request was invisible until it ran under a least-privilege principal — the same class
   of gap `check-auth-posture.mjs` hit in 0014, and it should have been anticipated from that.
2. **The script truncates its own error to 80 characters**, on the one code path where diagnosis
   matters most:
   `ssm unavailable (Command failed: aws ssm get-parameters-by-path --path /amplify --recursive --wit`
   That cut lands before any AWS error text, so `AccessDenied` and "aws: command not found" are
   indistinguishable from the build log. The failure message must name the cause.
3. **The branch secret path recorded in the capability doc is wrong.** Build 15's log shows Amplify
   reading `{"Path":"/amplify/d14fhvl4rp79nn/main/","WithDecryption":true}` — the layout is
   `/amplify/<app-id>/<branch>/<KEY>`. `01-architecture.md` §7 and
   `docs/capabilities/02-deploy-and-auth.md` both state `/amplify/<app-id>/<branch>-branch-<hash>/`,
   which is the `resource_reference` path — a different thing entirely, holding deploy outputs rather
   than secrets. Under D-153 either the code or the doc must change; here the doc is wrong.

**Independent of all three:** the `main` branch secrets are not set (`ampx` has no branch-secret
command; they are set in the Amplify console). So even with the SSM read fixed, this build would have
resolved zero literals and failed anyway. Both must be done before build 15 can go green — do not
treat a fix here as sufficient on its own.

**Not affected:** the backend deploy succeeded, `secret-smoke-test-lambda` reached `CREATE_COMPLETE`
on `main`, and build 14 is still serving the live site.

## Steps to reproduce

1. Push any commit to `main` with `node scripts/check-bundle-leak.mjs --require-literals` in
   `amplify.yml`'s frontend build phase.
2. Read the BUILD step log of the resulting Amplify job.

## Expected vs actual

**Expected:** the check reads the branch's secrets from `/amplify/<app-id>/<branch>/`, scans the
built output against them, and passes. If it cannot read them, it says exactly why.

**Actual:** the read is denied, the reason is cut off mid-word at 80 characters, and the build fails
with no way to tell an IAM denial from a missing binary. Verified in Amplify job 15,
`2026-08-31T20:25:12.601Z`.

## Acceptance criteria

- [x] `fromSsm()` requests only the paths it needs: `/amplify/<app-id>/<branch>/` and
      `/amplify/shared/<app-id>/` when `AWS_APP_ID` is present, falling back to a broader path only
      when it is not. A failure on one path does not abandon the others.
- [x] The failure message carries the **full** underlying error, so an IAM denial, a missing `aws`
      binary and an empty result are each distinguishable from the build log alone. Truncation, if
      any, keeps the AWS error text rather than the command line.
- [x] The IAM permission the Amplify build role actually needs is stated in
      `docs/capabilities/02-deploy-and-auth.md`, next to the `check-auth-posture.mjs` grant that is
      already recorded there, with the resource ARN scoped to this app.
      *AMENDED — the premise was wrong.* **No IAM grant was needed and none was added.** This
      criterion assumed an AccessDenied; the actual cause was `--no-cli-pager`, a v2-only flag
      rejected by the AWS CLI **v1** in the Amplify container. The capability doc now records that,
      and explicitly says no grant was required — leaving the original wording ticked as written
      would have planted a false claim about the build role's permissions in the one document
      someone would consult before editing them.
- [x] The `/amplify/<app-id>/<branch>/<KEY>` layout is corrected in both
      `docs/capabilities/02-deploy-and-auth.md` and `01-architecture.md` §7, with a note that
      `/amplify/resource_reference/...` is a different path holding deploy outputs, not secrets.
- [x] An Amplify build on `main` runs the check to a **pass**, with the branch secrets set, and the
      log line naming which literals were scanned is quoted in the capability doc.
- [x] The check still fails closed when it genuinely cannot read SSM — proven, not assumed.

## Notes

Do not soften `--require-literals` to make this pass. Failing closed is the correct behaviour and is
the whole reason the deploy path is the lock rather than the alarm (D-163); the bug is that it fails
closed *uninformatively* and asks for more permission than it needs.

## Operator validation

In the Amplify console on the desktop, open the `main` build log for the commit that closes this and
confirm the leak-check step names the literals it scanned and passes. Then, in the same console,
temporarily remove one branch secret and redeploy: the build must go red with a message that says
plainly which key could not be read and why.

## Resolution

**The reported bug was real. The diagnosis in the ticket body was wrong, and the ticket's own
criterion 2 is what corrected it.**

**Files touched**

- `scripts/check-bundle-leak.mjs` — `ssmPaths()` reads `/amplify/<app-id>/<branch>/` and
  `/amplify/shared/<app-id>/` when `AWS_APP_ID` is present, falling back to `/amplify` on a
  developer machine where the project segment is not derivable. Each path is attempted
  independently, so one failure does not abandon the rest. `awsError()` returns the AWS error text
  rather than the command line, and names `ENOENT` as a missing CLI. Each resolved key now prints
  its **origin path**. The fail-closed message lists every path tried, verbatim.
- `docs/01-architecture.md` §7 and `docs/capabilities/02-deploy-and-auth.md` — the secret path
  corrected to `/amplify/<app-id>/<branch>/<KEY>`, with the sandbox layout and the OS-user naming
  written down.

**What actually happened, in order**

1. **Two builds were spent on a wrong hypothesis.** 0017 truncated the SSM error to 80 characters
   and the cut landed one word before the answer. "Over-broad path denied by IAM" was plausible,
   matched a known prior failure (0014's posture check), and was **wrong**.
2. **The real cause, visible the moment the error was printed in full:**
   `Unknown options: --no-cli-pager`. The Amplify build container ships **AWS CLI v1**; that flag is
   v2-only. It was cosmetic — v2 pages only on a TTY and CI has none — so it was removed. Every other
   flag in the call is common to both versions. **No IAM change was needed and none was made.**
3. **Build 17 went green while the read was still broken.** Amplify injects branch and shared secrets
   into the build environment, and the `process.env` fallback caught them, so `--require-literals`
   was satisfied and the scan was genuine — but by the fallback, not as designed. The per-key origin
   line (`from env` versus a parameter path) is the only reason that was visible rather than a silent
   accidental pass. Build 18 reads from `/amplify/shared/d14fhvl4rp79nn/` properly.
4. **A third finding, incidental to the fix.** While scoping the paths, the broad read revealed the
   three sandbox secrets were split across **two sandboxes** — `root-sandbox-*` and
   `vivicat-sandbox-*` — because `ampx sandbox` names the environment after the OS user and the agent
   and operator ran it as different users. The over-broad read is precisely what had hidden it: read
   across everything at once, the keys looked like one coherent set. Operator has since consolidated
   into the root sandbox. `--identifier` pins the name.

**The lesson worth keeping.** The path narrowing was good practice and was kept, but it was not the
bug. **The bug that cost real time was a check that fails closed and cannot say why.** 0017 built a
control whose failure message described the command it ran instead of the error it got. That turned
a thirty-second fix into two red builds and a confident wrong answer. The stale `vivicat-sandbox-*`
duplicates are now unused; harmless, and left for `0130`/`0131` to clean up with the rest of the
sandbox work rather than widening this ticket.

## Operator validation

- **Amplify build 18 on `main`, `SUCCEED`** — BUILD, DEPLOY and VERIFY all green. Its log shows the
  literal scan reading from the parameter store, quoted verbatim in
  `docs/capabilities/02-deploy-and-auth.md`: `ssm /amplify/shared/d14fhvl4rp79nn/ → 3 key(s)`, two
  literals scanned by origin path, `STRAVA_CLIENT_ID` skipped by name, no secret in built output.
- **It still fails closed, proven rather than assumed** — builds 15 and 16 both went red on
  `--require-literals` with zero literals resolved, and a local run with `AWS_APP_ID`/`AWS_BRANCH`
  set against paths holding no keys exits 1 and lists every path tried.
- **The error is now diagnostic** — the v1/v2 flag mismatch was found *by* this change, which is the
  strongest available evidence that criterion 2 is met.
- **Operator actions completed during this ticket:** all three secrets set in the Amplify console
  (as **shared**, under `/amplify/shared/d14fhvl4rp79nn/`), and the sandbox secrets consolidated into
  `root-sandbox-bcc61467ba`.

**Still worth an operator's eyes, on a device:** the phone check from 0017 is unchanged and still
outstanding — on the **Android phone at `https://soles.devaultsecurity.com`**, sign in, then via
`chrome://inspect` from the laptop search the loaded JS for the first six characters of the Strava
client secret. Zero hits expected. Build 18 is the first deployment where that is checkable against
what CloudFront actually serves.
