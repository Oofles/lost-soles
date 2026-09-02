# 02-deploy-and-auth

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`02-deploy-and-auth\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (11)

Planned as six. Five more were filed `source: agent` while the six were worked — see the Reflection.

- `0012` — Next.js 15 App Router project and Amplify Gen 2 backend skeleton
- `0013` — GitHub Actions PR gate — tsc --noEmit, ESLint, vitest, mirrored in amplify.yml
- `0014` — Cognito — email sign-in, self-signup OFF, unauthenticated identities OFF
- `0015` — Domain association for soles.devaultsecurity.com
- `0016` — App shell, the seven route stubs, and the design-token file
- `0017` — Secrets via SSM secret() and a client-bundle leak test in CI
- `0128` — Restore `npm ci` once the Gen 2 bundled-dependency defect is fixed upstream — **deferred** (D-162, upstream)
- `0129` — Cross-app SSO — evaluate Google sign-in against 08 §5.1 (→ D-175)
- `0130` — Sandbox environment and a throwaway agent account
- `0131` — Sandbox stack was `UPDATE_FAILED`; its Cognito pool predated 0014
- `0132` — Bundle-leak SSM path and error truncation
- `0142` — `check-design-tokens.mjs` does not scan `src/` — filed by the close audit
- `0143` — 08 §5.3 security headers are in no ticket — filed by the close audit, capability `18`

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

---

## Domain association — `soles.devaultsecurity.com`  (ticket 0015, 2026-08-31)

### The 0001 verdict this ticket was gated on

Quoted verbatim from `00-preflight-and-repo.md`, as ticket 0015 requires:

> **`soles.devaultsecurity.com` is clear to claim.** Nothing blocks it. No remediation was required
> and **no changes were made to the account by this audit.**

0001 also recorded that the zone held **20 records**, that **no record claimed `soles`**, and that
there were **no CAA records at all** — which is the good outcome, because with no CAA no CA is
restricted and ACM can issue freely. That verdict held: the association succeeded on the first
attempt, with no `CNAMEAlreadyExistsException` and no backoff.

**Sequencing note, recorded honestly:** the ticket asked for this quotation to land here *before*
the work began. It did not — the association was performed in the AWS console during ticket 0012
and this section was written afterwards. The verdict itself was read and correct; only the
paperwork ran late. See 0015's Resolution.

### Final record set for the `soles` name

The zone is `devaultsecurity.com`, id **`Z0112592GE5YS5UPJE7X`** — the pre-existing zone. **No
second hosted zone was created**, which is the failure mode `01-architecture.md` §6 step 4 warns
about. `list-hosted-zones-by-name` still returns exactly one zone.

```
soles.devaultsecurity.com.   CNAME   d3pljri7vz7pa4.cloudfront.net
```

**Exactly one record was added.** The zone went from 0001's recorded 20 records to 21, and the
delta is that single CNAME. The ACM validation CNAME `_a9e3d7fa22120edcd17d409177d5982b.
devaultsecurity.com` was already present before this ticket — it belongs to the pre-existing
wildcard certificate — so Amplify validated against a name that already existed rather than adding
one. Still **no CAA records** in the zone.

The Amplify association maps exactly one subdomain, `soles` → branch `main`, `verified: true`.
**No apex mapping and no `www` mapping**, and no redirect from either. The apex and `www` continue
to serve the existing DeVault Security site from a different distribution
(`d2wf0hpqyfyms1.cloudfront.net`); the apex 302s to `www` exactly as it did before.

### The certificate

Type is **`AMPLIFY_MANAGED`**, not a customer-provided ACM certificate. **There is therefore no
customer-visible certificate ARN to record** — an Amplify-managed certificate is provisioned in an
AWS-owned account and does not appear in this account's `acm list-certificates`. The two
certificates that *are* visible in `us-east-1` (`…/2486df18-…` and `…/c327168a-…`, both for
`devaultsecurity.com`, issued 2025-11-13 and 2026-01-13) are pre-existing and both report
`InUseBy: []`; neither backs this domain.

The durable identifiers are therefore the validation record above and what is actually served:

```
subject  CN = *.devaultsecurity.com
issuer   C = US, O = Amazon, CN = Amazon RSA 2048 S20
SANs     *.devaultsecurity.com, devaultsecurity.com
valid    2026-08-31 → 2027-03-17
```

### The raw CloudFront URL 404s, and that is correct

```
https://d3pljri7vz7pa4.cloudfront.net/   →   404
https://soles.devaultsecurity.com/       →   200
```

**Amplify routes by `Host` header.** Only the custom domain and the app's own
`*.amplifyapp.com` URL are served; a request arriving at the distribution's own name matches no
host and 404s. This is expected behaviour, not a misconfiguration — written down here so it is not
filed as a bug later.

### Cognito — the two pools, and which is which (ticket 0014)

**Record this table before touching auth anywhere.** During 0014 the agent's local
`amplify_outputs.json` turned out to be the *sandbox's*, so an early posture read reported the
sandbox pool's state while describing it as production. The finding survived — CloudTrail confirmed
production had the same hole — but the evidence pointed at the wrong resource for a while.

| | Production (`main`) | Sandbox |
|---|---|---|
| User pool | `us-east-1_3lreDA1d1` | `us-east-1_RV7QIiViX` |
| Identity pool | `us-east-1:8738715f-f93b-4aab-acc8-3f714a782a75` | `us-east-1:fcfbad08-f483-4bbb-94cc-050f74126c70` |
| App client | `5vc5e8t2ljv1hg3doau5mp0m00` | `mvld8ja1nrdmmi9n9ji7j217v` |
| CFN stack | `amplify-d14fhvl4rp79nn-main-branch-843f54c241-auth179371D7-…` | `amplify-lostsoles-root-sandbox-bcc61467ba-auth179371D7-…` |
| Created | 2026-08-31T13:54:01Z | 2026-09-01T15:06Z (**recreated**, ticket 0131) |
| Posture | **fixed** by 0014 | **fixed** by the 0131 recreation — all five assertions pass |

**Both pool ids in that row have changed at least once.** Production was replaced during 0014;
the sandbox was destroyed and recreated during 0131. Neither id is stable, which is exactly why
`scripts/check-auth-posture.mjs`'s IAM policy is pinned to a wildcard pool ARN and why this table
carries a date column. **Read the ids from `amplify_outputs.json` or this table, never from
memory or from an older section of this document.**

**Owner account** — created by hand 2026-08-31 via `admin-create-user`, default email invite, no
password shared over any chat:

- email: `amazingbrandon@gmail.com`
- **Cognito `sub`: `5488e4b8-d081-7014-748e-edd1937f8083`**

That `sub` is the partition key for everything the user owns — DynamoDB rows, the `raw/<uid>/` S3
prefix, the `entity('identity')` storage path (§5.4 step 6). **Rebuilding a user pool without
preserving it orphans a permanent map, and D-020 has no restore button.** Note the production pool
was itself replaced once already, on 2026-08-31 — pool replacement is not hypothetical here.

### The sandbox was destroyed and recreated  (ticket 0131, 2026-09-01)

**Recorded next to the production pool replacement above on purpose:** both environments have now
had their user pool replaced, for different reasons, and reading the two histories together is the
only way the id churn makes sense.

**What was wrong.** The sandbox pool was created by 0012's skeleton deploy and never took 0014's
changes. 0014 fixed production by *replacing* the pool; the sandbox was simply never redeployed. So
when 0017 added the `secret-smoke-test` function — any new resource forces a full stack update —
CloudFormation tried to update the auth stack in place and Cognito refused:

```
UPDATE_FAILED | AWS::Cognito::UserPool | auth/amplifyAuth/UserPool
  Resource handler returned message: "Invalid AttributeDataType input, consider using the
  provided AttributeDataType enum."
[CFNUpdateNotSupportedError] User pool attributes cannot be changed after a user pool has
been created.
```

That left `amplify-lostsoles-root-sandbox-bcc61467ba` and its `auth179371D7` nested stack both in
`UPDATE_FAILED`, which meant **every subsequent sandbox deploy would fail**. It was a latent block
on every future ticket needing a sandbox, not a cosmetic error.

**What it cost to fix.** Nothing recoverable. Before deleting, the sandbox pool was confirmed to
hold **zero users** (`aws cognito-idp list-users` → `{"Users": []}`), so no account was lost, and
the owner's real account has only ever existed in the production pool. The sandbox S3 buckets and
the `DeploySmokeTest` table went with the stack; both are placeholder fixtures that the redeploy
recreates empty.

**The secrets survived, and that is worth knowing.** The three sandbox secrets at
`/amplify/lostsoles/root-sandbox-bcc61467ba/…` live in **SSM Parameter Store, outside
CloudFormation**, so `ampx sandbox delete` did not touch them. The stack also came back under the
**same name** — the sandbox identifier derives from the OS user, not from a fresh random suffix —
so the recreated environment resolved the *same* secret paths with nothing to re-set. Verified by
invoking the smoke-test Lambda after the redeploy: it reported `length: 32` and
`sha256Prefix: e5a6d6a0cde8`, matching an independently computed SHA-256 of the stored SSM value.

**Do not generalise that into "deleting a sandbox is free."** It was free *here* because the
sandbox held no accounts and no map. Once any environment holds a Cognito `sub` that partitions
real data, the D-020 warning above applies to it in full.

### The throwaway agent account  (ticket 0130, 2026-09-01)

**It lives in the sandbox pool and nowhere else.** That placement is the whole design, not a
convenience. `08-security-privacy.md` §2.4 Trigger A fires the moment a **second production
account** exists: it makes D-123's premise ("the map is shown only to the owner") *false*, not
merely weaker, and demands a seven-item gate of which four are build items — owner-scoped access
tests, a fidelity field on the user record, a consent screen, and a delete path executed once
against a test account. A sandbox account trips none of that, has zero production blast radius,
and leaves nothing to revoke later.

| | |
|---|---|
| Email (username) | `agent@lost-soles.invalid` |
| Pool | **sandbox** `us-east-1_RV7QIiViX` — confirmed absent from production |
| Cognito `sub` | `f4688488-5081-7055-3ae9-db0b8a3237e4` |
| Password | SSM SecureString `/amplify/lostsoles/root-sandbox-bcc61467ba/AGENT_SANDBOX_PASSWORD` |

**The `.invalid` TLD is deliberate** (RFC 2606, reserved and permanently unresolvable). The account
is created with `--message-action SUPPRESS` and given a permanent password directly, so Cognito
never attempts delivery. An address that *cannot* receive mail is the correct choice for an account
that must never participate in a password reset or an email-based recovery flow.

**The password is in SSM, not in this repo and not in any file.** It sits beside the sandbox's
other secrets, under the same path prefix, so it is destroyed by the same teardown and is reachable
only with AWS credentials that already grant far more than this account does.

**Proof it actually signs in, via SRP — the same flow the browser uses:**

```
isSignedIn: true | nextStep: DONE
pool used:   us-east-1_RV7QIiViX
identityId:  us-east-1:42ba0661-92d9-c6c1-2d53-260c782f9752
sub:         f4688488-5081-7055-3ae9-db0b8a3237e4
idToken:     present
signOut ok
```

Note the app client enables `ALLOW_USER_SRP_AUTH` but **not** `ADMIN_USER_PASSWORD_AUTH`. An
`admin-initiate-auth` attempt therefore fails with `Auth flow not enabled for this client`, which
is correct and was left alone — enabling the admin flow to make a test easier would have widened
the pool's auth surface to buy nothing, since SRP is what the app uses anyway.

**What this account is and is not for.** The agent already holds AWS admin CLI access to this
account, which covers nearly all troubleshooting. The one thing the CLI cannot produce is a
*browser session as a signed-in user*. That gap, and only that gap, is what this closes.

### The two holes that were actually open, and the proof they are shut

Both settings `08-security-privacy.md` §5.1 calls "the two lines that carry almost the entire
security posture" were **live-wrong** from 0012's skeleton deploy until 0014. This is recorded
because a hole that was open and is now shut is worth more in the record than a control that was
never tested.

CloudTrail, `CreateUserPool`, production pool `us-east-1_3lreDA1d1`, 2026-08-31T13:54:01Z:

```
adminCreateUserConfig: {"allowAdminCreateUserOnly": false, "unusedAccountValidityDays": 0}
```

The sandbox pool was created with the identical config ten hours earlier. Neither was a theoretical
risk: the site serves publicly at `soles.devaultsecurity.com`, and the pool and client ids ship in
the client bundle by design.

**Proven shut by attack, not by config read** (0014 criteria 6 and 7), against production, unsigned:

```
$ aws cognito-idp sign-up --client-id 5vc5e8t2ljv1hg3doau5mp0m00 \
      --username probe-0014@example.com --password '…' --no-sign-request
An error occurred (NotAuthorizedException) when calling the SignUp operation:
SignUp is not permitted for this user pool

$ aws cognito-identity get-id \
      --identity-pool-id us-east-1:8738715f-f93b-4aab-acc8-3f714a782a75 --no-sign-request
An error occurred (NotAuthorizedException) when calling the GetId operation:
Unauthenticated access is not supported for this identity pool.
```

Both are refusals *from Cognito*, not network or credential errors — which is what operator
validation step 5 asks for, because an ambiguous failure is not proof.

### The posture gate, and the IAM grant it needs

`scripts/check-auth-posture.mjs` asserts five properties of the **deployed** pool and runs in
`amplify.yml`'s backend phase after `ampx pipeline-deploy`. Per D-163 that makes it a lock: a bad
posture fails the deploy. It **fails closed** — a missing CLI, missing credentials or a denied API
call fail the build rather than passing quietly.

It requires a read-only IAM grant on the Amplify build role
`AmplifySSRLoggingRole-bcad2fbf-0a4f-4021-b300-8c0751d38d7e`, because the managed
`AmplifyBackendDeployFullAccess` does not include these describes:

```
cognito-idp:DescribeUserPool        on arn:aws:cognito-idp:us-east-1:286588821906:userpool/*
cognito-idp:ListIdentityProviders   on arn:aws:cognito-idp:us-east-1:286588821906:userpool/*
cognito-identity:DescribeIdentityPool on arn:aws:cognito-identity:us-east-1:286588821906:identitypool/*
```

Wildcards on the pool ARN rather than the specific pool, deliberately: the production pool has
already been replaced once, and a policy pinned to a dead ARN fails open the next time that happens.

---

## Secrets, and the check that proves none of them reach the browser  (ticket 0017, 2026-08-31)

### The standing rule

**Environment variables are NOT secrets.** Amplify renders them in plaintext into build artifacts,
readable by anyone with `get-app` access on the app. Anything sensitive uses `secret()`, which is a
deploy-time reference to SSM Parameter Store — the value never appears in source, in CloudFormation
output, or in a build artifact.

The corollary, from `08-security-privacy.md` §7.4 and the O-005 finding that motivated it:
**configuration files hold references — a parameter path, an environment variable name — never the
material.** `.env.example` is committed and contains `replace-me`; that is the shape of every config
file in this repo.

### The registry

Two stores, chosen by **rotation frequency and ownership** (`01-architecture.md` §7). Static
application config in SSM; per-user rotating credentials in DynamoDB.

| Key | Store | Used by | Notes |
|---|---|---|---|
| `STRAVA_CLIENT_ID` | SSM `secret()` | `/api/strava/callback`, `process-activity`, `token-refresh` | Semi-public — it appears in the OAuth authorize URL — but kept server-side anyway. No reason to build the habit of leaking it |
| `STRAVA_CLIENT_SECRET` | SSM `secret()` | callback + token refresh | **Never leaves a Lambda** |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | SSM `secret()` | `strava-webhook` GET handshake | Compared in constant time |
| `INGEST_BEARER_TOKEN` | SSM `secret()` | `/api/ingest` | Post-MVP (D-112/D-113). Rotate by changing the parameter and the device config |
| `GITHUB_TICKETS_PAT` | SSM, read by the **SSR compute role** | `/api/tickets/capture` | Added by ticket **0018**, and it does NOT use `secret()` — see the note below. Fine-grained PAT, `lost-soles` only, Contents read/write, **90-day expiry** |
| `NEXT_PUBLIC_TILES_BASE_URL` | **plain env var** | client build (ticket 0052) | **Not a secret.** A public URL the browser fetches tiles from; it is in the client bundle by necessity. It appears in the §7 registry only because it VARIES BY ENVIRONMENT, which is a different problem from being sensitive |

**`GITHUB_TICKETS_PAT` reaches its consumer differently from every other secret here,
and the difference is structural.** `secret()` resolves only into a `defineFunction`
Lambda's environment. `/api/tickets/capture` is a **Next.js route handler on Amplify's SSR
compute**, which is not one of those — so `secret()` cannot reach it, and an Amplify
environment variable must not (the standing rule above). It is therefore read from SSM at
cold start via the AWS SDK, over a dedicated **compute role**.

That role did not exist: `computeRoleArn` was `null`, meaning SSR ran under an AWS-managed
role that cannot be given policies. Ticket 0018 created `LostSolesAmplifyComputeRole`, whose
**only** permission is `ssm:GetParameter` on the single parameter
`/amplify/shared/d14fhvl4rp79nn/GITHUB_TICKETS_PAT` — one action, one resource, no wildcard.

**Amplify rejects any `Condition` on a compute role's trust policy.** Both an `aws:SourceArn`
lock and an `aws:SourceAccount` lock were attempted and both were refused with *"The compute
role provided cannot be assumed by Amplify"*; AWS's own generated `AmplifySSRLoggingRole-*`
roles carry the same bare `amplify.amazonaws.com` principal. So the usual confused-deputy
guard is **not available here**, and the actual containment is the permission scope: the worst
this role can do is read one GitHub PAT. Recorded rather than glossed, because a future reader
comparing this to the `check-auth-posture.mjs` grant will notice the missing condition and
should not have to re-derive why.

**One deviation from §7's spelling, forced by Next.js:** §7 names the tiles variable
`TILES_BASE_URL`. Next only inlines an environment variable into the client bundle if it is prefixed
`NEXT_PUBLIC_`, and the browser is the consumer, so the real name is `NEXT_PUBLIC_TILES_BASE_URL`.
The prefix is not decoration — it is Next's own explicit opt-in for "this value will be public",
which is exactly the property §7 is asserting about this key. Ticket `0052` consumes it.

**Not in SSM, deliberately:** the Strava **access and refresh tokens**. Those are per-user
credentials that rotate on every refresh, and they live in the `LostSolesSourceAccount` DynamoDB
table — created in CDK and deliberately *not* an Amplify Data model, so AppSync cannot be
misconfigured into exposing them (`01-architecture.md` §7). Tickets `0032`, `0033` and `0094` own
that; nothing about it belongs to this capability. The four keys above are permanent application
credentials, which is why they are the ones in SSM.

**Secrets Manager is not used.** $0.40/secret/month is real money against a $3–5 budget (D-083), and
its rotation machinery buys nothing when the values rotate roughly never.

### Setting them

```
npx ampx sandbox secret set <KEY> --profile devault     # sandbox
```

`--profile devault` is required on this machine: the default AWS credential chain is empty and
`ampx` reports "Unable to locate credentials" without it. The command **prompts** for the value —
there is no `--value` flag — which is the desirable property, because it means a secret can be set
without ever appearing in a shell history, a transcript, or a file.

Branch environments (`main`) are set in the **Amplify console**, under Hosting → Secrets. `ampx` has
no branch-secret command.

Stored at **`/amplify/<app-id>/<branch>/<KEY>`** for a branch and
`/amplify/<project>/<user>-sandbox-<hash>/<KEY>` for a sandbox; `secret('KEY')` resolves the right
one per environment with no conditional in the source. App id for this project is `d14fhvl4rp79nn`,
so `main`'s secrets live at `/amplify/d14fhvl4rp79nn/main/`. **Standard parameters are free.**

**Not `main-branch-843f54c241`.** That hashed name is the `/amplify/resource_reference/` path, which
holds deploy outputs — bucket names, the GraphQL endpoint — and is a different thing entirely. 0017
recorded the hashed form here and in `01-architecture.md` §7; both were corrected in **0132**, from
Amplify build 15's own log line `SSM params {"Path":"/amplify/d14fhvl4rp79nn/main/"}`.

**A sandbox is named after the OS user, and that split the secrets in two.** 0017 set
`STRAVA_WEBHOOK_VERIFY_TOKEN` while running as `root` and the operator set `STRAVA_CLIENT_ID` and
`STRAVA_CLIENT_SECRET` as `vivicat`, producing:

```
/amplify/lostsoles/root-sandbox-bcc61467ba/STRAVA_WEBHOOK_VERIFY_TOKEN
/amplify/lostsoles/vivicat-sandbox-7b04466b62/STRAVA_CLIENT_ID
/amplify/lostsoles/vivicat-sandbox-7b04466b62/STRAVA_CLIENT_SECRET
```

Two sandboxes, neither complete. The over-broad `--path /amplify` read that 0132 exists to fix is
what hid it: reading across every path at once, the three keys looked like one coherent set. The
check now prints **each key's origin path**, so a split is visible in the log rather than inferred
from an absence. Pass `--identifier` to `ampx sandbox` to pin the environment when it matters.

### Why the SSM read failed in the build, and what it was not

**It was not an IAM denial.** That was the working hypothesis for two builds, and it was wrong. The
Amplify build container ships **AWS CLI v1**, which rejects `--no-cli-pager` — a v2-only flag the
script passed unconditionally:

```
source: ssm /amplify/d14fhvl4rp79nn/main/ →   aws <command> <subcommand> help | Unknown options: --no-cli-pager
```

The flag was purely cosmetic (v2 pages only on a TTY, and CI has none), so it was removed. Every
other flag in that call is common to both major versions. **Nothing about the build role's
permissions needed to change**, and no IAM grant was added for this check — unlike
`check-auth-posture.mjs` below, which genuinely did need one.

**The lesson is the diagnostic, not the flag.** 0017 truncated this error to 80 characters, and the
cut landed one word before `Unknown options`. Two builds were spent guessing at IAM. The fix that
mattered in 0132 was making the failure say what actually happened; the flag then took thirty
seconds. A check that fails closed but cannot say why costs more than it saves.

**The path narrowing was kept regardless.** 0017 asked for `/amplify` recursively — read across
**every** Amplify app in the account — which is more than this needs and passed locally only because
`cli-user` holds broad SSM read. It now reads `/amplify/<app-id>/<branch>/` and
`/amplify/shared/<app-id>/`. That was good practice on its own; it simply was not the bug.

**The green run, from Amplify build 18's log** — reading the parameter store as designed:

```
source: ssm /amplify/d14fhvl4rp79nn/main/ → 0 key(s)
source: ssm /amplify/shared/d14fhvl4rp79nn/ → 3 key(s)
scanning for literals:
  STRAVA_CLIENT_SECRET  from /amplify/shared/d14fhvl4rp79nn
  STRAVA_WEBHOOK_VERIFY_TOKEN  from /amplify/shared/d14fhvl4rp79nn
skipped: STRAVA_CLIENT_ID — value is 6 chars, under the 12-char floor ...
not set in this environment: INGEST_BEARER_TOKEN
No secret in built output. 2 literal(s) and 5 patterns checked across 3 zone(s).
```

The `main/` path returning **0 keys** is correct, not a fault: the operator set these in the Amplify
console as **shared** secrets, so they live under `/amplify/shared/<app-id>/` and apply to every
branch. Reading both paths is what makes that work without configuration. Worth knowing it was the
choice made, because a second branch environment would inherit these rather than hold its own.

**Build 17 went green while the SSM read was still broken**, because Amplify injects branch and
shared secrets into the build environment and the script's `process.env` fallback caught them. The
scan was real and `--require-literals` was satisfied honestly — but it was passing by way of the
fallback rather than as designed, which is exactly the kind of accidental green that a log line
naming each key's origin (`from env` vs a parameter path) makes visible instead of invisible.

### Proving `secret()` works before there is a consumer

`secret()` resolves only into a **Lambda's environment at deploy time** — there is no other consumer
shape. Every real consumer (`/api/strava/callback`, `process-activity`, `token-refresh`,
`strava-webhook`) belongs to capability 05 or 14, so establishing the mechanism only when the first
of those lands would mean debugging SSM resolution, IAM and an OAuth exchange in one session.

`amplify/functions/secret-smoke-test/` decouples them. It is the exact counterpart of the
`DeploySmokeTest` placeholder model in `amplify/data/resource.ts` and exists for the same reason:
prove the mechanism while it is the only thing that can be wrong. It reads
`STRAVA_WEBHOOK_VERIFY_TOKEN` and returns the value's **length and the first twelve hex characters
of its SHA-256** — never the value. A smoke test that logs the secret to prove it arrived writes a
second, un-audited copy of the credential into CloudWatch, which is the O-005 failure exactly.

It reads `process.env`, not `$amplify/env/secret-smoke-test`. The typed accessor is generated into
`.amplify/`, which is gitignored, so the typed import resolves locally and after a deploy but **not
in a fresh clone** — precisely how `amplify_outputs.json` broke the gate during ticket 0014.

**Delete this function when `token-refresh` (ticket 0094) ships.** It reads the same secret in
earnest, and the standing control is the leak check below, which does not depend on the function.

### The leak check — `scripts/check-bundle-leak.mjs`

gitleaks (ticket 0004) scans **committed source**. This scans **built output**. Different surfaces,
both needed: a secret can reach `.next/static` without ever being committed, by being read from SSM
into a client component.

Two zones, two rules:

| Zone | Paths | Rule |
|---|---|---|
| `CLIENT` | `.next/static/**` | Zero secret literals. No exceptions, no allowlist. Anyone who loads the page can read this |
| `SERVER` | `.next/server/**`, `.amplify/artifacts/cdk.out/**` (including `.zip` Lambda bundles, opened with `unzip`) | Also zero today. `secret()` injects into the Lambda *environment*, never into the bundle, so a literal here means someone hardcoded it. `SERVER_ALLOWLIST` is empty and adding an entry requires a docs citation in its `why` |

It also scans both zones for the generic shapes `AKIA[0-9A-Z]{16}`, `ghp_`, `github_pat_`,
`-----BEGIN … PRIVATE KEY-----` and `xox[baprs]-`.

**It never prints a secret value.** Findings name the key, the file and the byte offset, and the
excerpt has the value replaced by `<KEY>`. A leak detector that writes the leak into a public CI log
is the bug it exists to find.

Where it runs, and why the two halves differ:

- **`.github/workflows/gate.yml`** — patterns, plus `--self-test`. This job holds no AWS credentials
  by design: adding an OIDC role would put SSM read access in a second place to buy a duplicate of a
  check the deploy path already runs under real credentials. `npm run build` was added here because
  the check needs `.next/static` to exist; the side benefit is that a Next build error now surfaces
  before deploy rather than at it.
- **`amplify.yml`** — the same, plus `--require-literals`, reading the real values from SSM. **Fails
  closed:** if the SSM read breaks, a pattern-only pass would be a green tick over an unscanned
  bundle, so zero resolved literals is a failure rather than a skip. D-163: the workflow is the
  alarm, this is the lock. A direct push to `main` cannot bypass it.

### Footnote: this document tripped the repaired pre-commit hook

Adding the section below was blocked by `.githooks/pre-commit`, on **two lines written during 0017**
— the ones quoting `AKIA…EXAMPLE` and a PEM header while explaining the vendored-AWS-CLI false
positive. They were committed cleanly at the time because the hook's literal-pattern layer was dead
code (0125); it is now live, and it sees the whole staged file rather than only the diff.

Resolved with per-line `gitleaks:allow` markers, the designed visible exception. Kept as a note
because it is the second concrete measurement of how long that layer was off, and because it
illustrates the tension the hook's own comment names: a project whose security documentation must
quote credential patterns in order to explain them will keep meeting its own scanner. The answer is
a visible per-line exemption in the diff, never a weakened pattern.

### The check that mattered, run by a human on a phone

Every other proof in this section concerns a build tree — on a laptop, or inside a build container.
This one concerns what a browser actually receives.

On 2026-08-31 the operator opened `https://soles.devaultsecurity.com` on the Android phone, signed
in, and searched the loaded JavaScript for the Strava client secret via `chrome://inspect` from the
laptop. **No hit.** Checked against the deployment from Amplify build 18, not against a local build.

Recorded as the operator's result rather than an agent observation, deliberately. It is the one
check in capability 02 that no agent can make, and 0010 already demonstrated what happens when an
operator-verifiable criterion is ticked by whoever wrote it: the skill shipped inert for days
(0123). The criterion stayed open until a human ran it.

### `amplify_outputs.json` is not a leak

It contains the Cognito user pool id, app client id, identity pool id and the AppSync endpoint.
These are **public identifiers**, protected by the pool's policy and AppSync's auth rules, not by
obscurity. The file is gitignored because it is *generated per-environment*, **not** because it is
sensitive, and **its presence in the client bundle is correct**.

This is asserted by `scripts/check-bundle-leak.test.mjs`, not left to inspection, because the
failure mode is social rather than technical: a future contributor sees the check go red on a pool
id, concludes the check is noisy, and deletes the check. The test makes the intended behaviour
executable, so "the check flagged `amplify_outputs.json`" is a red test rather than a judgement
call. The fixture asserts it really does contain each identifier before asserting none of them fire
— a test that passes because the values are absent proves nothing.

### Two amendments to the ticket, and the real finding behind each

**1. Short values are not scanned for, and the skip is reported by name.** Criterion 5 asks for the
literal value of *every* SSM-backed secret. `STRAVA_CLIENT_ID` is a five- or six-digit number, and a
six-digit run appears in minified chunk names, integer constants and timestamps many times per
bundle. Scanning for it produces noise that trains people to ignore the check, which is worse than
not scanning. Values under **12 characters** are skipped, and every skip is printed with the key
name and the reason — never silently. §7 already records the client id as semi-public by design.

**2. The generic patterns were narrowed, not path-allowlisted.** On its first run against the real
tree the check went red on eight findings inside
`asset.98f62bef….zip!awscli/botocore/data/iam/2010-05-08/examples-1.json` — the AWS CLI Lambda layer
that CDK vendors into `cdk.out` for the storage construct. All three distinct AKIA values were
`AKIA111111111EXAMPLE`, `AKIA222222222EXAMPLE` and `AKIAIOSFODNN7EXAMPLE`; the private-key hit was a <!-- gitleaks:allow -->
`-----BEGIN RSA PRIVATE KEY-----` header followed by the literal text <!-- gitleaks:allow -->
`<a very long private key string>`. AWS's own published documentation placeholders, in 4,300 files
of vendored API docs.

Allowlisting that path would have been one line — and would have switched the pattern scan **off
inside the largest third-party blob in the build**, which is exactly where a supply-chain problem
would sit. Instead both patterns were narrowed by shape: an AKIA ending in `EXAMPLE` is AWS's
placeholder convention and is not a key AWS issues, and a `BEGIN … PRIVATE KEY` header with no
base64 material in the 400 characters after it is prose, not a key. The scan stays live in every
zone, including vendored ones. Both exclusions have self-test cases either way — the placeholder
must pass, a real-shaped key must still fire.

### The D-100 collision this ticket surfaced

The first line in the repo to reference the §7 registry — `secret("STRAVA_WEBHOOK_VERIFY_TOKEN")` —
**failed the D-100 boundary gate.** Its tier-2 pattern `strava[A-Za-z0-9_]` matches `STRAVA`
followed by an underscore, so as written the gate made the secret registry unreferenceable from
anywhere in the repo, including from the `defineFunction` environment block that is the correct home
for it.

Settled as **D-166**: tier 2 excludes SCREAMING_SNAKE `STRAVA_*` tokens, case-sensitively, because a
type is PascalCase and a variable is camelCase — an all-caps token is a parameter key and nothing
else. The STRICT tier over `src/domain` and `src/pipeline` gets **no** exclusion, so credentials
reaching the domain still fail. An exemption on `amplify/functions/` was considered and rejected: it
would switch the check off across the directory that will hold every ingestion Lambda.

This is the second narrowing of that tier in two tickets, after 0016's settings copy. Both were
false positives on legitimate code, and both were fixed by making the rule say what it means rather
than by exempting a path.

### Proof that the check can actually fail


Run on the laptop, 2026-08-31, against the **real** `STRAVA_WEBHOOK_VERIFY_TOKEN` read from SSM —
not a synthetic literal. The leak was planted the way a real one would happen: a `NEXT_PUBLIC_`
variable, which Next inlines into the client bundle at build time.

```tsx
// app/leak-proof/page.tsx  — TEMPORARY
"use client"
export default function LeakProof() {
  return <p>{process.env.NEXT_PUBLIC_LEAK_PROOF}</p>
}
```

```
$ NEXT_PUBLIC_LEAK_PROOF="$SECRET" npm run build
$ node scripts/check-bundle-leak.mjs --require-literals

========================================================================
SECRET IN BUILT OUTPUT — build failed
========================================================================

  CLIENT  .next/static/chunks/app/leak-proof/page-ace43439631ddcc9.js  @181
    key:     STRAVA_WEBHOOK_VERIFY_TOKEN   (literal)
    context: ...eturn(0,r.jsx)("p",{children:"<STRAVA_WEBHOOK_VERIFY_TOKEN>"})}},49201:...

  SERVER  .next/server/app/leak-proof/page.js  @3586
    key:     STRAVA_WEBHOOK_VERIFY_TOKEN   (literal)
    context: ...eturn(0,d.jsx)("p",{children:"<STRAVA_WEBHOOK_VERIFY_TOKEN>"})}},28354:...

1 finding(s) are in .next/static — that output is served to every visitor.
Treat the key as compromised: rotate it, then find how it reached the client.

$ echo $?
1
```

It names the file, names the key, exits non-zero, and **the value itself does not appear in the
output** — `<STRAVA_WEBHOOK_VERIFY_TOKEN>` marks where it sat. The component was then deleted,
`.next/` removed, and the build re-run; the check returns green.

The value was never written into a file: it went from SSM into the build environment and back out
through the scanner. That is the point of `secret()`, and it is worth noting that the proof itself
obeyed the rule it was proving.

**A one-off manual run cannot protect anything, so it is not the control.**
`node scripts/check-bundle-leak.mjs --self-test` runs on every CI run in both places and re-proves
the same behaviour against a planted fixture, so the scanner cannot rot into a decorative green tick.

**Ticket amendment.** Criterion 8 and the ticket's operator-validation step 3 both call for the
proof to be a deliberately-leaking **pull request** going red in the Checks tab. D-150 settled that
`main` is the only branch and there is no PR flow, so that shape is unavailable without manufacturing
a branch purely to satisfy a checkbox. The proof above exercises the identical code path under real
credentials, and the CI self-test provides the standing coverage a one-off PR would not have. The
criterion is met in substance and amended in form.

### The clean run, and the two verifications behind it

```
$ node scripts/check-bundle-leak.mjs --require-literals
  literal sources tried: ssm
  scanning for literals: STRAVA_WEBHOOK_VERIFY_TOKEN, STRAVA_CLIENT_SECRET
  skipped: STRAVA_CLIENT_ID — value is 6 chars, under the 12-char floor ...
  not set in this environment: INGEST_BEARER_TOKEN
No secret in built output. 2 literal(s) and 5 patterns checked across 3 zone(s).
```

`INGEST_BEARER_TOKEN` is unset on purpose — it is post-MVP (D-112/D-113), and values land with the
capability that consumes them. `STRAVA_CLIENT_ID`'s skip line is the amendment above justifying
itself in real output rather than in prose.

**`secret()` proven end to end.** The deployed `secret-smoke-test` Lambda returned
`{"key":"STRAVA_WEBHOOK_VERIFY_TOKEN","resolved":true,"length":32,"sha256Prefix":"e5a6d6a0cde8"}`,
and the same two values computed locally from the SSM parameter match exactly. The value crossed
from SSM into a Lambda environment and was confirmed identical without either end ever printing it.

**No secret in source or in a build log.** Every set secret value was searched for across all 236
git-tracked files and the full `npm run build` log: zero hits. This is the check gitleaks does not
do — gitleaks knows credential *patterns*, this knows the actual *current values*.

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

### What the design got right, and it was not obvious

**The alarm/lock split (D-163) earned itself within the capability.** Branch protection turned out
to be unavailable on this account, which would ordinarily mean the gate is decorative. Because
`amplify.yml` carries the same checks on the deploy path, the checks kept their teeth when the
mechanism that was supposed to enforce them evaporated. That is not luck — it was designed for
exactly the case where the enforcement layer is missing, and the case arrived immediately. It is
also what keeps the currently-red `gate.yml` (see below) from being a production risk.

**Putting the guards in before there was anything to guard.** `check-boundaries.mjs` shipped while
`src/domain/` was empty and `check-design-tokens.mjs` shipped while there were three components.
Both looked like ceremony at the time. The design-token check caught a real leak in 0016 within the
same ticket, and the D-100 check is the reason the domain is still clean at capability `04`. A
palette rule added after the palette has leaked has already failed.

**§5.1's insistence that two booleans carry the posture.** Both were live-WRONG on the deployed pool
from 0012's skeleton onward — `AllowAdminCreateUserOnly: false` and
`AllowUnauthenticatedIdentities: true`. Source code could not see it, and would not have. The
post-deploy `check-auth-posture.mjs` assertion that §5.1 asked for is the only thing that would ever
have found it, and it found it immediately.

### What the design got wrong

**Sections written before the code, never revisited once it existed.** Both design-side divergences
(D-176) are this, in one document. `01-architecture.md` §5 sketched an App Router tree that
`06-ui-ux.md` later superseded wholesale, and §6 froze an `amplify.yml` that six tickets then
changed. Meanwhile §7 of the same file *was* corrected in place when 0132 found it wrong, and §6's
own branch-model bullet *was* annotated for D-150. The convention existed and was applied
inconsistently — which is worse than not having it, because a reader learns to trust the correction
blocks and then meets a section that has none.

**The lesson for every capability after this one:** when a ticket's implementation contradicts the
section it cites, amend the section *in that ticket*, not at the audit. The audit found these four
months' worth of confidence-in-the-wrong-place in twenty minutes; the cost was that the wrong text
sat there for two days being read. `0132` and `0123` both got this right in-ticket. `0016` did not,
and `0016` is the one that diverged most.

### Divergences, and how each resolved

Four, one over the budget of three, so the audit records **`forced`**, not `pass`. All four were
reviewed by the operator, who accepted the implementation in every case; the resolutions are
therefore doc amendments and new tickets, never code changes. Full reasoning in **D-176**.

1. `design-was-wrong` — **D-162/D-176** — §6's `amplify.yml` specified `npm ci` and omitted six
   guards. Amended; `amplify.yml` itself now named as the authority on the deploy path.
2. `design-was-wrong` — **D-176** — §5's App Router tree, and its `lib/domain/` contradicting §3's
   `src/domain/`. Amended; `06-ui-ux.md` §1.2 named normative for the IA.
3. `code-was-wrong` — **`0142`** — the design-token gate does not scan `src/`. Latent only: no hex
   there today.
4. `code-was-wrong` — **`0143`** — 08 §5.3's HSTS/nosniff/frame-ancestors/CSP are in no ticket.
   Filed against capability `18`.

On not arguing the budget down: folding 1 and 2 into a single "01-architecture.md is stale" finding
would have bought a `pass`, and was rejected. They are two wrong statements a reader would act on
separately. The prescribed remedy for a busted budget is a DESIGN session on the affected doc, and
the amendments above are that session, scoped to the two sections the audit actually found.

### Estimate vs actual

**Planned six tickets; ran eleven.** The five extra were all `source: agent`, all filed rather than
absorbed, and none of them was scope creep — they were the environment being different from the
plan's assumptions:

- `0128`/D-162 — `npm ci` is broken upstream for the entire Amplify Gen 2 dependency set. Nothing in
  the plan could have anticipated this and no amount of care avoids it.
- `0130`/`0131` — the sandbox needed to exist and then needed rebuilding, because its Cognito pool
  predated 0014's posture fix and would have taught false lessons.
- `0132` — the documented SSM secret path was simply wrong (it was the `resource_reference` path),
  found because the build failed and the error was too truncated to say why.
- `0129` — a genuine product question surfaced by having auth in front of the operator for the first
  time, answered with D-175 rather than deferred.

**The pattern worth carrying forward:** four of the five came from *deploying*, not from designing.
This was the first capability where the plan met a real AWS account, and the plan's error rate
against that account was much higher than its error rate against itself. Capability `05`
(Strava adapter) is the next one that meets a third party, and it should be budgeted the same way —
assume roughly one filed-not-planned ticket per two planned ones.

### What the next capability should do differently

1. **Amend the cited section in the ticket that contradicts it.** The single highest-value change,
   and it costs minutes. See D-176.
2. **Fix `gate.yml` before starting `03`.** `gate.yml` has been red on every push since
   2026-09-01 03:48 on a stale `docs/INDEX.md` (**`0140`**), and because Actions steps are
   fail-fast, the four steps after it have not run — including `npm run build` and **both
   bundle-leak scans**, which are this capability's own controls. Production is not at risk:
   `amplify.yml` is the lock and runs the literal scan under real credentials (build 18 green).
   But half of `02`'s alarm has been dark for fifteen runs, and a red build that means nothing is
   the exact reflex `0137` calls more dangerous than a flake. **`0140` should be the next ticket
   worked**, and its fourth criterion — whether a docs index should be able to mask the checks
   below it — is the one that matters.
3. **Capability `03` inherits `middleware.ts` as its auth layer.** `/api/tickets/capture` is
   unauthenticated on its own and relies entirely on the middleware matcher covering `/api/*`.
   That is deliberate and documented in the route file, but it means a change to the matcher is a
   security change to a different capability. `0019` is where that stops being true.

## Audit — 2026-09-02 (`tickets.mjs audit --record`)

**Verdict: FORCED.** Mechanical half: 7 passed, 1 failed, 4 n/a. See AUDIT.md §1, §4, §5.

> **Overridden with `--force`.** Reason: Operator reviewed all four divergences and accepted the implementation in every case; both design-side findings were amended in this commit (D-176), both code-side findings filed as 0142/0143. TWO overrides are recorded here, not one. (1) Four divergences is over the budget of three, recorded as four rather than folded into three to buy a pass; the prescribed DESIGN session on 01-architecture.md was performed, scoped to §5 and §6. (2) capability-tickets-closed fails on 0142, which THIS AUDIT filed minutes ago against the capability it was auditing — the audit's own §2 remedy for a code-was-wrong finding structurally creates an open ticket in the capability it closes. 0142 is latent only (src/ holds no hex today) and is the recommended next ticket alongside 0140.

> - 1 mechanical check(s) failed: capability-tickets-closed
> - 4 divergences, over the budget of three — the design is stale, not the code.

**Deferred, and therefore excluded from `capability-tickets-closed`:** `0128` Restore npm ci in amplify.yml once the Amplify Gen 2 bundled-dependency defect is fixed upstream. This capability passed with work outstanding — waiting on something outside the project, not forgotten. `tickets.mjs recheck` reports whether any wait is over.

**Divergences (4 of a budget of 3):**

1. **design-was-wrong** — `D-176` — 01-architecture.md §6's amplify.yml specified npm ci (D-162) and omitted six guards now on the deploy path; amended, and amplify.yml itself named as the authority
2. **design-was-wrong** — `D-176` — 01-architecture.md §5's App Router tree never shipped and its lib/domain contradicted §3's src/domain; amended, 06-ui-ux.md §1.2 named normative for the IA
3. **code-was-wrong** — `0142` — check-design-tokens.mjs does not scan src/, and its comment asserts src/ does not exist
4. **code-was-wrong** — `0143` — 08 §5.3's HSTS, nosniff, frame-ancestors and CSP are in no ticket in the backlog

- `typecheck` — **pass** — npm run typecheck
- `lint` — **pass** — npm run lint
- `unit-tests` — **pass** — npm run test
- `script-tests` — **pass** — node --test tickets.test.mjs
- `invariant-sweep` — **na** — 30 invariants declared, none cited by any test yet — activates as soon as one test names an I-n (the domain model starts at capability 04)
- `boundary-greps` — **pass** — check-boundaries.mjs clean
- `vigil-test` — **na** — no vigil test exists yet — ticket 0030 puts it permanently in CI (D-031/D-141)
- `validate` — **pass** — 0 errors across open/ and closed/
- `fog-no-refog` — **na** — no explored blob or fog pipeline exists yet — activates with capability 07 (D-020, I-7)
- `xp-not-lower` — **na** — no XP ledger exists yet — activates with capability 09 (D-135, I-16)
- `blocked-by-closed` — **pass** — no blocked_by points at a closed ticket
- `capability-tickets-closed` — **fail** — 1 still open: 0142; 1 deferred (0128)

<!-- audit-record {"capability":"02-deploy-and-auth","audited":"2026-09-02T01:59:29Z","verdict":"forced","mechanical":{"pass":7,"fail":1,"na":4},"divergences":4,"deferred":["0128"],"forced":"Operator reviewed all four divergences and accepted the implementation in every case; both design-side findings were amended in this commit (D-176), both code-side findings filed as 0142/0143. TWO overrides are recorded here, not one. (1) Four divergences is over the budget of three, recorded as four rather than folded into three to buy a pass; the prescribed DESIGN session on 01-architecture.md was performed, scoped to §5 and §6. (2) capability-tickets-closed fails on 0142, which THIS AUDIT filed minutes ago against the capability it was auditing — the audit's own §2 remedy for a code-was-wrong finding structurally creates an open ticket in the capability it closes. 0142 is latent only (src/ holds no hex today) and is the recommended next ticket alongside 0140."} -->
