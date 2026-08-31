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

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

