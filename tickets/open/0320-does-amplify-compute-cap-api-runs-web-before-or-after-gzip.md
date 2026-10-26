---
id: 320
slug: does-amplify-compute-cap-api-runs-web-before-or-after-gzip
title: Does Amplify compute cap /api/runs/web before or after gzip?
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-26T19:31:39Z
started: 2026-10-26T22:03:10Z
---

## Description

Filed by `0259` (D-451). Amplify's SSR compute caps response size. At realistic density (~30 pts/km) the raw `/api/runs/web` body passes ~6 MB around 1,000 runs, but gzipped it is ~1.1 MB. If the cap applies to the uncompressed body, the trace web stops loading somewhere in the next few years. If it applies to the compressed body, nothing needs doing. Settling it needs a write (an oversized test response on a throwaway route or branch), so it could not be settled read-only.

## Acceptance criteria

- [ ] Whether Amplify compute's response-size limit applies to the raw or the gzipped body is
      established by measurement against throwaway resources, not from documentation alone.
- [ ] If it applies to the raw body, the run count at which `/api/runs/web` would hit the cap at
      ~30 pts/km is recorded, and a follow-up ticket is filed (D-451 names delta encoding as the
      known lever). If it applies to the gzipped body, D-451's known-limits bullet says so.

## Notes

Not urgent. 113 real runs are 316 KB raw today. Related: `0259`, D-299, D-451.

## Operator validation

None: a measurement against throwaway resources. The agent records the numbers.

D-123 trigger checked? none — no auth, share, export or public-route change. *(Tickets touching auth, sharing, export or public routes — `08-security-privacy.md` §2.4. Anything but "none" reopens D-123 before merge.)*
