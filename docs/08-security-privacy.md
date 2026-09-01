# 08 — Security & Privacy

**Status:** design, planning phase. No code exists.
**Scope:** the whole system as designed in `01-architecture.md`, `03-integrations.md`,
`07-ticketsmith.md`, under the constraints of `docs/decisions/DECISIONS.md`.

This is a **single-user application** (D-014: the owner plus up to ~5 friends/family, someday)
running on the owner's own AWS account, at a target cost of $3–5/month (D-083). The security
posture is calibrated to exactly that. This document is deliberately short in the places where
the honest answer is "this does not matter here," and deliberately long in the three places
where it genuinely does:

1. **A lifetime GPS history is among the most sensitive personal datasets that exists.**
   It is a continuously-updating record of where one person lives, works, sleeps, and when
   they are predictably away from home. D-020 makes it permanent and D-121 makes it
   full-fidelity. §2 is the most important section in this document.
2. **The system holds real credentials with real blast radius** — a rotating OAuth refresh
   token per user, a GitHub PAT with write access to the source repository (§7 of
   `07-ticketsmith.md`), and AWS deploy credentials. §3.
3. **There is exactly one unauthenticated, internet-facing endpoint** — the Strava webhook
   Function URL, `authType: NONE` because Strava cannot authenticate itself. §4.

Everything else is either handled by AWS defaults or is not a real risk at this scale, and
§9 says so explicitly so that a future reader does not mistake calibration for oversight.

## Contents

1. Threat model, stated plainly
2. The GPS sensitivity problem — and the D-123 revisit trigger
3. Secrets inventory
4. The webhook endpoint
5. Authentication and account provisioning
6. Data lifecycle, retention, and deletion
7. Repo hygiene — and one live finding (O-005)
8. Incident playbook
9. What we are deliberately not doing

---

## 1. Threat model, stated plainly

### Who is actually in scope

Nobody is hunting this application. It has one user, no revenue, no brand, no competitors, and
no name anyone recognises. Every realistic bad outcome here is **self-inflicted or
opportunistic**, not adversarial. The ranking below is by likelihood, and effort should be
spent strictly in that order.

| # | Threat | Likelihood | Impact | Where it is addressed |
|---|---|---|---|---|
| **T1** | **Credential leakage through the repo** — a secret committed by the operator, by an agent, or by a `git add .` that sweeps up a tool config | **High.** This is the one that actually happens, and it has already nearly happened once (O-005, §7) | Depends on the credential: repo write, AWS account, or the user's Strava history | §3, §7, §8 |
| **T2** | **Abuse of the public webhook endpoint** — automated scanners find every Lambda Function URL eventually | **Medium-high** that it is *probed*; low that it is meaningfully abused | No data disclosure. The realistic harm is **cost**: an attacker cannot read anything but can try to run up a bill | §4 |
| **T3** | **S3 or IAM misconfiguration** — a bucket policy or an AppSync auth rule that exposes raw traces | **Medium.** Amplify Gen 2 generates a lot of IAM (`01-architecture.md` §1.6) and generated policy is easy to stop reading | **Severe.** This is the GPS history (§2) | §6 |
| **T4** | **Dependency supply chain** — a compromised npm package in the build, or in a Lambda bundle | **Medium** across a multi-year project; **low** per-deploy | Ranges from nuisance to full credential theft from the build environment | §7 |
| **T5** | **Third-party breach at Strava** | Low, and entirely outside our control | The same data, already held by Strava | Out of scope: this is not our data to protect at that boundary |
| **T6** | **Targeted attacker** — a human who specifically wants *this* user's location history | **Low** | Severe | §2, and honestly: §1's note below |

### Why "targeted attacker" is ranked last

Ranking a targeted attacker low is a deliberate, stated judgement, not an omission.

A person who specifically wants this user's whereabouts has cheaper paths that do not involve
attacking an AWS account: the user's Strava account itself (which holds the same traces and has
a real password-reset attack surface), their phone, their physical mail, or simply following
them. Building defences here that assume a motivated human adversary — WAF, anomaly detection,
geo-fencing, tamper-evident logging — would consume the entire budget defending the *most
expensive* route to data available by several *cheaper* routes.

The correct response to T6 is not infrastructure. It is (a) not leaking credentials (T1),
(b) not exposing the bucket (T3), and (c) the §2 trigger checklist, which is what actually
prevents the data being handed to someone by accident.

**However**: T6's *impact* is why T1 and T3 are ranked so high despite being boring. The reason
credential hygiene matters here more than it would for a to-do app is precisely that the payload
behind the credential is a map of one person's life. Low-likelihood, high-impact threats are
managed by making the high-likelihood *paths to them* impossible, not by defending the endpoint.

### Explicitly out of the threat model

- **Insider threat.** There is one insider and they own the account.
- **Multi-tenancy isolation as a security boundary.** There is no tenancy. Cognito owner-scoping
  (§5) exists to prevent *mistakes*, not to contain an adversary who already has an account.
- **DDoS.** The app has one user; there is no availability SLA. Cost, not uptime, is the concern
  (T2, §4).
- **Compliance regimes.** No GDPR data controller obligations toward third parties beyond the
  handful of friends in D-014 (see §6), no HIPAA, no SOC 2, no PCI. There is no payment path.

---

## 2. The GPS sensitivity problem — and the D-123 revisit trigger

### 2.1 What the system actually accumulates

Lost Soles is, viewed uncharitably, a machine for building a permanent, high-resolution,
append-only record of one person's physical movements. Three settled decisions make this
unavoidable, and each is correct for the product:

- **D-020** — revealed territory is permanent forever. The map only ever grows. There is no
  expiry, no rolling window, no forgetting.
- **D-121.3/.4** — ingest uses `activity:read_all` scope and the full `latlng` stream, never
  `summary_polyline`. The lesser scope was rejected *specifically because* Strava's privacy-zone
  truncation would permanently blank the map around home (`03-integrations.md` §2.2). We
  deliberately opted **out** of the upstream privacy control because it damages the product.
- **D-101/D-121.2** — every raw trace is archived verbatim to S3 and is the system of record.
  Nothing is downsampled on the way in.

The derived H3 res-10 cell set (D-115) is not a mitigation either. A res-10 cell is roughly
65 m across. The cell containing a residence, weighted by `lastRunAt` frequency (D-120), is a
home address to within a house or two — and the *shape* of the explored set around a start point
is a stronger signal than any single cell. Aggregation does not anonymise a set of one person.

**Stated plainly: this dataset can answer "where does this person live, and when are they
reliably not there."** That is the sensitivity class we are operating in. Every control in
§3, §4, §6 and §7 exists to protect this and nothing else.

### 2.2 The decision as it stands: D-123

**D-123 is settled and is respected here.** There is **no** special home-location handling:

- No home-radius truncation, no start/end clipping, no fuzzing, no privacy zones.
- Full-fidelity traces stored and rendered.
- Rationale, as recorded: single-user app, private AWS account, map shown only to the owner.

This is the right call **for exactly the conditions it was made under**. Masking home for an
audience of one who already knows where they live is pure cost: it corrupts the archive
(D-101 says the archive is the system of record — a masked archive is a lossy one), it blanks
the map in the densest, most-run part of the user's territory, and it protects against nothing,
because the only viewer is the subject.

**Nothing in this section weakens D-123. This section is the tripwire under it.**

### 2.3 The contradiction that must be wired, not caveated

D-123 and D-014 cannot both remain true indefinitely.

- **D-123** justifies zero masking with the premise *"map shown only to the owner."*
- **D-014** plans for the owner **plus up to ~5 friends and family**.

The moment a second account exists, D-123's stated premise is false. Not "weakened" — false.
And D-123's own text carries a REVISIT TRIGGER for precisely this, which the architecture doc
also records as a standing condition (`01-architecture.md` §7).

A revisit trigger written as prose is a caveat, and caveats are not enforced. The rest of this
section converts it into something a person or an agent can actually check.

### 2.4 THE D-123 TRIGGER — three conditions, each with a hard gate

> **Standing rule.** If any of the three conditions below becomes true — or is *proposed* in a
> ticket, a design doc, or a PR — **D-123 is reopened before that work merges.** Reopening means:
> a new decision (`D-2xx`) is recorded in `docs/decisions/DECISIONS.md` explicitly superseding or
> re-affirming D-123 with its new premise stated, and the gate checklist below is complete.
> "It's fine, it's still just me" is not a resolution; a recorded decision is.

---

#### TRIGGER A — a second user account is created

**Fires when:** any Cognito user exists in the production pool other than the owner. Not when
friends are "planned" — when the second account is *provisioned* (§5.3). Also fires on a shared
login, which is the same thing with worse accountability.

**Gate — all must be true before the second account can sign in:**

- [ ] **A-1. Owner-scoped data access is proven, not assumed.** Every `ExploredCell`, `Activity`,
      `Trace`, and `SourceAccount` read path is scoped by Cognito `sub`. Every S3 prefix is under
      `entity('identity')` or an explicit `raw/<uid>/` IAM condition. Proven by a test that signs
      in as user B and asserts a 403/empty on user A's `uid` — an actual failing-then-passing
      test, not a code review.
- [ ] **A-2. No cross-user aggregate exists.** No shared map layer, no combined explored set, no
      "total territory" across users, no leaderboard (D-011 already forbids competition —
      this makes it a *security* requirement as well as a product one).
- [ ] **A-3. Per-user fidelity policy exists as data.** Whatever D-2xx decides, the setting lives
      on the user record and is enforced at *render and export* time, not only at ingest —
      because the archive (D-101) is full-fidelity by design and always will be.
- [ ] **A-4. Onboarding discloses what is stored.** A friend consents to a permanent,
      unmaskable, full-fidelity trace archive, in plain words, before their first ingest.
      They are not the owner; they cannot be assumed to have accepted D-123.
- [ ] **A-5. Deletion works for them** (§6.4), and has been executed once against a test account.
- [ ] **A-6. `/api/dev/tickets` remains owner-only** — already required by
      `07-ticketsmith.md` §6.4(1), restated here because it becomes load-bearing at this moment.
- [ ] **A-7. D-123 reopened and a successor decision recorded.**

**What must be BUILT before Trigger A:** A-1 (owner-scoping tests), A-3 (a fidelity field on the
user record, even if every user is set to `full`), A-4 (a consent screen), A-5 (a working delete).
Roughly: *the multi-user story is not "add a Cognito user," it is these five items.*

---

#### TRIGGER B — any share, export, or screenshot feature is proposed

**Fires when:** a ticket or design proposes *any* of — a share button, an image export, an
"export my map" download, a social card, an OG image, a printable poster, a GPX/GeoJSON export,
an embeddable widget, or a screenshot helper. **Fires at proposal time, not at implementation
time**, because the design of a share feature is where the privacy decision actually gets made.

**Gate — all must be true before the feature is designed, let alone merged:**

- [ ] **B-1. The shared artifact is a different artifact.** A share view is not the owner's view
      with a share button on it. It renders from a **separate, explicitly-constructed payload**
      whose fields are enumerated in the ticket. Never "the same map, screenshotted."
- [ ] **B-2. Home-region handling is decided and implemented in that payload.** The minimum
      viable answer is a configurable exclusion radius around a user-set home point, applied to
      the *shared* payload only (the archive stays full-fidelity per D-101). This is the
      specific thing D-123 declined to build; a share feature is what makes it necessary.
- [ ] **B-3. Zoom and resolution are capped in the shared artifact.** Res-10 cells at high zoom
      near a start point are an address. A share view caps zoom, or renders at a coarser
      aggregation, or both.
- [ ] **B-4. No raw trace geometry leaves the system.** Shares render *cells*, never `latlng`
      streams. A GPX/GeoJSON export of raw traces is a separate, explicitly-decided feature with
      its own D-number, not a side effect of a share button.
- [ ] **B-5. Timing metadata is stripped or coarsened.** `lastRunAt` per cell (D-120) is a
      schedule. Shared payloads carry no per-cell timestamps finer than "explored / cold."
- [ ] **B-6. The share is revocable and finite.** If a share produces a URL, it expires, and
      revoking it actually stops serving. If it cannot be revoked, it is a download, and
      B-1..B-5 apply doubly.
- [ ] **B-7. D-123 reopened and a successor decision recorded** — with the mask/exclusion
      behaviour written down as the decision, not as an implementation detail.

**What must be BUILT before Trigger B:** B-2's home point + exclusion radius (a user setting and
a filter function), B-1's separate share payload type, and B-5's timestamp-stripping. There is
no version of a share feature that is cheaper than this, and anyone who thinks there is has
mistaken "screenshot the existing map" for a feature.

---

#### TRIGGER C — any public URL serves cell data

**Fires when:** any HTTP response reachable **without a valid Cognito session** contains
explored-cell data, trace geometry, activity coordinates, or anything derived from them.
This includes: an unauthenticated API route, a public S3 object, a public R2 object, an ISR/SSG
page rendered with real data, a cached CDN response, an OG-image endpoint, a status page, and a
"just for testing" endpoint.

**Gate:**

- [ ] **C-1. Enumerate the surface.** Every public path is listed: the webhook Function URL (§4),
      the sign-in page, static assets, and the R2 tile bucket. **The tile bucket serves the
      basemap only** — generic pmtiles, identical for every user, containing zero Lost Soles
      data. It must stay that way: *the explored set is never baked into a tile on R2.*
- [ ] **C-2. Prerendering is proven safe.** Amplify's SSG/ISR behaviour
      (`01-architecture.md` §1.5, §11) means a page rendered at build time is a static file on a
      CDN. **No page containing cell data may be statically rendered.** The explored set is
      fetched client-side against an authed endpoint, or server-rendered per-request with the
      session in hand. A CI check asserting that no built artifact under `.next/static` or the
      prerender manifest contains cell/trace data belongs here.
- [ ] **C-3. `Cache-Control` on every authed response is `private, no-store`.** A shared CDN
      cache in front of a per-user map is a cross-user disclosure waiting for a second account.
- [ ] **C-4. `explored-r10.bin` is served authenticated.** The binary explored set
      (`01-architecture.md` §2, §9) is the whole dataset in one file. It is fetched with
      credentials from an owner-scoped S3 prefix via a short-lived signed URL or an authed
      route — never a public object, never a predictable key.
- [ ] **C-5. D-123 reopened** if the answer to any of the above is "we serve it publicly."

**What must be BUILT before Trigger C:** honestly, nothing new — C-1..C-4 are constraints on how
MVP is built, not features. **This trigger's job is to stop C from happening by accident**, which
is why it is written as an audit rather than a backlog.

---

### 2.5 Where this checklist lives so it is actually enforced

A checklist in a design doc that nobody opens is decoration. Three placements, all cheap:

1. **`CLAUDE.md` carries a short standing note** pointing at §2.4 by name, in the same place it
   points at `DECISIONS.md`. Any agent starting a session reads it.
2. **The ticket template's `## Operator validation` section** (`07-ticketsmith.md` §3.5 — already
   non-negotiable) gains one line for tickets touching auth, sharing, export, or public routes:
   *"D-123 trigger checked? A / B / C / none."*
3. **`/tickets triage`** (`07-ticketsmith.md` §4.5) flags any inbox capture whose title or body
   matches `/share|export|screenshot|public|friend|invite|account|signup|poster|embed/i` as
   **needs D-123 review** before it is numbered.

That is the whole enforcement mechanism. It costs one line in a template and one regex.

---

## 3. Secrets inventory

Every credential the system holds. Two stores, chosen by rotation frequency and ownership
(`01-architecture.md` §7): **static application config in SSM Parameter Store** via Amplify's
`secret()`; **per-user rotating credentials in DynamoDB**. AWS Secrets Manager is deliberately
unused at $0.40/secret/month (§9).

| # | Credential | Lives in | Read by | Blast radius if leaked | Rotation |
|---|---|---|---|---|---|
| S1 | `STRAVA_CLIENT_ID` | SSM, via `secret()` | callback route, `process-activity`, `token-refresh` | Effectively none — it appears in the OAuth authorize URL and is semi-public. Kept server-side anyway, to avoid building the habit | Regenerate in the Strava developer console; update SSM; redeploy |
| S2 | `STRAVA_CLIENT_SECRET` | SSM, via `secret()` | callback + token refresh Lambdas only. **Never leaves a Lambda** | **High.** With a refresh token it mints access tokens for the user's Strava account; alone it lets an attacker complete OAuth flows impersonating the app | Strava console → regenerate → `ampx sandbox secret set` / Amplify console → redeploy. **Existing refresh tokens survive**, so this is a low-drama rotation |
| S3 | `STRAVA_WEBHOOK_VERIFY_TOKEN` | SSM, via `secret()` | `strava-webhook` GET handshake only | Low. An attacker who has it can complete a handshake they have no use for. It does **not** authenticate POSTs (§4.1) | Generate a new random string, update SSM, `DELETE` and recreate the subscription (`03-integrations.md` §2.3). One subscription per app, so this is a brief outage — do it deliberately |
| S4 | **Per-user Strava OAuth `refreshToken` + `accessToken`** | DynamoDB `LostSolesSourceAccount`, encrypted at rest, IAM-granted to exactly three principals | `process-activity`, `token-refresh`, `/api/strava/callback` | **The highest in the system.** A refresh token plus S2 yields the user's entire Strava history — every GPS trace, indefinitely, silently. This is the T6 payload from §1 | **Rotates on every refresh, automatically** — Strava may return a new refresh token on any refresh (`03-integrations.md` §2.2). Manual revocation: `POST /oauth/deauthorize`, then delete the row. Rotation is a *feature* here, not a chore |
| S5 | **GitHub fine-grained PAT** (ticket commits) | SSM, via `secret()`; read by the `/api/dev/tickets` Lambda only | the capture endpoint's server-side GitHub call | **High and non-obvious.** It writes to the source repo. Constrained to *one repo*, **Contents: read/write, nothing else**, 90-day expiry (`07-ticketsmith.md` §6.2). Even so: repo write → `.github/workflows/` → CI execution. The §6.4 path constraints mean *our endpoint* cannot write there; a **stolen token has no such constraint** | Revoke in GitHub settings (one click), issue a new PAT, update SSM. 90-day expiry forces the habit. **v2 (§6.3 of that doc) replaces it with a GitHub App issuing 1-hour installation tokens — that is the real fix, and this row is why it is worth doing** |
| S6 | **GitHub webhook secret** (push → cache refresh) | SSM, via `secret()` | `/api/dev/tickets/webhook` HMAC verification | Low-medium. Forging deliveries lets an attacker make the ticket browse cache say anything; it grants no repo write | Rotate in the repo webhook settings + SSM together |
| S7 | `INGEST_BEARER_TOKEN` (post-MVP, D-112/D-113) | SSM, via `secret()` | `/api/ingest` | Medium. Lets an attacker inject fabricated traces — a data-integrity problem, not a disclosure one. Note it can also *reveal* nothing | Change the parameter and the device config. Per-device tokens when there is more than one device |
| S8 | **AWS deploy credentials** | Amplify Hosting's GitHub connection (an OAuth app/installation, not a stored key) + the operator's local `~/.aws/credentials` for `ampx sandbox` | Amplify build, the operator's machine | **Total.** Account-level compromise: the S3 archive, DynamoDB, Cognito, billing. This is the O-005 class of finding (§7) | IAM: deactivate → create new → verify → delete old. Prefer **IAM Identity Center / short-lived SSO credentials over long-lived access keys on the laptop**; a long-lived `AKIA…` on disk is what §7 is about |
| S9 | **Map tile access** | *None.* pmtiles on Cloudflare R2, fetched by HTTP range from the browser (`01-architecture.md` §8) | the browser | **No credential exists.** The bucket is public-read by design and contains a generic basemap identical for every user, with zero Lost Soles data in it | n/a — see the §2.4 C-1 constraint: no explored data ever gets baked into a tile |

### 3.1 What must never reach the browser bundle

Restating `01-architecture.md` §7 because it is the rule that gets broken:

- **No OAuth token of any kind** — access or refresh, Strava or otherwise. The code exchange
  happens entirely inside `/api/strava/callback`; the browser sees a redirect and a `connected`
  boolean.
- **No client secret, no webhook verify token, no GitHub PAT, no ingest bearer token.**
- **No AWS credential** beyond the Cognito-vended, identity-scoped temporary credentials the
  Amplify client obtains for the user themself.
- **The client never talks to Strava or GitHub directly.** All third-party traffic originates
  from a Lambda.

**Enforcement:** a CI step greps the built `.next/static` output (and every Lambda bundle) for
the literal values of S1–S7 and **fails the build on a hit**. It is ten lines of shell, it runs
on every deploy, and it catches the single mistake that actually matters. Extend the same grep
to a generic-pattern pass — `AKIA[0-9A-Z]{16}`, `ghp_`, `github_pat_`, `-----BEGIN .* PRIVATE
KEY-----` — so it also catches secrets it was never told about.

**Logging:** the logger carries redaction rules for `ghp_` / `github_pat_` prefixes
(`07-ticketsmith.md` §6.2), `Bearer ` values, and the field names `refreshToken` / `accessToken`
/ `client_secret`. CloudWatch log groups get a **30-day retention** — logs are the other place
secrets and coordinates leak, and an unbounded log group is both a liability and a bill.

**Not secrets, and must not be mistaken for leaks:** `amplify_outputs.json` (Cognito pool ID,
app client ID, identity pool ID, AppSync endpoint) and `TILES_BASE_URL`. These are public
identifiers protected by policy, not obscurity. `amplify_outputs.json` is gitignored because it
is generated per-environment, not because it is sensitive.

---

## 4. The webhook endpoint

`strava-webhook`, a dedicated 128 MB Lambda behind a **Function URL with `authType: NONE`**
(`01-architecture.md` §2). This is the only unauthenticated, internet-facing surface in the
system, and it exists because **Strava cannot sign requests, cannot present IAM credentials, and
publishes no source IP range to allowlist** (`03-integrations.md` §2.3). The endpoint is public;
this section treats it as such.

The hard constraint that shapes everything: **Strava requires a 200 within 2 seconds** or it
retries and eventually disables the subscription — of which there is exactly one, per
application, ever.

### 4.1 Verifying events actually came from Strava — honestly

**We cannot.** Strava sends no signature, no HMAC, no shared secret on the POST. Any claim to
"verify the webhook" here would be false. What we have instead is a chain of cheap filters that
make a forged event **worthless rather than blocked**:

1. **`subscription_id` must match ours.** A trivially guessable-if-observed integer; it filters
   noise, not attackers.
2. **`object_type` must be `activity`** (or `athlete` for deauthorization). Everything else:
   `200`, drop.
3. **`owner_id` must map to a known `SourceAccount`** via the `externalUserId` GSI. Events for
   athletes we do not know are dropped. Note the lookup happens **downstream** in
   `process-activity`, not in the webhook — the webhook has *no IAM grant on that table*
   (`01-architecture.md` §7), deliberately, to keep the public endpoint's blast radius near zero.
4. **The forged event is then self-defeating.** The worst an attacker with a valid-shaped forgery
   achieves is causing `process-activity` to ask *Strava* for an activity id, using *our* token,
   for *our* athlete. Strava returns 404 for an id that is not ours. **The attacker cannot inject
   data; they can only ask us to re-fetch our own.** That is the actual security property, and it
   comes from the architecture — the payload is a *notification*, never a data carrier.

**The rule that guarantees it: the webhook body is never trusted as data.** No coordinate, no
distance, no timestamp, no name from a webhook payload ever reaches the domain model. The
payload's only job is to name an id we then fetch authoritatively.

### 4.2 The `hub.challenge` handshake

```
GET ?hub.mode=subscribe&hub.challenge=X&hub.verify_token=T
  → constant-time compare T against secret("STRAVA_WEBHOOK_VERIFY_TOKEN")
  → mismatch: 400, no body detail, no log of T
  → match:    200, Content-Type: application/json, body exactly {"hub.challenge": X}
```

- **Constant-time comparison**, not `===`. Cheap, and the alternative is a timing oracle on a
  public endpoint.
- **The JSON key is literally `hub.challenge`, with a dot** (`03-integrations.md` §2.3). Not
  `hub_challenge`. This is a functional trap, noted here because it is the one that costs an hour.
- **`hub.challenge` is echoed, never interpreted.** Cap it at 256 bytes, reject anything
  non-`[A-Za-z0-9]`, and echo it as a JSON string value — it is attacker-controlled input being
  reflected, which is the classic shape of an injection bug even when the sink looks inert.
- **This route is live only during subscription creation** (once, ever). It stays deployed
  because Strava may re-validate, but a GET is otherwise a scanner.

### 4.3 Replay and idempotency

Strava retries up to three times and has no dead-letter mechanism, so duplicates are **normal
traffic**, not an attack signature. The webhook is idempotent by construction
(`01-architecture.md` §2, §4):

```
ingestKey = sha256(`strava:${owner_id}:${object_id}:${aspect_type}`)
ConditionalPut IngestReceipt {ingestKey, status:"QUEUED"}  if attribute_not_exists
  → ConditionalCheckFailed → 200 immediately (already handled)
  → else SendMessage to ActivityIngestQueue → 200
```

The `IngestReceipt` ledger is the replay defence *and* the flood defence: a replayed or forged
duplicate costs one conditional write and terminates. Downstream, `activityId` is
`sha256(user, source, externalId)` (D-140) precisely so replay is deterministic and cannot
double-award XP. Give `IngestReceipt` rows a **TTL of ~30 days** — long enough that no legitimate
retry outlives it, short enough that the table stays free.

### 4.4 Rate limiting and cost-DoS

An attacker cannot read anything here. They can try to **spend our money** — which against a
$3–5/month budget is a real threat, if an unexciting one. Layered, cheapest first:

1. **Lambda reserved concurrency on `strava-webhook`: set it, low — 5 is generous.** This is the
   single most important control in this section. It bounds the blast radius of any flood to a
   fixed, small number of concurrent 128 MB invocations, and it protects the *rest of the
   account*: without it, a flood can exhaust regional concurrency and starve `process-activity`
   and the SSR functions. One CDK line.
2. **A hard payload cap.** Reject any request with `Content-Length` > **8 KB**, before parsing —
   Strava's events are a few hundred bytes. Reject `Content-Type` that is not JSON. Reject any
   body that fails to parse, with a 200 and no detail (a 400 is a free oracle; Strava does not
   care either way).
3. **Reject unknown fields rather than ignore them**, matching the ticket endpoint's rule
   (`07-ticketsmith.md` §6.4). A payload with 10,000 keys is a parser-cost attack.
4. **Method allowlist: GET and POST only.** Everything else 405 without a body.
5. **The `IngestReceipt` conditional write is itself a limiter** (§4.3) — floods of the *same*
   event cost one write each and never reach SQS.
6. **A per-`owner_id` counter** in the receipt table with a TTL: more than ~50 events/hour for
   one athlete is not a human running, it is a loop. Drop with a 200 and alarm.
7. **AWS Budgets alarm at $10/month and $25/month, notifying by email.** This is the real
   backstop and it takes five minutes. Cost-DoS is only dangerous when it is *silent*; an alarm
   converts an unbounded bill into a bounded one.
8. **SQS DLQ already exists** (`01-architecture.md` §1, item 10) so a poison message cannot spin.

Explicitly **not** doing: WAF ($15/month per app, ~5× the entire budget — §9), API Gateway
throttling (the reason for choosing a Function URL was to avoid its cost and its hop), or
CAPTCHA-style challenges (Strava would fail them).

### 4.5 What the endpoint must never do

The 2-second budget is a security control as much as a performance one: the smaller this
function is, the less there is to attack.

- **No network calls.** No Strava API call, no token refresh, no S3, no AppSync, no `h3` import.
  A cold start on a fat bundle blows the deadline and disables the subscription.
- **No credential access.** Its only secret is `STRAVA_WEBHOOK_VERIFY_TOKEN`. It holds **no IAM
  grant on `LostSolesSourceAccount`** — the public endpoint can never read a token, by policy,
  not by discipline.
- **No writes outside `IngestReceipt` and the SQS queue.** Two grants, both narrow.
- **It is not a Next.js route handler.** Restating `01-architecture.md` §2: the SSR bundle's cold
  start risks the deadline, and it redeploys on every frontend change, meaning a UI tweak could
  silently drop webhooks.
- **No logging of full payloads at INFO.** Log `ingestKey`, `aspect_type`, and a decision; not
  `owner_id` at INFO and never a body. Webhook payloads are the thin end of the GPS-data wedge
  ending up in CloudWatch.
- **Target p99 well under 500 ms.** If it creeps toward a second, something was added that
  belongs in `process-activity`.


---

## 5. Authentication and account provisioning

The whole auth surface serves **one person today and at most six ever** (D-014). That number is
not a limitation to design around; it is the design input. Every mechanism below is chosen
because it is *free, boring, and hard to misconfigure* at six users — not because it scales.

### 5.1 The configuration, and the two lines that matter

**Cognito user pool, Essentials tier, email + passkey, self-signup OFF**
(`01-architecture.md` §1, table row 2; research in `R5-aws-amplify.md` §3). Essentials includes
Managed Login and passwordless/passkey (WebAuthn) sign-in, with 10,000 MAU free and — confirmed
— **non-expiring**, so auth costs $0.00 forever at this scale (D-083).

Two settings in `amplify/auth/resource.ts` carry almost the entire posture:

```
allowUnauthenticatedIdentities: false      // no anonymous identity, ever
selfSignUpEnabled:              false      // no public registration endpoint
```

- **`selfSignUpEnabled: false` is non-negotiable and is the single most important line in the
  auth config.** A default-on Cognito pool is a public registration endpoint. Left on, an app
  whose entire threat model assumes "the only accounts are ones the owner created" would be
  false from the day it deployed — anyone on the internet could mint an account, and §2's
  Trigger A ("a second user account is created") would fire *without anyone noticing it had*.
  Self-signup is not a convenience we are declining; it is a hole we are not drilling.
- **`allowUnauthenticatedIdentities: false`** means the identity pool vends no guest
  credentials. Combined with `entity('identity')` S3 scoping (§6.2), there is no unauthenticated
  principal in the account that can touch storage at all.

**Also off / absent, deliberately:** no hosted social IdPs (Google/Facebook sign-in adds an
external trust dependency to buy nothing for six known humans), no SAML/OIDC federation, no
SMS MFA — SMS costs real SNS money and is the weakest second factor available. If a second
factor is ever wanted beyond passkeys, it is **TOTP**, which is free.

> **Superseded in part by D-175 (2026-09-01, ticket 0129) — read this before re-litigating.**
> The clause "to buy nothing for six known humans" is **wrong**, and the error is worth naming: it
> weighed a social IdP in isolation and never considered **one sign-in across the operator's own
> suite of apps on `devaultsecurity.com`**, because at the time nothing else was on that domain.
> `school-hub` now is. That is a real benefit to the actual and only user.
>
> The decided end state is **Auth.js with Google, displacing Cognito**, scheduled after
> `15-two-map-modes-and-cold-territory` and before `16-rebuild-drill` (ticket `0138`). Adding Google
> as a federated IdP *on this Cognito pool* is rejected permanently — it buys the external trust
> dependency and still requires two sign-ins, since `school-hub` uses Auth.js cookies, not Cognito.
>
> **Nothing in the paragraph above changes today**, and the rest of §5.1 is untouched:
> `selfSignUpEnabled: false` and `allowUnauthenticatedIdentities: false` are not what D-175
> supersedes. When Cognito goes, `selfSignUpEnabled: false` maps to Auth.js's
> `AUTH_ALLOWED_EMAILS` allowlist — Google sign-in without one is a public registration endpoint
> wearing a different hat, which is the very thing the bullet above calls the single most important
> line in the auth config.

**Verification gate on the pool itself:** self-signup and unauthenticated identities are two
booleans that a console click or a careless `defineAuth` edit can flip back. A one-line
post-deploy check — `aws cognito-idp describe-user-pool` asserting the admin-only signup policy
— belongs in the same CI step as the secret grep (§3.1). It is the cheapest possible guard
against the highest-consequence misconfiguration in the system.

### 5.2 Passkeys, and the recovery problem nobody plans for

**Passkeys are the primary and preferred factor.** For an Android-first app (D-124) this is
close to ideal: the credential lives in the Google Password Manager passkey store, syncs across
the user's devices, is phishing-resistant by construction, and there is no password to leak,
reuse, or rotate. Six users means zero password-reset support burden.

The honest weakness of a passkey-only pool at this scale is **recovery, not attack**:

- **Email OTP is the fallback factor**, and it is therefore the real security boundary — the
  account is ultimately worth exactly as much as the email inbox behind it. Say this plainly
  rather than pretending the passkey is the floor. The owner's email account should have its
  own MFA; that is outside this system but it is load-bearing for it.
- **Register at least two passkeys** (phone + laptop) for the owner account before the app
  holds anything worth keeping. A single-device passkey plus a lost phone is a lockout.
- **The break-glass path is the AWS console**, where the pool owner can trigger a password
  reset or delete and re-invite a user. This works because the account owner and the app owner
  are the same person. It is not a support process; it is a person with root on their own
  account, and it is sufficient for six users.
- Lockout risk is **operational, not adversarial** — the same shape D-121 identified for the
  Strava athlete cap: "the failure mode is friends being locked out, not data loss." The S3
  archive (D-101) and DynamoDB survive any auth mishap; a user pool can be rebuilt, and the
  data is keyed on a `uid` that a rebuilt pool must preserve (see 5.3, step 6).

### 5.3 Session handling

Amplify's client owns the token lifecycle; the rules are about where tokens live and how long a
session is worth.

| Concern | Decision |
|---|---|
| Token storage | Amplify's default (`localStorage` for the JWTs). Accepted: an XSS in this app can steal a session — but an XSS in this app can also just *read the map*, which is the asset. Cookie-based storage would not change the outcome, so it does not buy a defence, only complexity. The mitigation for XSS is a strict CSP and no `dangerouslySetInnerHTML`, not token gymnastics |
| Access / ID token TTL | **1 hour** (the default). Not extended |
| Refresh token TTL | **30 days**, sliding. Long enough that a phone stays signed in between runs; short enough that a stolen device goes stale on its own |
| Revocation | Token revocation enabled on the app client, so `globalSignOut` actually invalidates outstanding refresh tokens. Untested revocation is not revocation — exercise it once (§8) |
| App client secret | **None.** A public SPA/SSR client cannot keep one; a "secret" shipped to the browser is a lie in the config file |
| Server-side session use | The `(app)/layout.tsx` server component reads the Cognito session and every API route re-derives `sub` from the verified JWT (`01-architecture.md` §11). **`uid` is never read from a request body, a query string, or a header.** This is the same rule as §4's "the webhook body is never trusted as data" and `07-ticketsmith.md` §6.4(2)'s "the client never supplies the path" — one principle, three endpoints |
| CSRF | Bearer-token APIs with no cookie auth are not CSRF-reachable. Nothing to do; noted so nobody adds a token dance later |
| Headers | `Cache-Control: private, no-store` on every authed response (this is §2.4's C-3, restated as a session rule), plus HSTS, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`, and a CSP whose `connect-src` allows only the AppSync endpoint, the API origin, and the R2 tiles host |

### 5.4 Provisioning a second account — the flow, and its hard gate

There is **no invite feature, no signup page, and no "add a friend" button in the UI.** Adding a
user is an operator action: an admin script or console call that creates the Cognito user and
sends a one-time invite. That is the correct amount of machinery for an event that happens at
most five times in the product's life, and it means the *only* way a second account exists is
that the owner deliberately made it.

**This is where §2.4 TRIGGER A fires** — and the flow is written so that it cannot be completed
without confronting it. Not documented next to it: *blocked by it.*

The provisioning runbook, in order:

1. **Stop.** Creating this user makes D-123's stated premise ("map shown only to the owner")
   **false**, not merely weaker (§2.3). D-123's own REVISIT TRIGGER, as recorded in
   `DECISIONS.md`, requires the decision be reopened at this exact moment.
2. **Walk the Trigger A gate, A-1 through A-7 (§2.4).** All seven, ticked, with the four
   *build* items actually built: owner-scoped access tests (A-1), a fidelity field on the user
   record (A-3), a consent screen (A-4), and a delete path that has been executed once against
   a test account (A-5).
3. **Record the successor decision (`D-2xx`)** in `docs/decisions/DECISIONS.md`, superseding or
   re-affirming D-123 with its new premise written down. *"It's fine, it's just my brother"* is
   not a resolution; a recorded decision is (§2.4, standing rule).
4. **Only then**: `admin-create-user` with the friend's email, `MessageAction: SUPPRESS` or the
   default invite, and no temporary password shared over a chat app.
5. **The friend registers a passkey on first sign-in**, and passes the A-4 consent screen —
   which discloses, in plain words, that the system keeps a permanent, unmaskable,
   full-fidelity record of where they run (§2.1). They have not accepted D-123; nobody can
   accept it on their behalf.
6. **Their `uid` is the Cognito `sub`**, and it is the partition key for everything they own:
   DynamoDB rows, the `raw/<uid>/` S3 prefix, the `entity('identity')` storage path. Write it
   down at provisioning time. Rebuilding a user pool without preserving `sub` orphans a
   permanent map (D-020), and D-020 does not have a restore button.
7. **Then re-read §2.4 C-1..C-4.** A second account is what turns every "there is only one
   user, so it cannot leak across users" assumption in the codebase into a live bug.

**The engineering consequence, stated once:** *the multi-user story is not "add a Cognito
user."* It is the five build items above, and it is bigger than the auth work by an order of
magnitude. Anyone estimating "add friends" as a small ticket has not read §2.4.

### 5.5 Authorization, such as it is

With one user, authorization is nearly vacuous — which is exactly why it must be written as if
it were not, since §5.4 is designed to make a second user appear one day.

- **Every read and write is scoped by the JWT's `sub`.** Amplify Data's owner-based
  authorization on `Activity`, `Trace`, `ExploredCell`, and `SourceAccount`; `entity('identity')`
  on the storage paths. No model is `authenticated`-readable, because `authenticated` will one
  day mean six people.
- **There is exactly one privileged role: the owner.** It gates `/api/dev/tickets`
  (`07-ticketsmith.md` §6.4(1), restated in §2.4 A-6) and nothing else. It is a single `sub`
  compared against an SSM parameter — not a roles table, not RBAC. Six users do not need a
  permission system, and building one would create a second thing to get wrong.
- **Lambdas authenticate as themselves, not as users.** `process-activity` and `token-refresh`
  hold IAM grants on exactly the tables and prefixes they need (`01-architecture.md` §7), which
  is why the public webhook can hold none (§4.5).

---

## 6. Data lifecycle, retention, and deletion

### 6.1 What is retained, and for how long

| Data | Store | Retention | Why |
|---|---|---|---|
| Raw trace archive, `raw/<uid>/<adapter>/<externalId>/<sha256>.json` | S3 | **Forever.** No lifecycle expiry, no transition to Glacier | D-101: the archive is the system of record. D-121.2: it is what makes migrating off Strava non-destructive. ~40 MB over five years, ~$0.001/month (`01-architecture.md` §3) — there is no cost argument for deleting it, only a privacy one, and that is §6.4's job |
| `Activity`, `Trace` | DynamoDB | Forever | Derived, but cheap and re-derivable only via a full replay |
| `ExploredCell` (+ `lastRunAt`, D-120) | DynamoDB | **Forever, by decision** | D-020: the map only ever grows |
| `explored-r10.bin` | S3 | Regenerated, not retained | A materialized view of `ExploredCell` |
| `SourceAccount` (Strava tokens, S4) | DynamoDB | Until deauthorization | Deleted the moment the connection is removed (§6.5) |
| `IngestReceipt` | DynamoDB | **TTL ~30 days** (§4.3) | A replay ledger, not a record |
| CloudWatch logs | CloudWatch | **30-day retention** (§3.1) | Logs are where coordinates and secrets leak by accident; an unbounded log group is a liability and a bill |
| Cognito user | Cognito | Until account deletion | — |

**Nothing in this system expires on a timer except the two rows that are pure mechanism.** That
is the shape D-020 asks for, and it is stated as a table so that a future "add a 90-day
retention policy, it's good practice" instinct has something concrete to contradict.

### 6.2 The bucket, concretely

`lost-soles-storage` (`defineStorage`, `01-architecture.md` §1 row 9). Four settings, all
defaults-or-one-line, and all of them matter more than anything else in this section:

- **Block Public Access: ON, all four sub-settings, at the bucket *and* account level.** This is
  the control that makes the difference between "a private archive" and "a lifetime GPS history
  on the open internet." Amplify sets it; the account-level switch is what stops a future
  console click from undoing it. **The tiles bucket on Cloudflare R2 is public and this one is
  not — never confuse them** (§3, S9; §2.4 C-1).
- **Encryption at rest: SSE-S3 (AES-256), on by default.** Not KMS: a customer-managed key adds
  $1/month plus per-request charges against a $3–5 budget (D-083) and defends against a threat —
  AWS-internal or cross-account access to raw storage — that is not in §1's model. DynamoDB is
  likewise encrypted with the AWS-owned key.
- **Versioning: ON.** This is the ransomware and fat-finger control, and it is what makes the
  next bullet honest.
- **`DeleteObject` on `raw/*` denied by bucket policy to every principal except an explicit
  break-glass role** (`01-architecture.md` §3). No Lambda, no Amplify role, and not the
  operator's day-to-day credentials can delete an archived trace. Deletion of the archive is
  possible, but only by a person who has deliberately assumed a role whose only purpose is
  deletion. **That is the technical mechanism on which §6.4 turns.**

Also: **TLS in transit everywhere** (a bucket policy denying `aws:SecureTransport: false` costs
nothing), and **no S3 access logging** — at this volume it would cost more to store than it
could ever tell us.

### 6.3 The tension, stated and then resolved

**D-020 says the map is permanent forever. A deletion request must still be honourable.** These
look contradictory. They are not, and the resolution is worth writing down precisely, because
the wrong reading of D-020 — "we promised permanence, so we cannot delete" — is both ethically
indefensible and, once a second user exists (§5.4), probably unlawful.

**D-020 constrains the system's behaviour, not the user's rights.**

- D-020 is a promise about **time and mechanism**: territory does not expire, decay, roll off,
  get downsampled, get garbage-collected, or shrink when a source is disconnected. There is no
  process anywhere in this system that removes explored territory. The map only ever grows.
  *The system never forgets on its own.*
- Deletion is a promise about **agency**: the person the data is about can end it. Honouring
  that is not the system forgetting — it is the system being **switched off** for that person.
- The two therefore address different actors. **The only thing that can remove data is an
  explicit human instruction from the person the data describes, and when it comes, it removes
  all of it.** There is no third case. Permanence is the default and deletion is the exit; a
  door is not a hole in the wall.

Put in one line, and this is the line to quote when someone reopens it:

> **D-020 forbids the system from forgetting. It does not forbid the user from leaving.**

Two consequences fall straight out of that framing:

1. **There is no partial deletion of territory, and that is a feature.** "Delete the cells around
   my house" or "remove last Tuesday's run from the map" is precisely the selective erosion D-020
   exists to prevent, and it is unimplementable cheaply anyway: the explored set is a *union*
   over all traces, so un-exploring a cell means re-deriving from the archive and finding no
   other run ever touched it. If that feature is ever wanted, it is a **recompute from `raw/`,
   not a delete**, and it needs its own D-number. What someone actually wants when they ask for
   this is a **share mask** — which is §2.4's Trigger B, B-2, and belongs there.
2. **Account deletion is all-or-nothing, and it is complete.** No tombstones, no "anonymized
   analytics retained," no soft-delete row kept "for integrity." A res-10 cell set of one person
   is not anonymisable (§2.1); pretending otherwise by keeping a de-identified copy would be the
   dishonest version of this section.

### 6.4 Account deletion — the runbook

An operator action, like provisioning (§5.4), and for the same reason: it happens at most six
times ever. It is a **script in the repo**, written and tested before the second account exists
(§2.4 gate item **A-5** requires it to have been executed once against a test account — that is
not paperwork, it is the only way to know the S3 prefix delete actually works).

In order, and the order matters:

1. **Revoke upstream first.** `POST https://www.strava.com/oauth/deauthorize` with the user's
   access token, so the third party stops being able to send us their data mid-deletion.
2. **Delete the `SourceAccount` row** (S4 — tokens gone; §3).
3. **Disable, then delete, the Cognito user.** Disable first: it stops sessions immediately
   while the slower deletes run. `globalSignOut` to kill outstanding refresh tokens (§5.3).
4. **Delete DynamoDB rows by `uid`** — `ExploredCell`, `Activity`, `Trace`, and any
   `IngestReceipt` rows not yet TTL'd. Partition-key scoping (§5.5) is what makes this a query
   rather than a scan, which is a second, quieter reason every model is owner-scoped.
5. **Delete `raw/<uid>/` and the user's `entity('identity')` prefix — under the break-glass
   role** (§6.2). This is the one step that requires deliberately assuming a role, and that
   friction is intentional: it is the difference between a bug deleting the archive and a person
   deleting it.
6. **Purge versions.** Versioning is on (§6.2), so an object "deleted" in step 5 is a delete
   marker over live bytes. A deletion that leaves the previous versions in place is not a
   deletion. Enumerate and remove noncurrent versions for that prefix explicitly, and set a
   lifecycle rule to abort incomplete multipart uploads while you are there.
7. **Let the logs age out.** CloudWatch entries mentioning the user expire under the 30-day
   retention (§6.1). Do not hand-scrub log groups; the retention *is* the answer, and it is one
   of the reasons it is set.
8. **Confirm in writing** what was deleted and what could not be (nothing should be in that
   second category). If this ever runs for someone other than the owner, they get told it is
   done — the requester is a friend, not a ticket.

**Backups:** there are none beyond S3 versioning and DynamoDB point-in-time recovery. If PITR is
enabled, note that it holds deleted rows for up to 35 days — so a deletion is *complete* at the
end of the PITR window, not the moment the script finishes. Say that to the requester rather
than overstating; and be aware that the same window is what would let a wrong-user deletion be
undone, which is the correct trade at this scale.

### 6.5 Disconnecting a source is not deleting an account

Removing the Strava connection deletes `SourceAccount` and stops ingest. **It does not touch the
map** — the explored set was derived from traces that are archived in `raw/` and belong to the
user, not to Strava (D-101). This is the entire point of the archive mitigation in D-121.2: if
Strava's athlete cap bites (D-102/D-121, "the failure mode is friends being locked out, not data
deletion"), or the app is downgraded, or the user simply moves to owned hardware (D-117), the
permanent map survives intact and a new adapter replays history from `raw/`. **D-020's promise is
only credible because of D-101's archive** — the two decisions are load-bearing for each other,
and neither can be traded away alone.

---

## 7. Repo hygiene — and one live finding (O-005)

The repository is the most likely place a secret in this project actually escapes. Not the
webhook, not Cognito — a `git add .`. The rest of this document defends a system with one user;
this section defends against the one failure mode that has *already been observed on this
machine* (§7.4).

### 7.1 `.gitignore` — write it before the first commit, not after the first mistake

A `.gitignore` added on day 40 does not protect the first 39 days, and git history is
append-only in exactly the way §2 says the map is. These entries exist from the initial commit:

```
# credentials and environment
.env
.env.*
!.env.example
*.pem
*.key
credentials
.aws/

# agent + editor tooling config  ← the O-005 class
.claude/
.cursor/
.vscode/
*.local.json
**/settings.local.json

# generated, environment-specific
amplify_outputs.json
.amplify/
node_modules/
.next/
```

Two of these deserve a note:

- **`.claude/` is gitignored wholesale, from the first commit.** Agent tool configuration is a
  credential-bearing surface — §7.4 is the proof — and it is *machine-local by nature*: nothing
  in it needs to be shared with a repo that has one contributor. If some part of it later
  genuinely should be committed (a shared skill, a project `CLAUDE.md`), that file is un-ignored
  by an explicit `!` line, reviewed on the way in. **Deny by default, allow by exception** — the
  same posture as the S3 bucket policy (§6.2) and the ticket endpoint's path allowlist
  (`07-ticketsmith.md` §6.4).
- **`amplify_outputs.json` is ignored because it is generated per-environment, not because it is
  sensitive** (§3.1). Restated here so nobody "fixes" the gitignore by deleting the line, and
  nobody treats a leak of it as an incident.

### 7.2 What must never be committed

| Never | Where it lives instead |
|---|---|
| `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN`, `INGEST_BEARER_TOKEN` (S2, S3, S7) | SSM via `secret()` (§3) |
| The GitHub PAT (S5) or the GitHub webhook secret (S6) | SSM. `07-ticketsmith.md` §6.2: *"never in a committed `.env`, never echoed into logs"* |
| Any AWS access key ID or secret access key (S8) | `~/.aws` — better, **IAM Identity Center SSO, so no long-lived `AKIA…` exists on the laptop at all** (§3, S8) |
| Any user's Strava tokens (S4) | DynamoDB, never a file |
| **Real GPS traces, GPX/FIT fixtures from actual runs, or a dump of `ExploredCell`** | S3. Test fixtures are **synthetic coordinates**. A "sample activity" checked in for a unit test is a home address in git history forever (§2.1) — this is the repo-hygiene rule most likely to be broken by someone being helpful |
| A `.env` with anything real in it | `.env.example` with placeholder values, committed; the real one ignored |

### 7.3 Scanning, in two places

1. **Pre-commit, on staged content.** A `gitleaks protect --staged` (or `git-secrets`) hook via
   `husky` + `lint-staged`, plus a literal check for `AKIA[0-9A-Z]{16}`, `ghp_`,
   `github_pat_`, `-----BEGIN .* PRIVATE KEY-----`, and `xox[baprs]-`. This is the layer that
   makes an accidental `git add .` survivable, and it is the direct answer to §7.4.
2. **In CI, on the built output**, which already exists: §3.1's grep of `.next/static` and every
   Lambda bundle for the literal values of S1–S7 plus the generic patterns, **failing the
   build on a hit**. Extend it to a full-history `gitleaks detect` on the initial run so the
   repo starts from a known-clean state.
3. **GitHub push protection + secret scanning** on the repo — free on public repos, and worth
   the click on a private one. `07-ticketsmith.md` §6.5 already flags it: the capture endpoint
   commits arbitrary prose from a phone into `tickets/inbox/`, so the repo has a path by which
   text the operator never re-read gets committed automatically.

Pre-commit hooks are bypassable with `--no-verify` and are not a control against a determined
person. They are not meant to be. They are a control against **a tired person and a wildcard**,
which is the actual threat (§1).

### 7.4 O-005 — a live finding, on this machine, right now

**Verified 2026-08-30**, recorded in `DECISIONS.md` under OPEN as **O-005**:

`/home/vivicat/devaultsecurity/.claude/settings.local.json` contains **6 occurrences of a
live-format AWS access key ID** (`AKIA…`, a single key repeated), inlined into permission
allowlist entries — i.e. the key is embedded in the *command strings* the allowlist matches on.

**Status, precisely:**

- The file is **not tracked** (`git ls-files` returns nothing) and **is not in git history**
  (`git log --all -- <path>` is empty). **Nothing has leaked.** This is a near-miss, not an
  incident, and §8 is not invoked.
- **But `.claude/` is not gitignored in that repo.** The file sits untracked in the working tree
  of a git repository. It is **one `git add .` from being committed**, and one `git push` after
  that from being unrecoverable — because a secret in git history is not removed by deleting the
  file, it is removed by rewriting history and rotating the credential, and in practice only by
  rotating the credential.
- The repository is unrelated to Lost Soles. It is recorded here because **the mechanism is
  identical** and Lost Soles will run the same tooling on the same machine.

**Remediation, in this order:**

1. **Rotate the key first, before touching the file.** Assume nothing about whether it has been
   read: create a new access key, update whatever consumes it, verify the new one works,
   **deactivate** the old one, confirm nothing breaks for a day, then **delete** it. Deactivate
   before delete — it is the reversible step and it is also how you find out what was using it.
   Better still, take the opportunity to move that machine to **IAM Identity Center short-lived
   credentials** so there is no long-lived key to find next time (§3, S8).
2. `echo '.claude/' >> .gitignore` in that repo, and commit the gitignore.
3. Remove the key from `settings.local.json` — the allowlist entries should match on a **command
   prefix or pattern**, never on a literal credential. A permission rule does not need the
   account's key material to be useful, and inlining it converts a config file into a secret.
4. Check `~/.aws/credentials` and CloudTrail for `AccessKeyId` usage in the period the key
   existed, to confirm the near-miss reading. If CloudTrail shows use from an unexpected source
   IP, this stops being a near-miss and §8.3 applies.
5. Close O-005 in `DECISIONS.md` with the rotation date.

**The standing rule — this is the part that matters for Lost Soles:**

> **A credential value never appears in a configuration file, and tool/agent configuration
> directories are gitignored from the repository's first commit.**
>
> Config files hold **references** — an AWS profile name, an SSM parameter path, an env var
> name — never the material itself. This applies with no exception to permission allowlists,
> editor settings, agent settings, MCP server definitions, task runners, and shell aliases: a
> file whose job is to describe *what may run* has no reason to contain *what authenticates
> it*, and the moment it does, a file nobody thinks of as a secret becomes one.
>
> Enforcement is the three layers already specified: `.claude/` and `*.local.json` ignored from
> commit zero (§7.1), the staged-content scan (§7.3.1) so `git add .` is not the last line of
> defence, and short-lived SSO credentials (§3, S8) so that the worst case is an expired token
> rather than a standing key.

The failure O-005 illustrates is not carelessness with a secret. It is **a secret ending up
somewhere that is not classified as a secret store** — which is why §3's inventory enumerates
*every* credential and *exactly* where it lives, and why anything not on that list is,
by definition, in the wrong place.

### 7.5 Dependencies

- **`package-lock.json` committed**, `npm ci` in CI. Reproducible builds are a supply-chain
  control, not a convenience.
- **Dependabot (or Renovate) on `npm` weekly, grouped, security updates separately.** Six users
  do not justify a patching SLA; a transitive RCE in an SSR dependency still does. Read the
  changelog on anything that touches auth, `h3`, or the Strava adapter.
- **`npm audit` in CI, failing on `high`/`critical` only.** Anything stricter on a hobby project
  becomes noise, and a build that cries wolf is a build people bypass.
- **Fewest dependencies that get the job done.** Every package added to the SSR bundle or a
  Lambda is code with the same IAM grants as ours, and cold-start weight against §4's 2-second
  budget. `h3`, the AWS SDK, and Next.js are unavoidable; a date library is not.
- **No `postinstall` scripts from packages nobody recognises**, and no pinning to a git URL or a
  tarball. Install from the registry, at a version the lockfile records.

---

## 8. Incident playbook

One responder, who is also the person who wrote the bug. No severity matrix, no on-call, no
comms plan. What is actually needed is the thing nobody has at 11pm: **the order of operations,
written down before it is needed.**

**The two rules that apply to every scenario below:**

1. **Contain before you investigate.** A revoked credential can be re-issued in a minute; an
   hour spent reading CloudTrail while the token is still live cannot be undone.
2. **Rotate, do not just revoke.** Assume any credential that was exposed *was* copied.
   "It was only in a screenshot for a second" is not a finding, it is a hope.

**Universal first move:** if the exposure is a commit, **rotate the credential before rewriting
history.** History rewriting is slow, often incomplete (forks, PR refs, GitHub's cached views,
anyone's local clone), and irrelevant once the secret is dead. Rotation is the fix; the rewrite
is tidying.

### 8.1 Strava token leaked (S2 client secret, or S4 a user's refresh token)

**The worst case in the system** (§3): a refresh token plus the client secret yields the user's
entire Strava history — every GPS trace, indefinitely, silently (§2.1). Treat it as a location
disclosure, not a service outage.

- **Detect** — a refresh that fails unexpectedly (someone else refreshed and rotated the token
  out from under us); unfamiliar activity in Strava's *My Apps* / authorized-apps view;
  `token-refresh` errors in CloudWatch; or the mundane real case: the value appeared in a log,
  a commit, or a pasted terminal buffer.
- **Contain** — `POST /oauth/deauthorize` with the user's access token **immediately**. This
  kills that refresh token at Strava, which is the only place that can honour it. Ingest stops;
  the map is unaffected (§6.5), so the cost of over-reacting here is close to zero. *If the
  client secret (S2) is the leak, revoke it in the Strava developer console* — note that
  existing refresh tokens survive a client-secret rotation, so a secret rotation alone does
  **not** contain a leaked refresh token, and vice versa. Work out which one leaked, and if
  unsure, do both.
- **Rotate** — regenerate `STRAVA_CLIENT_SECRET` in the Strava console, `ampx sandbox secret
  set` / Amplify console, redeploy (§3, S2). Have the user re-run the OAuth connect flow to mint
  a fresh refresh token; delete the old `SourceAccount` row rather than updating it.
- **Verify** — a test activity ingests end to end; the old token returns 401 from Strava
  (actually try it); Strava's authorized-apps list shows only our app; `SourceAccount` holds
  exactly one row per user. Then ask the harder question: **what did the holder see?** If the
  token was live and used, assume the user's full trace history was readable, and say so — to a
  friend (§5.4) that is a disclosure they are owed.

### 8.2 GitHub PAT leaked (S5)

- **Detect** — GitHub's own secret scanning emails on a push (it detects its own token formats,
  which is most of the value); unexpected commits or a changed default branch; the `git log`
  showing an author you did not expect; or the token appearing in a build log.
- **Contain** — **revoke the PAT in GitHub settings. One click, do it first.** Then check
  `.github/workflows/` on every branch, because repo write means CI execution — the escalation
  path called out in §3 (S5) and in `07-ticketsmith.md` §6.5. A workflow file added by an
  attacker runs with whatever the repo's Actions secrets hold.
- **Rotate** — issue a new fine-grained PAT: **one repo, Contents: read/write only, 90-day
  expiry** (`07-ticketsmith.md` §6.2). Update SSM, redeploy. **Then seriously consider doing
  §6.3 of that document instead** — the GitHub App with 1-hour installation tokens is the
  structural fix, and an incident is the moment its cost stops looking theoretical.
- **Verify** — the old token 401s against the API; `/api/dev/tickets` still commits a test
  capture; review the full commit log since the leak, not just the tip; confirm branch
  protection and push protection are on. If anything was committed by the attacker, the repo is
  the source of a deployment — treat 8.3 as also in scope.

### 8.3 AWS credentials leaked (S8) — the O-005 shape

**Total blast radius**: the S3 archive, DynamoDB, Cognito, and the bill (§3). This is the one
where speed genuinely matters, because the second-order damage is automated bots spinning up
compute within minutes.

- **Detect** — an AWS Health / abuse notification (AWS scans public GitHub and does email);
  the Budgets alarm at $10 / $25 firing (§4.4, item 7) — *this is the tripwire that actually
  catches it*; unfamiliar regions or services in Cost Explorer; CloudTrail entries from an
  unrecognised source IP; or, as in O-005, finding the key somewhere it should not be.
- **Contain** — **deactivate the access key in IAM immediately** (deactivate, not delete: it is
  instant, reversible, and preserves the key ID for CloudTrail correlation). If the compromised
  principal is a user with a login, disable the console password and any MFA-less path. Then
  look for what was created: **check every region** for EC2 instances, and check for new IAM
  users, roles, and access keys — persistence is the first thing a competent intruder
  establishes, and rotating your own key does nothing about a role they made.
- **Rotate** — new credentials, verify, delete the old key. Then remove the reason it existed:
  move the machine to **IAM Identity Center / SSO short-lived credentials** (§3, S8; §7.4). A
  long-lived `AKIA…` on a laptop is the root cause every time, and rotating one for another is
  fixing the symptom.
- **Verify** — CloudTrail shows no use of the old key ID after deactivation; no unexpected IAM
  principals; **the S3 bucket's Block Public Access is still on and versioning is still enabled**
  (§6.2) — an attacker who wanted the GPS archive would flip exactly those; DynamoDB row counts
  are sane; the Cognito pool still has **self-signup off** and exactly the users expected (§5.1).
  Read the bill for the next two cycles.

### 8.4 Webhook abused (§4)

Least severe by construction, because the endpoint holds no credential and reads nothing (§4.5)
— but it can spend money, and a $3–5/month budget notices.

- **Detect** — the Budgets alarm; a spike in `strava-webhook` invocations or throttles in
  CloudWatch; the §4.4(6) per-`owner_id` counter alarming; SQS queue depth or DLQ messages;
  `IngestReceipt` writes far exceeding real activity.
- **Contain** — **set the Lambda's reserved concurrency to 0.** That is the kill switch: it
  hard-stops all execution and costs nothing, and because Strava retries, legitimate events are
  mostly recoverable afterwards. The real risk of this move is the subscription being disabled
  after sustained failures (there is exactly one subscription, per app, ever — §4), so use it
  decisively and briefly, then restore to 5 (§4.4, item 1). If concurrency was never set, set it
  now; that is the same fix.
- **Rotate** — usually **nothing to rotate**: the verify token (S3) does not authenticate POSTs
  (§4.1), so a flood proves nothing about it. Rotate S3 only if the *handshake* itself was
  abused, and remember it means deleting and recreating the subscription (§3, S3). If the
  attacker had a valid `subscription_id`, they observed it somewhere — find where.
- **Verify** — a real activity ingests end to end (this is the only proof the subscription is
  alive); no duplicate activities or double-awarded XP, which `ingestKey` and D-140's
  deterministic `activityId` should have prevented (§4.3) — **if duplicates did appear, the
  idempotency logic is the actual bug and the flood only revealed it**; the DLQ is empty;
  billing returns to baseline. Then confirm the invariant that made this survivable held:
  **no data was injected** — the payload is a notification, never a data carrier (§4.1).

---

## 9. What we are deliberately not doing

Every item below was considered and rejected **for this system, at this scale, on this budget**
(D-014: one user, up to six ever; D-083: $3–5/month). They are written down so that a future
reader — or a future agent running a generic security checklist — does not mistake calibrated
restraint for an oversight, and does not spend the entire infrastructure budget on a control
that protects six people who are already behind Cognito.

| Not doing | Why not |
|---|---|
| **WAF** | $15/month per app plus per-request charges — **~5× the entire infrastructure budget** (`01-architecture.md` §12), to rate-limit an endpoint whose worst case is "re-fetch our own activity" (§4.1). §4.4's reserved concurrency achieves the part that matters for one CDK line and $0 |
| **API Gateway in front of the webhook** | The Function URL was chosen *specifically* to avoid its cost and its extra hop (§4). Adding it back for throttling reinvents the thing we declined |
| **SIEM / centralised log aggregation / CloudTrail alerting pipeline** | One responder who reads CloudWatch directly. The alerting that actually catches things here is **a $10 Budgets alarm** (§4.4, §8.3) — for a personal AWS account, cost *is* the intrusion detection signal, and it is free |
| **GuardDuty** | ~$3–5/month at minimum: it would roughly double the bill to monitor an account with one Lambda pipeline and one bucket. Reconsider if the account ever holds anything for anyone else |
| **Penetration testing** | The attack surface is one unauthenticated endpoint that holds no credentials and can be reasoned about completely in §4. A pen test would cost more than the app will cost to run for a decade |
| **SOC 2, ISO 27001, GDPR Article 30 records, a DPA, a formal DPIA** | No customers, no processors, no controller relationship, nothing to attest to. If friends are ever added (§5.4), the *substance* they would be owed — knowing what is stored, and being able to have it deleted — is already required by §2.4 A-4 and §6.4. **That is the part worth having; the paperwork is not** |
| **A bug bounty / security.txt / vulnerability disclosure programme** | There is no unauthenticated attack surface worth reporting against, and no capacity to triage submissions. `security.txt` on a personal app invites automated low-quality reports, exclusively |
| **Customer-managed KMS keys** | ~$1/month plus per-request charges to defend against a threat (AWS-internal access to raw storage) that §1 explicitly excludes. SSE-S3 is on and free (§6.2) |
| **AWS Secrets Manager** | $0.40/secret/month × 6–7 secrets ≈ $2.80/month, against SSM Parameter Store at $0 for the same job (§3). Secrets Manager's rotation automation is what you pay for, and our highest-value credential (S4) already rotates itself on every refresh |
| **MFA beyond passkeys; SMS MFA specifically** | Passkeys are already phishing-resistant and hardware-bound (§5.2). SMS costs real SNS money and is the weakest available second factor |
| **A roles/permissions system** | One privileged action exists (`/api/dev/tickets`), gated by a single `sub` comparison (§5.5). RBAC for six users creates a second thing to misconfigure |
| **Field-level or client-side encryption of coordinates** | The app must render the map, so the key would have to reach the client, and the threat model's highest-ranked actor is an accident, not a cryptanalyst. It would break every server-side aggregate (D-115, D-120) to defend against nothing in §1 |
| **Home-location masking / privacy zones** | **D-123, and it is the one item on this list with a live tripwire under it.** Not a permanent dismissal: §2.4's Triggers A, B and C each force it back open. See §2 — it is the most important section in this document, and this row is a pointer, not a decision |
| **Anonymised analytics, error tracking SaaS, session replay** | A third party in the request path of a lifetime GPS history, for product insight into a userbase of one who can simply be asked. CloudWatch is sufficient and stays inside the account |
| **Data residency / regional constraints** | One user, one region, no cross-border obligation to satisfy |
| **Disaster recovery beyond S3 versioning + DynamoDB PITR** | The archive is the system of record (D-101) and is ~40 MB (§6.1); versioning plus PITR covers deletion and corruption. A multi-region replica protects against a region loss that would also mean the user has larger problems than a map |
| **Automated dependency patching SLAs, SBOM, signed artifacts** | Dependabot weekly plus `npm audit` failing on high/critical (§7.5) is the right amount. An SBOM has no consumer |

**The pattern, stated once:** the controls this system actually has are the ones that are
**free, structural, and hard to un-do** — self-signup off (§5.1), Block Public Access (§6.2),
reserved concurrency (§4.4), a bucket policy denying archive deletes (§6.2), owner-scoped
authorization (§5.5), no credential in the public endpoint (§4.5), a budget alarm (§4.4), and a
gitignore written before the first commit (§7.1). Almost all of them are one line, cost nothing,
and cannot be forgotten once set. **That is what security proportionate to a personal project
looks like — and if the budget is ever spent on exactly one security control, it should be spent
on §2, because the sensitive thing here is not the infrastructure. It is the map.**
