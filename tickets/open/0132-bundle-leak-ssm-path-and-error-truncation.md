---
id: 132
slug: bundle-leak-ssm-path-and-error-truncation
title: check-bundle-leak: SSM read asks for /amplify recursively and truncates its own error
type: bug
priority: high
status: open
size: s
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T20:26:26Z
started: 2026-08-31T20:33:17Z
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

- [ ] `fromSsm()` requests only the paths it needs: `/amplify/<app-id>/<branch>/` and
      `/amplify/shared/<app-id>/` when `AWS_APP_ID` is present, falling back to a broader path only
      when it is not. A failure on one path does not abandon the others.
- [ ] The failure message carries the **full** underlying error, so an IAM denial, a missing `aws`
      binary and an empty result are each distinguishable from the build log alone. Truncation, if
      any, keeps the AWS error text rather than the command line.
- [ ] The IAM permission the Amplify build role actually needs is stated in
      `docs/capabilities/02-deploy-and-auth.md`, next to the `check-auth-posture.mjs` grant that is
      already recorded there, with the resource ARN scoped to this app.
- [ ] The `/amplify/<app-id>/<branch>/<KEY>` layout is corrected in both
      `docs/capabilities/02-deploy-and-auth.md` and `01-architecture.md` §7, with a note that
      `/amplify/resource_reference/...` is a different path holding deploy outputs, not secrets.
- [ ] An Amplify build on `main` runs the check to a **pass**, with the branch secrets set, and the
      log line naming which literals were scanned is quoted in the capability doc.
- [ ] The check still fails closed when it genuinely cannot read SSM — proven, not assumed.

## Notes

Do not soften `--require-literals` to make this pass. Failing closed is the correct behaviour and is
the whole reason the deploy path is the lock rather than the alarm (D-163); the bug is that it fails
closed *uninformatively* and asks for more permission than it needs.

## Operator validation

In the Amplify console on the desktop, open the `main` build log for the commit that closes this and
confirm the leak-check step names the literals it scanned and passes. Then, in the same console,
temporarily remove one branch secret and redeploy: the build must go red with a message that says
plainly which key could not be read and why.
