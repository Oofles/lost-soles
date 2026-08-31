# 02-deploy-and-auth

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`02-deploy-and-auth\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (6)

- `0012` — Next.js 15 App Router project and Amplify Gen 2 backend skeleton
- `0013` — GitHub Actions PR gate — tsc --noEmit, ESLint, vitest, mirrored in amplify.yml
- `0014` — Cognito — email sign-in, self-signup OFF, unauthenticated identities OFF
- `0015` — Domain association for soles.devaultsecurity.com
- `0016` — App shell, the seven route stubs, and the design-token file
- `0017` — Secrets via SSM secret() and a client-bundle leak test in CI

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
| User pool | `us-east-1_3lreDA1d1` | `us-east-1_ortrz27yR` |
| Identity pool | `us-east-1:8738715f-f93b-4aab-acc8-3f714a782a75` | `us-east-1:d30ffb7f-0669-4fd5-b424-a4b0e2f2e43a` |
| App client | `5vc5e8t2ljv1hg3doau5mp0m00` | — |
| CFN stack | `amplify-d14fhvl4rp79nn-main-branch-843f54c241-auth179371D7-…` | `amplify-lostsoles-root-sandbox-bcc61467ba-auth179371D7-…` |
| Created | 2026-08-31T13:54:01Z | 2026-08-31T03:42:03Z |
| Posture after 0014 | **fixed** | **still open** — no sandbox deploy since (ticket 0130) |

**Owner account** — created by hand 2026-08-31 via `admin-create-user`, default email invite, no
password shared over any chat:

- email: `amazingbrandon@gmail.com`
- **Cognito `sub`: `5488e4b8-d081-7014-748e-edd1937f8083`**

That `sub` is the partition key for everything the user owns — DynamoDB rows, the `raw/<uid>/` S3
prefix, the `entity('identity')` storage path (§5.4 step 6). **Rebuilding a user pool without
preserving it orphans a permanent map, and D-020 has no restore button.** Note the production pool
was itself replaced once already, on 2026-08-31 — pool replacement is not hypothetical here.

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
| `NEXT_PUBLIC_TILES_BASE_URL` | **plain env var** | client build (ticket 0052) | **Not a secret.** A public URL the browser fetches tiles from; it is in the client bundle by necessity. It appears in the §7 registry only because it VARIES BY ENVIRONMENT, which is a different problem from being sensitive |

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
`AKIA111111111EXAMPLE`, `AKIA222222222EXAMPLE` and `AKIAIOSFODNN7EXAMPLE`; the private-key hit was a
`-----BEGIN RSA PRIVATE KEY-----` header followed by the literal text
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

_Filled in at the REFLECT step, after USE._

