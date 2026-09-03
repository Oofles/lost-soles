# Runbook — rotating and revoking the GitHub PAT

Ticket `0024`. Normative sources: `08-security-privacy.md` §8.2, `07-ticketsmith.md` §6.2/§6.3.

**Follow this verbatim. Do not improvise.** Both paths below get executed while annoyed — one on a
calendar reminder, one during an incident — and an improvised step at 11pm is how a rotation turns
into an outage. If you have to deviate, that is a defect in this file: fix the file.

---

## 0. The facts you need, in one place

| | |
|---|---|
| **SSM parameter** | `/amplify/shared/d14fhvl4rp79nn/GITHUB_TICKETS_PAT` |
| Parameter type | `SecureString`, KMS key `alias/aws/ssm` |
| AWS account / region | `286588821906` / `us-east-1`, profile **`devault`** |
| Amplify app | `lost-soles`, id `d14fhvl4rp79nn`, branch `main` |
| Repository | `Oofles/lost-soles`, branch `main` |
| Reader | `lib/tickets/github.ts` → `getToken()` |
| Consumer | `POST /api/tickets/capture` (Next.js SSR route, **not** a `defineFunction` Lambda) |
| IAM | role `LostSolesAmplifyComputeRole`, granted read on **this one parameter** |

### The exact PAT settings — every field matters

- **Fine-grained** personal access token. Not classic.
- **Resource owner:** your own account. **Repository access: Only select repositories → `lost-soles`.**
  Never "All repositories."
- **Repository permissions: Contents → Read and write. Nothing else.** No Actions, no Workflows,
  no Administration, no Secrets. (Metadata → Read is auto-added by GitHub and is expected.)
- **Expiry: 90 days.** GitHub permits up to a year; shorter is better for a token living in
  server-side compute.

**It acts as you.** Commits land attributed to your account and the blast radius is whatever the
token reaches — which is why the single-repo scope and Contents-only permission are load-bearing
rather than cosmetic (`07-ticketsmith.md` §6.2). Treat a leak of it as a leak of your repo write
access, because that is exactly what it is.

### Current token

| | |
|---|---|
| **Issued** | **2026-08-31** — SSM parameter version 1, written `2026-08-31T21:21:03-04:00` |
| **Expires** | **~2026-11-29** (issue + 90 days) — **confirm against GitHub, do not trust this line** |
| Written by | `arn:aws:iam::286588821906:root` |
| Parameter version | 1 (never rotated) |

The issue date is evidence: it is the SSM write time, read back with `describe-parameters`. The
expiry is *derived* from it and the 90-day policy, and has never been checked against GitHub.
**Confirm it once, now-ish, and correct this table:** open
<https://github.com/settings/personal-access-tokens> and read the token's expiry, or run

```sh
TOKEN=$(aws ssm get-parameter --profile devault --region us-east-1 \
  --name /amplify/shared/d14fhvl4rp79nn/GITHUB_TICKETS_PAT \
  --with-decryption --query Parameter.Value --output text)
curl -sS -D - -o /dev/null -H "Authorization: Bearer $TOKEN" https://api.github.com/user \
  | grep -i 'github-authentication-token-expiration'
unset TOKEN
```

**Update this table on every rotation.** A runbook whose dates are stale lies about how much time
you have.

---

## 1. Scheduled rotation — every 90 days

> Reminder set for **day 80**. See §4.

**1. Issue the new token.** <https://github.com/settings/personal-access-tokens> → *Generate new
token*, with exactly the settings in §0. Copy it; GitHub shows it once.

**2. Write it to SSM.** Same parameter, same type — this creates version *n+1*, and the old value
stays recoverable until you clean it up:

```sh
aws ssm put-parameter --profile devault --region us-east-1 \
  --name /amplify/shared/d14fhvl4rp79nn/GITHUB_TICKETS_PAT \
  --type SecureString --overwrite --value 'github_pat_...'
```

Prefer `--value file://<path>` with a file you delete afterwards, so the token never lands in your
shell history.

Confirm the write without printing the secret:

```sh
aws ssm describe-parameters --profile devault --region us-east-1 \
  --parameter-filters "Key=Name,Values=/amplify/shared/d14fhvl4rp79nn/GITHUB_TICKETS_PAT" \
  --query 'Parameters[0].{Version:Version,LastModified:LastModifiedDate}'
```

The `Version` must have incremented and `LastModified` must be seconds ago.

**3. Force a cold start. THIS STEP IS NOT OPTIONAL.**

`lib/tickets/github.ts` caches the token in **module scope for the life of the execution
environment** — deliberately, so only a cold start pays the SSM call. An SSM write therefore does
**nothing** to a warm environment: it keeps serving the old token until it is recycled, which can be
minutes or hours. A rotation that stops at step 2 looks complete and then 401s at an unpredictable
time later.

Redeploy the `main` branch from the Amplify console (or push any commit to `main`). Then confirm the
deployment finished before testing — testing during a deploy gives you a meaningless result.

**4. Verify with a live capture, before revoking anything.**

```sh
./tools/capture/capture.sh "pat rotation smoke test $(date -u +%FT%TZ)"
```

Exit `0` and a new file in `tickets/inbox/` on GitHub means the new token is live. **If this fails,
stop — do not revoke the old token.** You still have a working system on the old credential; debug
first. (`capture.sh` needs `LOST_SOLES_REFRESH_TOKEN`; see
`docs/capabilities/03-capture-tile.md` for how to obtain one.)

**5. Now revoke the old token** at <https://github.com/settings/personal-access-tokens> and confirm
it is dead:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer <THE OLD TOKEN>" https://api.github.com/user
```

**401 is the pass.** A 200 means you revoked the wrong token — the two look alike in the list, so
check the name and creation date, not the position.

**6. Update §0's "Current token" table** with the new issue and expiry dates, and **reset the day-80
reminder** (§4). Commit both changes.

---

## 2. Leak response (S5)

**Order matters. Revoke first, investigate second.** Every minute spent working out *how* it leaked
is a minute the token still works.

### Detect

- GitHub's own secret scanning emails you on a push — it detects its own token formats, and this is
  most of the value you get for free.
- Unexpected commits, a changed default branch, or an author in `git log` you do not recognise.
- The token appearing in a build log. (The logger redacts `github_pat_`, `ghp_` and `gh[opsu]_` at
  the log call — `lib/log.ts` — so a hit here means something bypassed the logger.)

### Contain — **revoke the PAT in GitHub settings first. One click. Before anything else.**

Then, immediately after:

```sh
git fetch --all
for b in $(git branch -r --format='%(refname:short)'); do
  echo "== $b"; git ls-tree -r --name-only "$b" -- .github/workflows/
done
```

**Check `.github/workflows/` on *every* branch, not just `main`.** Repo write means CI execution: a
workflow file added by an attacker on any branch runs with whatever the repo's Actions secrets hold.
This is the escalation path, and it is the reason a Contents-only token is still serious
(`08-security-privacy.md` §3 S5, `07-ticketsmith.md` §6.5).

### Rotate

Follow §1, steps 1–6.

**Then seriously consider `07-ticketsmith.md` §6.3 instead — see §3 below.** An incident is the
moment the GitHub App's cost stops looking theoretical.

### Verify

- The old token 401s (§1 step 5).
- `POST /api/tickets/capture` still commits a test capture (§1 step 4).
- **Review the full commit log since the leak, not just the tip:**
  `git log --all --since='<date of leak>' --format='%h %an %ae %s'` — an attacker who wanted
  persistence would not put it at `HEAD`.
- Branch protection and push protection are still on.
- **If anything was committed by an attacker, `08-security-privacy.md` §8.3 is also in scope** — the
  repo is the source of a deployment, so a repo compromise is potentially an AWS compromise.

---

## 3. The standing recommendation: stop having a PAT

**Every rotation is a prompt to reconsider this, not a reflex to complete.** `07-ticketsmith.md`
§6.3: a personal **GitHub App**, installed on the one repo with Contents: read/write, minting
**1-hour installation tokens** from an App ID + private key.

| | PAT (today) | GitHub App (§6.3) |
|---|---|---|
| Identity | **acts as you** — commits attributed to your account | separate bot identity; `git log` distinguishes agent work from yours |
| Credential life | 90-day standing token | 1-hour installation token, minted on demand |
| Rotation chore | this runbook, four times a year | none |
| Revocation | delete the token | uninstall the app |
| Cost | zero setup | JWT signing + token exchange in `lib/tickets/github.ts`; a PEM in SSM instead of a token |

The App is strictly better on every axis except initial setup. **It is the right answer the moment
either of these is true:** you have rotated twice and it is still a chore, or the token has leaked
once. D-081 still applies to it — outbound to `api.github.com` only, no VPC attachment, no NAT.

---

## 4. The day-80 reminder

**The reminder is the control.** A 90-day token with no reminder is a 90-day outage timer, and it
will expire on a Sunday.

- **Current token expires ~2026-11-29** (confirm per §0).
- **Day 80 lands ~2026-11-19.**

**The reminder for the current token exists.** Created 2026-09-03 on
`amazingbrandon@gmail.com`'s primary calendar:

| | |
|---|---|
| Title | **Rotate Lost Soles GitHub PAT (day 80 of 90)** |
| Date | **2026-11-19**, all-day, marked free |
| Event id | `kq7eqksadj6hdn4me09bmlnqps` |
| Alerts | popup + email, 09:00 on the day |
| [Open it](https://www.google.com/calendar/event?eid=a3E3ZXFrc2FkajZoZG40bWUwOWJtbG5xcHMgYW1hemluZ2JyYW5kb25AbQ) | |

Its description repeats the three things that actually go wrong: the derived-not-confirmed expiry,
the cold-start step, and verifying before revoking.

**Ten days of slack is deliberate:** it survives a holiday, a busy week, and one forgotten
notification without the endpoint going down. Keep the same shape on every rotation — an all-day
event on day 80 with a popup *and* an email, because one notification channel is a single point of
failure for the thing that prevents an outage.

Reset it as step 6 of every rotation. **A rotation that does not reset the reminder has traded a
known expiry for an unknown one.**
