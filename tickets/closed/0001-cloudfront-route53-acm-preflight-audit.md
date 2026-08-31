---
id: 1
slug: cloudfront-route53-acm-preflight-audit
title: CloudFront / Route 53 / ACM pre-flight audit of the devaultsecurity AWS account
type: chore
priority: high
status: closed
size: m
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-08-30T00:00:00Z
---

## Description

**This is step zero of the entire project** (`09-roadmap.md` §4.4). The `devaultsecurity` repo
history shows an abandoned S3 + CloudFront + ACM architecture, retired over unresolvable SSL
problems, **whose teardown was never verified**. If any distribution in the account still carries
a `devaultsecurity.com` alias, or a stale Route 53 record points at a dead distribution, then
0015 (domain association for `soles.devaultsecurity.com`) fails with
**`CNAMEAlreadyExistsException`** — and Amplify's validation polling backs off to *hours* after
the first attempt. Getting it right on the first try is worth an hour of auditing.

Run the three queries from `01-architecture.md` §6 (PRE-FLIGHT):

```bash
# 1. Any distribution claiming a devaultsecurity.com alias?
aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Quantity>\`0\`].{Id:Id,Status:Status,Enabled:Enabled,Aliases:Aliases.Items,Domain:DomainName}" \
  --output table

# 2. Stale records in the EXISTING hosted zone (do not create a second zone)
aws route53 list-hosted-zones-by-name --dns-name devaultsecurity.com
aws route53 list-resource-record-sets --hosted-zone-id <ZONE_ID> \
  --query "ResourceRecordSets[?Type=='CNAME'||Type=='A'||Type=='CAA']" --output table

# 3. Orphaned or failed ACM certs (must be us-east-1 for CloudFront)
aws acm list-certificates --region us-east-1 --output table
```

Then resolve findings **in the order given in the design doc**. The order is load-bearing: CAA is
checked before anything is created because fixing CAA *after* the domain is added to Amplify
requires deleting and re-adding the domain, which takes the whole apex down.

Note the credential this audit runs under: 0002 rotates the O-005 key. If the rotation has already
happened, use the new profile / SSO session; if the audit runs first, do not paste any key material
into a config file (that is exactly the O-005 failure).

## Acceptance criteria

- [ ] All three `aws` queries above have been run and their raw output pasted verbatim into
      `docs/capabilities/00-preflight-and-repo.md` under a dated "Pre-flight audit" heading.
- [ ] Every CloudFront distribution carrying a `devaultsecurity.com` alias is either (a) confirmed
      to be a live, wanted distribution and documented as such, or (b) disabled, waited out of
      `InProgress`, and deleted. A disabled-but-existing distribution still holds the alias.
- [ ] Every stale `CNAME`/`A`/`ALIAS` record in the existing hosted zone that points at a dead or
      deleted distribution is removed, and the removal is listed in the capability doc.
- [ ] CAA records on `devaultsecurity.com` are enumerated. If a CAA record exists and does not
      authorize an Amazon CA (`amazon.com`/`amazontrust.com`/`awstrust.com`/`amazonaws.com`), it is
      fixed **before** any domain association work, and the capability doc records the before/after
      record set. If no CAA record exists, that fact is written down explicitly.
- [ ] The existing `devaultsecurity` Amplify app's automatic-subdomain-creation setting is checked
      and recorded; if auto-subdomain is on, the doc states that no branch on that app may be named
      `soles`.
- [ ] The hosted zone ID for `devaultsecurity.com` that 0015 must reuse is written into the
      capability doc. It is confirmed there is exactly **one** hosted zone for the domain; no second
      zone is created by this ticket.
- [ ] Orphaned or `FAILED`/`VALIDATION_TIMED_OUT` ACM certificates in `us-east-1` are listed, and
      each is either kept with a stated reason or deleted.
- [ ] The capability doc contains a one-line verdict: "`soles.devaultsecurity.com` is clear to
      claim" or an explicit list of what still blocks it.
- [ ] No AWS credential value appears anywhere in the repo as a result of this work.

## Notes

Depends on nothing — this is the first ticket in the repo and can be run before a single line of
code exists. It gates 0015 (`depends_on: [1, 12]`).

Expect the raw CloudFront URL of the eventual Amplify app to return 404: Amplify routes by `Host`
header, so only the app URL or the custom domain work. That is documented here so nobody files it
as a bug later.

Do **not** create a new hosted zone for the subdomain. One Route 53 zone backs many Amplify apps on
different subdomains in the same account; a second zone introduces an NS delegation nobody needs and
is a classic source of stuck validation.

The apex and `www` belong to the existing site. This project claims `soles` and nothing else — see
0015.

## Operator validation

1. On the laptop, in a terminal: re-run query 1 (`aws cloudfront list-distributions ...`) after the
   remediation. Read the `Aliases` column. No row may list `devaultsecurity.com` or
   `soles.devaultsecurity.com` unless it is a distribution deliberately kept and named in the
   capability doc.
2. In a desktop browser, open the Route 53 console for the `devaultsecurity.com` hosted zone and
   read the record list top to bottom. Confirm visually that it matches the "after" list in the
   capability doc and that no record points at a distribution ID that no longer exists.
3. In a desktop browser, open `https://devaultsecurity.com` and `https://www.devaultsecurity.com`.
   Both must still load with a valid certificate and no browser warning — this audit must not have
   broken the existing site.
4. On the Android phone, on mobile data (not the home wifi, so DNS is resolved fresh), load
   `https://devaultsecurity.com`. It must still work. This is the check that catches a DNS change
   that only looks fine from a machine with a warm cache.

## Resolution

**`soles.devaultsecurity.com` is clear to claim. No remediation was required and no changes were
made to the account.** Full audit output is in `docs/capabilities/00-preflight-and-repo.md` under
"Pre-flight audit — 2026-08-30".

**The ticket's premise was false, which is the most useful thing it produced.** `09-roadmap.md`
§4.4 expected orphaned CloudFront distributions from the retired S3+CloudFront architecture still
holding a `devaultsecurity.com` alias. There are **zero customer-owned distributions** in the
account — verified as genuinely empty rather than access-denied by re-running without `--query`.

The trap this nearly set: Q1 (no distributions) and Q2 (six CloudFront hostnames in DNS) appear to
contradict each other. They do not — those are **Amplify-managed distributions**, owned by AWS's
service account and invisible to `list-distributions`. Every one maps to a live Amplify app. That
reconciliation is written into the capability doc so the next person to run these queries does not
lose an hour to it.

Criteria, as resolved:

- **Q1/Q2/Q3 run, raw output recorded** — yes, in the capability doc.
- **Distributions carrying the alias** — none exist. Satisfied vacuously.
- **Stale records removed** — none found. All 20 records point at something live: six Amplify apps,
  five S3 redirect buckets (all returning 301), three ACM validation CNAMEs, plus NS/SOA/TXT.
- **CAA enumerated** — **there are no CAA records.** Recorded explicitly as the ticket demands.
  This is the good outcome: no CA is restricted, ACM issues for `soles` without changes, and §4.4's
  load-bearing "fix CAA before domain association" ordering concern does not arise.
- **Auto-subdomain checked** — `false` on all six apps. The "no branch may be named `soles`"
  constraint does not apply.
- **Hosted zone id recorded for 0015** — `Z0112592GE5YS5UPJE7X`. Exactly one zone; none created.
- **Orphaned/failed certs** — no FAILED or VALIDATION_TIMED_OUT. Two ISSUED certs for the apex,
  both `InUse: false`, **kept with a stated reason**: Amplify manages its own certificates, these
  are retired-architecture leftovers that cost nothing and block nothing, and ACM deletion is
  irreversible. Flagged as an open item for an operator decision rather than actioned.
- **No credential value in the repo** — confirmed; the audit wrote only findings.

**Incidental finding, not actioned:** an orphaned S3 bucket `www.devaultsecurity.com` exists while
DNS points `www` at Amplify — another remnant of the retired architecture. Recorded in the
capability doc's open items. Not touched (D-152).

**Useful for later capabilities:** three of the six apps already run `WEB_COMPUTE` (SSR), so the
account has precedent for the platform Lost Soles needs — `0012` is not breaking new ground.

## Operator validation

Steps 1 and 2 are satisfied by the audit output in the capability doc: query 1 returns nothing at
all, so no row can list a `devaultsecurity.com` alias, and the record list is reproduced in full.

**Steps 3 and 4 are still yours, and are cheap:** open `https://devaultsecurity.com` and
`https://www.devaultsecurity.com` in a desktop browser (both loaded for the agent — 302 and 200
respectively — but check the certificate shows no warning), then load the apex on the Android phone
**over mobile data, not home wifi**, so DNS resolves fresh.

The risk being checked is nil in this case — **this audit changed nothing** — but run it anyway: it
establishes the pre-change baseline that `0015` will be compared against when it does start
modifying the zone.

**Operator validation confirmed 2026-08-30:** steps 3 and 4 performed and passed —
apex and `www` load in a desktop browser with no certificate warning, and the apex resolves and
loads on the Android phone over mobile data. Pre-change baseline established for `0015`.
