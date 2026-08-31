# 00-preflight-and-repo

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`00-preflight-and-repo\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (7)

- `0001` — CloudFront / Route 53 / ACM pre-flight audit of the devaultsecurity AWS account
- `0002` — Rotate the O-005 AWS access key and gitignore the agent config that contains it
- `0003` — Create the repository skeleton per 07-ticketsmith §7.2
- `0004` — .gitignore and secret scanning, in place before the first commit
- `0005` — Copy TicketSmith WORKFLOW.md, TEMPLATE.md and the three prompt files, with two edits
- `0006` ~~— Author the full MVP backlog by hand into tickets/open/~~ ✔
- `0120` — docs/INDEX.md — a section map so design docs are read by section, never whole

## Pre-flight audit — 2026-08-30 (ticket 0001)

Account `286588821906`, principal `arn:aws:iam::286588821906:user/cli-user`, profile `devault`.

### VERDICT

> **`soles.devaultsecurity.com` is clear to claim.** Nothing blocks it. No remediation was required
> and **no changes were made to the account by this audit.**

### The ticket's premise was false, and that is the headline

`09-roadmap.md` §4.4 expected orphaned CloudFront distributions from a retired S3+CloudFront
architecture still holding a `devaultsecurity.com` alias, causing `CNAMEAlreadyExistsException` on
domain association. **There are zero customer-owned CloudFront distributions in this account** —
`aws cloudfront list-distributions` returns empty (verified as genuinely empty, not access-denied,
by running it without `--query`).

The six CloudFront hostnames that *do* appear in Route 53 are **Amplify-managed distributions**,
owned by AWS's service account and invisible to `list-distributions`. Every one maps to a live
Amplify app. This is worth recording because it will look alarming again to anyone who repeats
Q1 and Q2 and sees them disagree.

### Q1 — CloudFront distributions

```
aws cloudfront list-distributions  ->  (empty)
```

Zero distributions. No alias conflicts possible. **Criterion satisfied vacuously.**

### Q2 — Route 53

**Exactly one hosted zone. Do not create a second (`0015` must reuse this):**

```
Zone ID:  Z0112592GE5YS5UPJE7X
Name:     devaultsecurity.com.
Records:  20
Public:   yes
```

All 20 records resolve to something live:

| Subdomain | Target | Backing |
|---|---|---|
| apex, `www` | `d2wf0hpqyfyms1.cloudfront.net` | Amplify app `dmw40r2ui3yeq` (devaultsecurity) |
| `school` | `d21a6oo0ckqb6h.cloudfront.net` | Amplify `d1at27fw1o7tr4` (school-hub) |
| `ncng`, `www.ncng` | `d2ow2fc73o059f.cloudfront.net` | Amplify `d26xpaekvq1mzd` (ncng-tracker) |
| `tracker`, `www.tracker` | `dn4zewc25xhre.cloudfront.net` | Amplify `d29rq8rhhzk0al` (pluralsight-course-tracker) |
| `index` | `d2defhxg3h98xb.cloudfront.net` | Amplify `d2ozwaky0al385` (sans-index) |
| `korea` | `dujsg1gt1da95.cloudfront.net` | Amplify `d35gttzp8hyauv` (korea-trip) |
| `ctf`, `github`, `linkedin`, `mastodon`, `twitter` | `s3-website-us-east-1.amazonaws.com` | S3 redirect buckets — **all live, all return 301** |
| 3 × `_<hash>` CNAME | `*.acm-validations.aws` | ACM DNS validation records for issued certs |

**No stale records found.** Every A/ALIAS/CNAME points at something that exists and responds.
Nothing was removed.

**No record claims `soles`,** and `soles.devaultsecurity.com` does not resolve.

### CAA — recorded explicitly, as the ticket requires

```
aws route53 list-resource-record-sets --query "ResourceRecordSets[?Type=='CAA']"  ->  []
```

> **There are NO CAA records on `devaultsecurity.com`.**

This is the good outcome. With no CAA record, no CA is restricted, so ACM can issue for `soles`
without changes. The load-bearing ordering concern in §4.4 — fix CAA *before* domain association,
because fixing it after requires deleting and re-adding the domain and taking the apex down — **does
not arise.** Nothing to do.

If a CAA record is ever added to this zone, it must authorise `amazon.com`, `amazontrust.com`,
`awstrust.com` and `amazonaws.com`, or every future Amplify subdomain on this domain breaks.

### Amplify auto-subdomain

**`enableAutoSubDomain: false` on all six apps.** The constraint feared in the ticket — "if
auto-subdomain is on, no branch on the devaultsecurity app may be named `soles`" — **does not
apply.** A branch named `soles` on any existing app would not auto-claim the subdomain.

| App | ID | Platform | Domain association | autoSub |
|---|---|---|---|---|
| devaultsecurity | `dmw40r2ui3yeq` | WEB | `www` + apex | false |
| school-hub | `d1at27fw1o7tr4` | WEB_COMPUTE | `school` | false |
| ncng-tracker | `d26xpaekvq1mzd` | WEB_COMPUTE | `ncng`, `www` | false |
| pluralsight-course-tracker | `d29rq8rhhzk0al` | WEB_COMPUTE | `tracker`, `www` | false |
| sans-index | `d2ozwaky0al385` | WEB | `index` | false |
| korea-trip | `d35gttzp8hyauv` | WEB | `korea` | false |

Note three apps already run `WEB_COMPUTE` (SSR), so the account has precedent for the platform
Lost Soles needs.

### Q3 — ACM certificates (us-east-1)

No `FAILED`, `VALIDATION_TIMED_OUT`, `EXPIRED` or `PENDING_VALIDATION` certificates.

Two `ISSUED` certificates for `devaultsecurity.com`, **both `InUse: false`**:

```
arn:aws:acm:us-east-1:286588821906:certificate/2486df18-1cab-4c40-b53f-11556f333eb1
arn:aws:acm:us-east-1:286588821906:certificate/c327168a-e253-4d95-a44a-b65f7efe7e10
```

**Decision: KEPT, pending an explicit operator call.** Reasoning: they are leftovers from the
retired architecture (Amplify issues and manages its own certificates, which is why these are
unused). They cost nothing, block nothing, and cannot cause a `soles` conflict. Deleting an ACM
certificate is irreversible, and there is no benefit to weigh against that. Recommend deletion as
tidiness only — see the open item below.

### Live health check

| URL | Result |
|---|---|
| `https://devaultsecurity.com` | HTTP 302 (redirects to www) |
| `https://www.devaultsecurity.com` | **HTTP 200** |
| `soles.devaultsecurity.com` | does not resolve — clear |

### Open items — not blocking `soles`

1. **Two orphaned ACM certificates** (above). Delete or keep — operator's call.
2. **Orphaned S3 bucket `www.devaultsecurity.com`.** The bucket exists, but DNS points `www` at
   Amplify, so nothing serves from it. Almost certainly a remnant of the retired architecture.
   Not investigated further; not touched.
3. **`face-bucket-temp`** — a bucket named "temp" is a standing invitation to ask whether it should
   still exist. Noted only.

None of these gate `0015`.

## Secret scan — 2026-08-30 (ticket 0004)

Full-history `gitleaks detect` over the repository, run after the initial commit:

```
[90m10:09PM[0m [32mINF[0m [1m1 commits scanned.[0m
[90m10:09PM[0m [32mINF[0m [1mscanned ~2070947 bytes (2.07 MB) in 197ms[0m
[90m10:09PM[0m [32mINF[0m [1mno leaks found[0m
exit code: 0
```

Clean. Two layers are in place (`08-security-privacy.md` §7.3):

1. **Pre-commit**, `.githooks/pre-commit` — `gitleaks protect --staged` plus five literal
   patterns. `core.hooksPath` is set to `.githooks`, so the hook is version-controlled and
   applies to every clone, unlike `.git/hooks`.
2. **CI**, `.github/workflows/secret-scan.yml` — `gitleaks detect` on full history with
   `fetch-depth: 0`, on every push to `main` and every PR.

**The hook rejected the initial commit on its first attempt.** Two tickets contained key-shaped
literals: `0122` carried a real access key id written there during the 0002 audit, and `0004`'s own
operator-validation step spelled out AWS's documentation key as a test example. Both were rewritten
to describe the shape rather than spell it. Recorded because it is the cheapest possible evidence
that the guard works — it caught its author on the first commit of the project.

**Layer independence, demonstrated rather than assumed.** Probing all five patterns:

| Probe | gitleaks | literal grep |
|---|---|---|
| Real AWS key id | ✅ caught | ✅ caught |
| AWS documentation key (`…7EXAMPLE`) | ✗ allowlisted | ✅ caught |
| GitHub PAT `ghp_…` | ✅ caught | ✅ caught |
| A PEM private-key header line | ✗ missed | ✅ caught |
| Slack `xoxb-…` | ✗ missed | ✅ caught |
| Ordinary text (negative control) | — | — passes, commit succeeds |

The grep layer is not redundant. It caught four of five where gitleaks alone would have passed
three of them.

**A second issue, found by the guard blocking its own documentation.** The table above originally
spelled out the PEM header literally, and the literal-pattern layer flagged the capability doc as
containing a private key. A scanner that cannot distinguish documentation *about* a secret from a
secret will be switched off by whoever it blocks at 11pm, so the layer now honours
`gitleaks:allow` — gitleaks' own marker, reused so both layers respect one convention. Deny by
default, allow by **visible** exception: the marker sits on the line, in the diff, where a
reviewer sees it. The row above was reworded rather than exempted, because describing the pattern
reads better than quoting it.

**One bug found and fixed while testing:** `grep -qE "$p"` parses a pattern beginning `-----BEGIN`
as command-line options and errors, silently skipping that check. Fixed with `grep -qE --`. Without
the deliberate probe this would have shipped as a check that never ran.

## Close audit — 2026-08-30 (D-153)

Run by hand; `/tickets audit` does not exist until ticket 0121.

### §1 Automated

| Check | Result |
|---|---|
| `tsc` / ESLint / `vitest` | **N/A** — no code exists. This capability is repo and process. |
| Invariant sweep `I-1`…`I-30` | **N/A** — no data layer yet. |
| Boundary greps (no Strava in `domain/`) | **N/A** — no `src/` yet. |
| Vigil test (adding a skill is a data row) | **N/A** — no rules file until 0028. |
| Ticket validation | ✅ **122 tickets, 0 errors, 0 dangling refs, 0 cycles.** Every closed ticket carries `## Resolution`; every ticket has all four required body sections. |
| `gitleaks detect` full history | ✅ 3 commits scanned, no leaks. |

### §2 Design conformance — **2 divergences, under the budget of 3**

Both resolved as **design was wrong** → docs amended, decisions recorded in the same commit.

1. **husky + lint-staged → `.githooks/pre-commit`** (D-155). Husky needs a `package.json` that does
   not exist until 0012. `.githooks` meets the intent and is version-controlled.
2. **GitHub secret scanning / push protection unavailable** (D-156). Requires Advanced Security,
   which a private personal repo lacks. Compensating control pushed into 0019: the capture endpoint
   must scan its own payload, because it commits through the GitHub API and bypasses the local hook.

**Not counted as divergences** — corrections made *during planning*, before the capability began,
and already reflected in the tickets: the remote-creation step moving from 0003 to 0004, `CLAUDE.md`
being pre-written, 0006 closing on arrival, and the stale 50 m reveal radius in `09-roadmap.md`.
Counting planning corrections as implementation drift would inflate the number and make the drift
budget meaningless.

**Canonical contract** (`contracts/ingestion-contract.md`): untouched — nothing in this capability
implements it. Still accurate.

### §3 Operator validation

| Ticket | Validated |
|---|---|
| 0001 | ✅ Operator confirmed apex + `www` in a desktop browser, and the apex on Android over mobile data. |
| 0002 | ✅ IAM console shows the new key; `settings.local.json` is clean; `git status` clean. |
| 0003, 0005, 0120 | ✅ Verified by the agent against objective criteria (file contents, index probes). |
| 0004 | ⏳ **Outstanding** — the operator has not yet opened the GitHub repo in a browser to confirm the tree. Low risk (verified via `git ls-tree` against `origin/main`) but not the same check. |

### §4 Regression

No earlier capability exists. `explored-r10.bin`, XP totals: N/A.

### §5 Cost and hygiene

- **Active NAT gateways: 0.** The D-081 tripwire is clean — a NAT gateway appearing anywhere means
  something has gone badly wrong.
- AWS spend to date: **$0** of new resources. Only IAM key operations and read-only queries.
- No `blocked_by` pointing at a closed ticket (two apparent hits were body text describing the
  field, not frontmatter).
- Scope discovered mid-capability was filed, not absorbed: **0122** (dormant key), and the 0019
  requirement from D-156.

### §6 Reflection

**What the design got wrong.** Two criteria in 0004 were unbuildable as written — one because of a
tool ordering dependency (husky before `package.json`), one because of a GitHub licensing
constraint nobody checked during planning. Both were cheap to discover *because the tickets stated
them precisely enough to fail*. A vaguer criterion ("add secret scanning") would have been marked
done and the push-protection gap would have gone unnoticed until capability 03 shipped.

**What the design got right, non-obviously.** The gitignore assertion criteria. `.gitignore` looked
correct and was not — `.claude/` excludes the directory so git never descends into it, and the `!`
un-ignore for the tickets skill silently did nothing. Only the explicit
`git check-ignore` assertion caught it. Likewise the deliberate hook probe found a `grep` bug that
would have shipped a check that never ran.

**The guard caught its author twice**, on the first two commits of the project. That is the single
most useful signal from this capability: the scanning layer is real, not decorative.

**Estimate vs actual.** Roadmap estimated capability `00` at 11 tickets. Actual: 8 (0006 closed on
arrival as a planning artifact, 0120 and 0122 added). Sessions: 2, against an estimate of 2-3.

**What the next capability should do differently.** Capability `01` builds `tickets.mjs` and the
`/tickets` skill — the tooling that replaces the hand-validation used here. Its ticket 0011 should
treat *this* audit's ad-hoc validator output as the baseline to beat, and 0011's deliberate-error
injection is now the load-bearing part of that ticket rather than a formality: the seed backlog is
already clean, so a validator that finds nothing proves nothing.

### Verdict

> ✅ **Capability `00` passes**, with one carry-forward: **0122 remains open**, awaiting a 24-48h
> soak before the dormant key is deleted. That is elapsed time, not work. Capability `01` may start.

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

