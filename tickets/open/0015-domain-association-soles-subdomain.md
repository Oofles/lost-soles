---
id: 15
slug: domain-association-soles-subdomain
title: Domain association for soles.devaultsecurity.com
type: chore
priority: high
status: open
size: m
capability: 02-deploy-and-auth
depends_on: [1, 12]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] 0001 is closed and its capability-doc verdict says the subdomain is clear to claim; the verdict
      is quoted in `docs/capabilities/02-deploy-and-auth.md` before this work begins.
- [ ] The domain is associated in the Amplify console using the **existing** `devaultsecurity.com`
      hosted zone (the zone id recorded by 0001). `aws route53 list-hosted-zones-by-name --dns-name
      devaultsecurity.com` still returns exactly **one** zone afterwards.
- [ ] Only `soles` is claimed. The association lists exactly one subdomain mapping, to the `main`
      branch. No apex mapping, no `www` mapping, no redirect from either.
- [ ] Domain status in the Amplify console reaches **AVAILABLE** with SSL configured, on the first
      attempt.
- [ ] `https://soles.devaultsecurity.com` serves the app over HTTPS with a valid certificate and no
      browser warning.
- [ ] `https://devaultsecurity.com` and `https://www.devaultsecurity.com` still serve the **existing
      site**, unchanged, with valid certificates. This is checked after the association, not assumed.
- [ ] `dig soles.devaultsecurity.com` returns the expected CloudFront target, and no stale record for
      that name exists in the zone.
- [ ] Visiting the app's raw `*.cloudfront.net` URL 404s, and that expectation is written into
      `docs/capabilities/02-deploy-and-auth.md` with the one-line explanation.
- [ ] `docs/capabilities/02-deploy-and-auth.md` records the final record set for the `soles` name and
      the certificate ARN in use.

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
