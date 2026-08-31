---
id: 15
slug: domain-association-soles-subdomain
title: Domain association for soles.devaultsecurity.com
type: chore
priority: high
status: closed
size: m
capability: 02-deploy-and-auth
depends_on: [1, 12]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-08-31T14:20:06Z
---

## Description

Point `soles.devaultsecurity.com` at the Amplify app. **Gated on 0001**: the pre-flight audit exists
precisely so that this ticket succeeds on the first attempt, because Amplify's domain-validation
polling backs off to *hours* after a failed attempt, and `CNAMEAlreadyExistsException` from a stale
CloudFront alias is the failure it backs off from.

Do not start this ticket until 0001 is closed with its capability doc verdict reading
"`soles.devaultsecurity.com` is clear to claim". If 0001 found CAA problems, they must already be
fixed — fixing CAA *after* the domain is added to Amplify requires deleting and re-adding the domain,
which takes **the whole apex down** (`01-architecture.md` §6).

The rules, from `01-architecture.md` §6 and `09-roadmap.md` §4.4:

- **Use the existing hosted zone.** Do **not** create a second hosted zone for the subdomain. One
  Route 53 zone backs many Amplify apps on different subdomains in the same account; this is
  explicitly supported. A second zone introduces an NS delegation nobody needs and is a classic
  source of stuck validation. (Cross-account would require an AWS support ticket; this is
  same-account, so it does not apply.)
- **Claim `soles` only.** Amplify offers by default to map both the apex and `www` with a redirect.
  **Remove both.** The apex and `www` belong to the existing site and breaking them is the one way
  this ticket can do real damage.
- **Expect the raw CloudFront URL to 404.** Amplify routes by `Host` header, so only the app URL or
  the custom domain work. That is not a bug — write it in the capability doc so it is not filed as
  one later.
- If the `devaultsecurity` Amplify app has automatic subdomain creation enabled for branch deploys
  (checked in 0001), **no branch on that app may be named `soles`**, or it will collide.

## Acceptance criteria

- [x] **PARTIALLY MET — sequencing inverted, recorded rather than hidden.** 0001 is closed and its
      verdict does say the subdomain is clear to claim, and the verdict is now quoted in
      `docs/capabilities/02-deploy-and-auth.md`. But it was quoted *after* the association, not
      before it: the domain was applied in the AWS console during ticket 0012. The gate's substance
      held — the verdict was correct and the association succeeded first try — but the ordering the
      criterion asked for was not followed. See `## Resolution`.
- [x] The domain is associated in the Amplify console using the **existing** `devaultsecurity.com`
      hosted zone (the zone id recorded by 0001). `aws route53 list-hosted-zones-by-name --dns-name
      devaultsecurity.com` still returns exactly **one** zone afterwards.
- [x] Only `soles` is claimed. The association lists exactly one subdomain mapping, to the `main`
      branch. No apex mapping, no `www` mapping, no redirect from either.
- [x] Domain status in the Amplify console reaches **AVAILABLE** with SSL configured, on the first
      attempt.
- [x] `https://soles.devaultsecurity.com` serves the app over HTTPS with a valid certificate and no
      browser warning.
- [x] `https://devaultsecurity.com` and `https://www.devaultsecurity.com` still serve the **existing
      site**, unchanged, with valid certificates. This is checked after the association, not assumed.
- [x] `dig soles.devaultsecurity.com` returns the expected CloudFront target, and no stale record for
      that name exists in the zone.
- [x] Visiting the app's raw `*.cloudfront.net` URL 404s, and that expectation is written into
      `docs/capabilities/02-deploy-and-auth.md` with the one-line explanation.
- [x] **AMENDED.** `docs/capabilities/02-deploy-and-auth.md` records the final record set for the
      `soles` name. **There is no certificate ARN to record**: the association uses an
      `AMPLIFY_MANAGED` certificate, which AWS provisions in an AWS-owned account and which does not
      appear in this account's `acm list-certificates`. The criterion assumed a customer-provided
      ACM cert. The doc records the validation CNAME and the served certificate's subject, issuer,
      SANs and validity window instead — the identifiers that actually exist.

## Notes

If the association does stall, **do not retry in a loop** — each failed attempt lengthens the backoff.
Stop, re-run 0001's three audit queries, find what actually holds the name, fix that, and then retry
once. This is the single ticket in Phase 1 where impatience costs hours rather than minutes.

`09-roadmap.md` §8.4 lists "the domain association stalls" as a named schedule risk. If it does
stall, the app is still fully usable at its `*.amplifyapp.com` URL and the rest of Phase 1 can
proceed — this ticket blocks the *milestone's* URL, not the milestone's functionality. Say so rather
than letting the whole phase queue behind DNS.

The apex belongs to the existing site. Any change to apex or `www` records made by this ticket is a
defect, full stop.

## Operator validation

1. On the **Android phone**, over **mobile data** (not home wifi, so DNS resolves fresh), open
   `https://soles.devaultsecurity.com`. The app must load and the address bar must show the padlock
   with no interstitial warning. This is the URL the whole first-usable milestone is defined in terms
   of; seeing it work on the actual device is the point of the ticket.
2. On the Android phone, still on mobile data, open `https://devaultsecurity.com` and
   `https://www.devaultsecurity.com`. Both must load the **existing site**, unchanged. If either
   redirects to Lost Soles, the apex was claimed by mistake — stop and undo it.
3. In a desktop browser, open the Amplify console → the app → **Domain management**. The domain must
   read **Available**, with exactly one subdomain row (`soles` → `main`) and no apex or `www` row.
4. In a desktop browser, open the Route 53 console for the zone and read the record list. Confirm the
   `soles` record is present and that no other record changed compared to the "after" list 0001 wrote
   into the capability doc.
5. On the laptop, run `curl -sSI https://soles.devaultsecurity.com` and confirm a 200/302 from the
   app, then `curl -sSI https://<the-cloudfront-domain>` and confirm the 404 that is expected and
   documented.

## Resolution

**`soles.devaultsecurity.com` is live, AVAILABLE, and serving the app over HTTPS on the first
attempt.** No `CNAMEAlreadyExistsException`, no stalled validation, no backoff — the failure mode
this ticket and the whole of 0001 exist to prevent did not occur.

**Files touched:** `docs/capabilities/02-deploy-and-auth.md` only. This ticket wrote no code. The
association itself is AWS state, not repository state.

### The awkward part: this was done out of band, and the gate ran backwards

The operator applied the domain in the AWS console **during ticket 0012**, alongside creating the
Amplify app. 0015 was still `open` and unstarted at the time. That inverts criterion 1, which asks
for 0001's verdict to be quoted into the capability doc *before* the work begins — the quotation
went in afterwards, while writing this Resolution.

Recorded rather than smoothed over, because the criterion existed for a reason. The gate's whole
purpose is that a failed association backs off to hours, so you get one clean shot. Skipping the
gate and getting away with it is luck plus a correct prior audit, not evidence the gate was
unnecessary. The substance did hold: 0001's verdict was accurate, and every constraint the ticket
imposed turned out to be satisfied. But "it worked" is not the same as "the procedure was
followed", and only one of those is repeatable.

### What was verified, and how

Every criterion was checked against live AWS and DNS rather than taken on trust:

- **One hosted zone, the existing one.** `list-hosted-zones-by-name` returns exactly one:
  `Z0112592GE5YS5UPJE7X` — the id 0001 recorded. No second zone was created.
- **Exactly one record was added to the zone.** 0001 recorded 20 records; there are now 21, and the
  delta is `soles.devaultsecurity.com. CNAME d3pljri7vz7pa4.cloudfront.net`. Every other name in
  the zone is byte-for-byte what 0001 listed. The ACM validation CNAME
  `_a9e3d7fa22120edcd17d409177d5982b` was **already present** — it belongs to the pre-existing
  wildcard cert — so Amplify validated against an existing name rather than adding one. This is why
  the delta is +1 and not +2.
- **Still no CAA records.** `ResourceRecordSets[?Type=='CAA']` returns `[]`, as in 0001.
- **`soles` only.** The association lists one subdomain, `soles` → `main`, `verified: true`. No apex
  row, no `www` row, no redirect. This was the one way the ticket could do real damage and it did
  not.
- **The apex and `www` are untouched.** Both still serve `<title>Home | DeVault Security</title>`
  from a *different* distribution (`d2wf0hpqyfyms1.cloudfront.net`); the apex still 302s to `www`
  exactly as before. `ssl_verify_result=0` on both.
- **DNS matches the association.** `dig soles.devaultsecurity.com CNAME` returns
  `d3pljri7vz7pa4.cloudfront.net.`, identical to the record Amplify reports. No stale record for
  that name.
- **The raw CloudFront URL 404s** (`https://d3pljri7vz7pa4.cloudfront.net/` → 404) while the custom
  domain returns 200. Amplify routes by `Host` header. Documented in the capability doc so it is
  not filed as a bug later.

### One criterion was wrong and has been amended

Criterion 9 asked for "the certificate ARN in use". **There isn't one.** The association uses an
`AMPLIFY_MANAGED` certificate, which AWS provisions in an AWS-owned account; it does not appear in
this account's `acm list-certificates`. The only two certificates visible in `us-east-1` are
pre-existing (`…/2486df18-…` issued 2025-11-13, `…/c327168a-…` issued 2026-01-13), both for
`devaultsecurity.com`, and both report `InUseBy: []` — neither backs this domain.

The criterion silently assumed a customer-provided ACM certificate. The capability doc now records
what actually exists and is durable: the validation CNAME, and the served certificate's subject
(`CN = *.devaultsecurity.com`), issuer (`Amazon RSA 2048 S20`), SANs and validity window
(2026-08-31 → 2027-03-17). Worth knowing for 0106's account-deletion runbook, which will need to
know there is no customer-owned cert to clean up here.

### Not done, deliberately

No `D-xxx` was recorded. Nothing architectural was decided — the ticket's design was right, one
criterion rested on a wrong assumption about certificate ownership, and that is captured in the
amendment rather than promoted to a decision.

## Operator validation

Items 3, 4 and 5 were verified by CLI against live AWS and DNS while closing, and are reported in
`## Resolution` above with their actual values. **Items 1 and 2 are outstanding and only the
operator can do them** — they require the Android phone on mobile data, which is the whole point of
the check: a fresh resolver, not a warm home-network cache.

1. ★ **Android phone, mobile data (not wifi), `https://soles.devaultsecurity.com`** — the app must
   load and the address bar must show the padlock with no interstitial. This is the URL the
   first-usable milestone is defined in terms of.
2. ★ **Android phone, still mobile data, `https://devaultsecurity.com` and
   `https://www.devaultsecurity.com`** — both must load the existing DeVault Security site,
   unchanged. If either lands on Lost Soles, the apex was claimed by mistake: stop and undo it.
   Verified from the laptop that this is correct, but the phone check is what catches a resolver
   caching something stale.
3. **Amplify console → Domain management, desktop browser** — reads `AVAILABLE`, one subdomain row
   (`soles` → `main`), no apex or `www` row. Confirmed by
   `aws amplify get-domain-association`: `domainStatus: AVAILABLE`, `statusReason: null`, a single
   `subDomains` entry with `verified: true`.
4. **Route 53 console, desktop browser** — confirmed by CLI instead: 21 records against 0001's
   recorded 20, the single addition being the `soles` CNAME, no CAA, and the apex `A` and `www`
   `CNAME` unchanged.
5. **Laptop `curl`** — `https://soles.devaultsecurity.com/` → 200 with a valid chain
   (`ssl_verify_result=0`); `https://d3pljri7vz7pa4.cloudfront.net/` → 404, the expected and now
   documented behaviour.
