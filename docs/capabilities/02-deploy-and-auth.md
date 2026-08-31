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

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

