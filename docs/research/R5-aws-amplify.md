# R5 — AWS Amplify for "Lost Soles"

**Date:** 2026-08-30
**Status:** Research complete, planning phase (no code yet)
**Scope:** (1) Verify current AWS Amplify Gen 2 capabilities against the Lost Soles requirements. (2) Document existing `devaultsecurity` conventions to match.

---

## RECOMMENDATION

### Verdict: **Amplify is a good fit — with one carve-out**

Amplify Gen 2 handles ~90% of Lost Soles well and cheaply: hosting, GitHub CI/CD, auth for 5 users, game state, scheduled jobs, secrets, and S3. Keep it.

The carve-out is **geospatial storage and the routing engine**:

- **Do NOT put a Postgres/PostGIS database inside a VPC for this app.** Any Lambda that needs both VPC access (to reach RDS/Aurora) *and* the public internet (to call Strava) requires a **NAT Gateway at ~$0.045/hr = ~$33/month** before a byte of data moves. That single line item is 10× the entire target budget. This is the most important cost finding in this document.
- **Do NOT use Aurora Serverless v2** as the primary store at this scale. Even with scale-to-zero (min 0 ACU), realistic cost lands at **$8–25/month** once you account for storage, I/O, and the fact that ordinary browsing keeps waking it (5-minute minimum idle window per wake). Adding RDS Proxy — which Amplify recommends for the SQL data source — **disables auto-pause entirely** and costs ~$11–15/month on its own.
- **Amplify Data's SQL data source is technically usable with PostGIS but is the wrong tool.** It maps `point`/`linestring` columns to `a.string()`, requires primary keys on every table, and routes everything through an Amplify-managed Lambda + Lambda Layer. You *can* run PostGIS functions via `a.handler.inlineSql()` / `a.handler.sqlReference('./query.sql')`, but return types must be declared as Amplify models/custom types — which is painful for geometry results. If you need PostGIS, talk to Postgres directly from your own Lambda / Next.js route handlers and leave AppSync out of it.

### Proposed topology

```
GitHub (Oofles/lost-soles)
   │  push → branch deploy
   ▼
┌───────────────────────────────────────────────────────────────┐
│ AWS Amplify Gen 2 app  →  soles.devaultsecurity.com           │
│                                                               │
│  Hosting (compute)        Next.js 15 App Router, SSR + ISR    │
│                           Amplify auto-detects, no adapter     │
│                                                               │
│  amplify/auth/            Cognito user pool, Essentials tier   │
│                           email + passkey, self-signup OFF     │
│                                                               │
│  amplify/data/            AppSync + DynamoDB                   │
│                           game state: User, Profile, XP,       │
│                           Inventory, Monster, Activity,        │
│                           ExploredCell (H3 index)              │
│                                                               │
│  amplify/functions/                                            │
│    strava-webhook/        Lambda + Function URL (CDK hatch)    │
│                           GET handshake + POST → SQS/DDB, 200  │
│    process-activity/      15 min / 2048 MB, GPX → H3 cells     │
│    nightly-sync/          schedule: 'every day'                │
│    token-refresh/         schedule: 'every 4h'                 │
│    monster-gen/           schedule: 'every day'                │
│                                                               │
│  amplify/storage/         S3: raw GPX, generated overlays      │
│                                                               │
│  amplify/backend.ts       CDK escape hatch:                    │
│                             - Function URL for webhook         │
│                             - SQS queue + event source         │
│                             - (later) public pmtiles bucket    │
└───────────────────────────────────────────────────────────────┘
        │                                    │
        │ (only if geometry demands it)      │ (only if routing is built)
        ▼                                    ▼
  Neon serverless Postgres            Separate always-on box
  + PostGIS, public TLS,              (Lightsail/Hetzner ~$5-7/mo
  HTTP driver — no VPC, no NAT        or ECS Fargate) running
  Free tier: 0.5 GB / 100 CU-hr       OSRM or Valhalla.
                                      NOT an Amplify workload.
```

**Key design decisions baked into that diagram:**

1. **Geo model = H3 cells in DynamoDB, not PostGIS.** "Explored territory" is naturally a *set of discrete cells*, not arbitrary geometry. Store `PK=userId`, `SK=h3CellId` (or `PK=userId#h3ParentRes7`, `SK=h3CellRes10` so a viewport query is a handful of `Query` calls on covering parents). Hundreds of thousands of cells is nothing for DynamoDB and sits entirely inside the 25 GB free storage tier. Compute the H3 covering in the Lambda with the pure-JS `h3-js` library — no native binaries, no bundling pain. **Defer Postgres until a feature actually requires true geometry ops** (polygon dissolve for a smooth territory boundary, road-network snapping, isochrones).
2. **Strava webhook = a Lambda Function URL, not the Next.js route handler.** Strava requires the subscription POST be acknowledged **within 2 seconds**; Amplify Hosting compute cold starts can blow that. A dedicated 128 MB Lambda behind a Function URL (`authType: NONE`) that writes to SQS/DynamoDB and returns `200` immediately is faster, cheaper, and isolated from frontend deploys. The GET handshake (`hub.challenge` echo) is three lines in the same handler. `defineFunction` does not expose function URLs — add it in `backend.ts` via `backend.stravaWebhook.resources.lambda.addFunctionUrl(...)`.
3. **Strava refresh tokens go in DynamoDB, not SSM/Secrets Manager.** Amplify secrets (`secret()` → SSM Parameter Store) are for *static* config: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN`. Per-user Strava refresh tokens rotate on every refresh and are per-user data — put them in a DynamoDB table with a restrictive auth rule (or a dedicated table only the functions can touch). Secrets Manager would be $0.40/secret/month and is the wrong shape.
4. **Next.js, not Astro** — a deliberate divergence from the house stack (see Part 2). Amplify Hosting has first-class, adapter-free support for Next.js 12–15 including App Router, SSR, ISR, middleware, and `next/image`. Astro SSR on Amplify works only via a *community* adapter and the `.amplify-hosting/deploy-manifest.json` spec — more moving parts, more breakage risk, for an app that genuinely needs server routes and auth-gated SSR.

### Monthly cost estimate (1–5 users)

| Line item | Assumption | Cost |
|---|---|---|
| Amplify build minutes | ~30 builds × 3 min = 90 min (1,000 free) | **$0.00** |
| Amplify hosting storage | < 1 GB (5 GB free) | **$0.00** |
| Amplify data transfer out | ~3 GB (15 GB free) | **$0.00** |
| Amplify SSR requests | ~50k (500k free) | **$0.00** |
| Amplify SSR duration | ~2 GB-hr (100 GB-hr free) | **$0.00** |
| Cognito | 5 MAU, Essentials (10,000 MAU free) | **$0.00** |
| AppSync | ~100k query/mutation ops @ $4.00/M | **$0.40** |
| DynamoDB writes | ~300k WRU @ $0.625/M | **$0.19** |
| DynamoDB reads | ~1M RRU @ $0.125/M | **$0.13** |
| DynamoDB storage | < 1 GB (25 GB free) | **$0.00** |
| Lambda | ~2k invocations, ~40k GB-s (400k GB-s free) | **$0.00** |
| S3 (GPX + assets) | 5 GB @ $0.023 + requests | **$0.17** |
| SSM Parameter Store | Standard parameters | **$0.00** |
| Route 53 hosted zone | Already exists for devaultsecurity.com | **$0.00 (marginal)** |
| **Total** | | **≈ $0.90 / month** |

**Budget $3–5/month** to absorb variance. Two risks that could break the budget:

- **pmtiles egress.** Amplify data transfer is **$0.15/GB after 15 GB free**. A chatty map that pulls 100 GB/month = **$15/month**. Mitigations, in order of preference: (a) put pmtiles on **Cloudflare R2**, which has **zero egress fees**, and fetch by HTTP range from the browser — this is a genuinely good hybrid even inside an otherwise-AWS stack; (b) S3 + your own CloudFront distribution (cheaper per GB than Amplify's markup); (c) keep tiles small and cache aggressively.
- **Free-tier perpetuity is ambiguous.** Sources disagree on whether Amplify Hosting's 1,000 build min / 5 GB / 15 GB / 500k SSR request allowances are perpetual or tied to the 12-month AWS Free Tier. Since the devaultsecurity account is well past 12 months, **verify in the AWS Billing console before committing**. Worst case (all allowances chargeable): ~$2–4/month more. Still within budget.

**Aurora Serverless v2 alternative, costed:** storage $0.10/GB-mo (Standard) or $0.225 (I/O-Optimized), I/O $0.20/M requests (Standard only), compute $0.12/ACU-hour. With min 0 ACU and a realistic 1–2 waking hours/day at 2 ACU: **$6–12/month compute + $1–3 storage**, plus ~$33/month NAT Gateway if any function needs both the DB and the internet, plus ~$11–15/month if you add RDS Proxy (which then prevents auto-pause). **Verdict: 10–50× over budget. Do not use.**

### Honest alternatives comparison

| Option | Fit for Lost Soles | Cost @ 5 users | Verdict |
|---|---|---|---|
| **Amplify Gen 2** (recommended) | Excellent for hosting/auth/cron/state. Weak only on true geospatial SQL. It *is* CDK, so the escape hatch is real. | **~$1–3/mo** | **Keep.** Already in use, already deploying devaultsecurity.com, auto-SSL was the original reason for choosing it. |
| **Amplify + Neon Postgres** (recommended *if* PostGIS is needed) | Adds real PostGIS over public TLS/HTTP — no VPC, no NAT. Neon free tier: 0.5 GB storage, 100 CU-hr/mo, PostGIS supported. Reached directly from Lambda, bypassing Amplify Data. | **~$1–3/mo** (Neon free) or +$5–15 on Launch | **Least-disruptive hybrid.** This is the escape hatch to plan for, not to build on day one. |
| **Vercel + Neon/Supabase** | Great DX, best-in-class Next.js. But: Hobby plan is non-commercial and caps cron at 1/day; Pro is $20/seat/mo. Splits the stack across two vendors and two billing relationships. Auth, storage, and long jobs all become third-party. | $0 (Hobby, cron-limited) or **$20+/mo** | **No.** Higher cost, no capability win, abandons an AWS account already in use. |
| **SST / raw CDK on AWS** | Maximum control; native support for containers, VPC, long-running compute. But you rebuild hosting, CI/CD, cert management, and preview envs yourself — the exact things that drove the move *to* Amplify. | ~$1–3/mo + your time | **No.** Amplify Gen 2 already gives you CDK where you need it. Reach for SST only if the app outgrows Amplify wholesale. |
| **Cloudflare Workers + D1** | D1 is SQLite — **no PostGIS, no SpatiaLite, no spatial index**, 10 GB hard cap per DB. Workers CPU limits are hostile to a heavy geometry job. R2's free egress is genuinely attractive for pmtiles. | $5/mo (Workers Paid) | **No for the app; yes for tiles.** Use R2 for pmtiles hosting; keep everything else on AWS. |

**Bottom line for the user:** the bar for switching off Amplify is high and Amplify clears it. The correct move is *not* to switch platforms but to keep two things outside Amplify's abstractions — a geo database (only when needed, and only a public-TLS serverless one) and a routing engine (which is a container workload, not a Lambda).

---

## PART 1 — Amplify capability findings

### 1. State of Amplify Gen 2 in 2026

- **Gen 2 is the default and the recommendation for all new projects.** The backend is defined in TypeScript (`amplify/backend.ts` + `amplify/*/resource.ts`) rather than the Gen 1 CLI's imperative `amplify add` flow and `team-provider-info.json`. ([docs.amplify.aws FAQ](https://docs.amplify.aws/react/how-amplify-works/faq/))
- **Gen 1 is in maintenance mode.** From **May 1, 2026** Gen 1 backends receive only critical bug fixes and security patches; **end of life is May 1, 2027**. ([aws-amplify/amplify-cli#14881](https://github.com/aws-amplify/amplify-cli/issues/14881), [Gen 1 docs](https://docs.amplify.aws/gen1/))
- **You cannot mix Gen 1 and Gen 2 in the same app.** DataStore is not supported in Gen 2. ([FAQ](https://docs.amplify.aws/react/how-amplify-works/faq/))
- **Gen 2 backends are AWS CDK.** This is the load-bearing fact for this project — see §7.
- Notable 2025 hosting changes: **deployment skew protection** (March 2025, free, zero-config — prevents 404s when a user's cached bundle requests assets from an older deploy) and **WAF in GA** (March 2025, **$15/month per app** plus WAF charges — skip it for this project). Larger build instance types (Large 16 GB/8 vCPU at $0.025/min, XLarge 72 GB/36 vCPU at $0.10/min) are available if builds get slow. ([skew protection](https://aws.amazon.com/about-aws/whats-new/2025/03/aws-amplify-hosting-deployment-skew-protection-support/), [WAF GA](https://aws.amazon.com/about-aws/whats-new/2025/03/aws-amplify-hosting-web-application-firewall-protection))

### 2. Hosting — Next.js, GitHub, branches, domains

**Next.js SSR support.** Amplify Hosting compute fully manages **Next.js 12 through 15**, no adapter and no Lambda packaging. Supported: SSR pages, static pages, API routes, dynamic and catch-all routes, SSG, **ISR**, i18n sub-path / domain routing / locale detection, **middleware**, `generateMetadata`, and `next/image` optimization. ([Amplify Next.js support](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html))

**Not supported** (verify against your feature list):
- **On-demand ISR** (`revalidatePath` / `revalidateTag`) — does not work on Amplify.
- **Edge API routes**.
- **Streaming** and `unstable_after`.

None of these block Lost Soles, but "no on-demand revalidation" means you cannot cheaply invalidate a cached page when a webhook lands — plan on client-side refetch or short `revalidate` windows for anything driven by a Strava push.

**Other frameworks.** Astro / SvelteKit / Nuxt SSR is possible via the [Amplify Hosting deployment specification](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-deployment-specification.html) (`.amplify-hosting/static`, `.amplify-hosting/compute`, `deploy-manifest.json`) using **community** adapters. Nuxt has it built into Nitro. Astro's is community-maintained — a real risk for a project you want to still build in two years. Another reason to choose Next.js here.

**Build pipeline.** Connect the GitHub repo in the Amplify console; `amplify.yml` at repo root defines `preBuild`/`build`/`artifacts`/`cache`. A Gen 2 app adds a `backend:` phase running `npx ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID`. Branch deploys and PR preview environments are first-class; each branch gets its own backend environment and its own secrets namespace.

**Custom subdomain on a domain that already hosts another Amplify app.** This is explicitly supported — one Route 53 hosted zone can back many Amplify apps on different subdomains (`app1.example.com`, `app2.example.com`). Gotchas, all verified against [the troubleshooting guide](https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-custom-domains.html):

1. **Use the existing hosted zone.** Do not create a new hosted zone for `soles.devaultsecurity.com` — that introduces an NS delegation you don't need and is a classic source of stuck validation. Amplify writes the CNAME and the ACM validation CNAME into the existing zone automatically.
2. **`CNAMEAlreadyExistsException`** is the error you will hit if the hostname is already on another CloudFront distribution — including one owned by the *other* Amplify app on this domain, or a leftover from the retired S3+CloudFront setup. The devaultsecurity repo history shows an abandoned S3/CloudFront/ACM architecture whose teardown status is unverified; **check CloudFront for orphaned distributions with `devaultsecurity.com` aliases before adding the subdomain.** Also check for stale Route 53 CNAME/ALIAS records pointing at old distributions.
3. **Do not let the new app claim the apex or `www`.** By default Amplify offers to map both `example.com` and `www.example.com` with a redirect. For a second app on the same domain, **remove those and add only `soles`** — the apex/www belong to the existing site.
4. **Check for CAA records.** If a CAA record exists on `devaultsecurity.com` and doesn't trust an Amazon CA domain, ACM cannot issue or reissue the cert and you get HTTPS errors. Fix by adding a CAA record trusting Amazon's CA, then delete and re-add the domain in Amplify (this causes downtime for that domain).
5. **Watch for "automatic subdomain creation."** If the existing app has auto-subdomain enabled for branch deploys, a branch named `soles` on *that* app would collide. Check before naming branches.
6. **Timing.** Validation CNAMEs are polled every few minutes for the first hour, then only every few hours. **Get the records right on the first attempt** or you'll wait hours. If Amplify is managing Route 53 for you this is automatic; if it stalls, verify the records actually exist in the zone.
7. **The CloudFront URL itself always 404s** — that's expected. Amplify routes by `Host` header; only the app URL or the custom domain work.
8. **Cross-account** domain association (same domain used by Amplify apps in a *different* AWS account) returns a 400 and requires an AWS support ticket. Everything here is same-account, so not an issue.

### 3. Auth — Cognito at 1–5 users

`amplify/auth/resource.ts` with `defineAuth({ loginWith: { email: true } })` provisions a Cognito user pool and identity pool. For 1–5 users:

- **Set `allowUnauthenticatedIdentities: false`** and **disable self-signup** — create the 3–5 users manually via the console or an admin script. Otherwise your webhook-adjacent app has an open registration endpoint.
- **Tier:** new user pools default to **Essentials**, which includes Managed Login and **passwordless/passkey (WebAuthn) sign-in** — ideal for a mobile-browser-first personal app. Passkeys mean no passwords to manage for five people. ([Cognito pricing](https://aws.amazon.com/cognito/pricing/))
- **Cost: $0.** Essentials and Lite each include **10,000 free MAU/month**, and that free tier **does not expire at the end of the 12-month AWS Free Tier term**. Identity pools are always free. (Lite: $0.0055/MAU beyond free; Essentials: $0.015/MAU; Plus: $0.020/MAU with no free tier — you do not need Plus.)
- **Social login** (Google/Apple/Facebook) is supported via `externalProviders` with client secrets supplied through `secret()`. Strava is *not* an identity provider here — Strava OAuth is an **outbound authorization** flow you implement yourself in a route handler, storing the returned refresh token per user. Keep the two concepts separate: Cognito answers "who is this", Strava OAuth answers "may I read their activities".
- **SMS MFA costs real money** (SNS charges) — use TOTP or passkeys instead.

### 4. Data — AppSync + DynamoDB, and the SQL data source

**Amplify Data (default: AppSync + DynamoDB).** `defineData` with a TypeScript schema generates a GraphQL API, DynamoDB tables, resolvers, a fully typed client, and real-time subscriptions. Auth rules are declarative (`allow.owner()`, `allow.authenticated()`, `allow.groups()`).

**Can it model the Lost Soles workload?** Yes, for everything except true geometry:

| Data | DynamoDB fit |
|---|---|
| XP, levels, profile, streaks | Trivial. |
| Inventory, items | Trivial. |
| Monsters / events (spawned at cells, TTL'd) | Good — use DynamoDB TTL for expiry, free. |
| Activity records (one per Strava run) | Good — `PK=userId`, `SK=startedAt`. |
| **Explored cells (H3)** | **Good, with the right key design.** `PK=userId#parentCellRes7`, `SK=childCellRes10`. Viewport render = compute covering res-7 parents client-side, issue N `Query` calls. Hundreds of thousands of items is well within free storage. |
| Raw GPS traces / polylines | **Do not store in DynamoDB.** 400 KB item limit and you'd pay per KB written. Put GPX/encoded polylines in S3, keep the S3 key in DynamoDB. |
| Arbitrary geometry queries (polygon dissolve, nearest-road, isochrones) | **Bad fit.** DynamoDB has no spatial index. This is the PostGIS trigger. |

**Amplify's SQL data source** connects AppSync to an existing MySQL/PostgreSQL database — RDS, Aurora, or **outside AWS (Neon is explicitly named in the docs)**. ([Connect to Postgres/MySQL](https://docs.amplify.aws/react/build-a-backend/data/connect-to-existing-data-sources/connect-postgres-mysql-database/))

How it works: `npx ampx generate schema-from-database --connection-uri-secret SQL_CONNECTION_STRING` introspects the DB and emits `schema.sql.ts`. Amplify then deploys **two Lambdas in your account** — a SQL Lambda that executes queries and an Updater Lambda that keeps a shared Amplify-published Lambda Layer current. Connections use SSL/TLS.

**PostGIS through it — the honest answer:**
- **Geometry columns are usable but degraded.** `point` and `linestring` map to `a.string()`. There is no geometry type, no spatial operator support in the generated CRUD, and no spatial filtering in the generated GraphQL filters.
- **You *can* run arbitrary PostGIS SQL** via `a.handler.inlineSql('SELECT ...')` or `a.handler.sqlReference('./queries/nearby.sql')`, exposed as custom queries/mutations. This is a legitimate path — `ST_Intersects`, `ST_Union`, `ST_DWithin` all work because it's just SQL on the wire.
- **But the return typing is awkward.** Custom queries that return rows must declare `a.ref("ModelName").array()` or an explicit `a.customType()`, even for a single row. Ad-hoc geometry results don't map cleanly.
- **Other limitations:** tables without a primary key are skipped by introspection entirely; no implicit `id`/`createdAt`/`updatedAt`; never hand-edit `schema.sql.ts` (regenerated).
- **Connection pressure.** Every query opens a connection; AWS recommends **RDS Proxy** in front of the cluster. RDS Proxy costs money *and* **prevents Aurora auto-pause**.
- **VPC.** If the DB is in a VPC, the docs require the instance be flagged "Publicly accessible", with inbound rules on 5432 and 443 and a self-referencing security group — or you go the RDS Proxy route and need VPN/same-VPC access just to run schema generation.

**Recommendation:** if and when Postgres enters the picture, **bypass Amplify Data for it.** Use Neon's HTTP/serverless driver (or `pg` over TLS) directly inside your own Lambda handlers and Next.js route handlers. You keep full PostGIS, avoid the Layer/Updater machinery, avoid RDS Proxy, avoid the VPC, and avoid the NAT Gateway. Keep AppSync+DynamoDB for game state where its auth rules and subscriptions earn their keep.

### 5. Functions

**Definition.** `defineFunction({ name, entry, timeoutSeconds, memoryMB, runtime, environment, schedule, resourceGroupName })` in `amplify/functions/<name>/resource.ts`, handler in `handler.ts`. Built on the CDK `NodejsFunction` construct (esbuild bundling). ([Configure functions](https://docs.amplify.aws/react/build-a-backend/functions/configure-functions/))

| Setting | Default | Range |
|---|---|---|
| `timeoutSeconds` | **3** | up to **900** (15 min) |
| `memoryMB` | 512 | 128 – 10,240 |
| ephemeral storage | 512 MB | 512 – 10,240 MB |
| runtime | Node 18 | Node 20+ selectable |

**Node only** — `defineFunction` does not support Python, Go, or container images. Non-Node runtimes require dropping to CDK in `backend.ts`.

**Scheduled functions.** `schedule: 'every day'` (natural language) or a cron expression, backed by EventBridge rules. Covers nightly sync, token refresh, and monster generation directly. ([Scheduling functions](https://docs.amplify.aws/react/build-a-backend/functions/scheduling-functions/))

**HTTP endpoints — three options for the Strava webhook:**

1. **Lambda Function URL via CDK** *(recommended)*. `defineFunction` has no `url` property, but in `backend.ts`: `backend.stravaWebhook.resources.lambda.addFunctionUrl({ authType: FunctionUrlAuthType.NONE })`. Free, no API Gateway, lowest latency, isolated from frontend deploys. Handles both the GET `hub.challenge` echo and the POST events.
2. **API Gateway REST or HTTP API via CDK.** Amplify documents wiring functions as API Gateway route resolvers with `APIGatewayProxyHandler` / `APIGatewayProxyHandlerV2`. More knobs (custom domain, throttling, WAF) at ~$1.00–3.50 per million requests. Overkill here.
3. **Next.js route handler on Amplify Hosting compute** (`app/api/strava/webhook/route.ts`). Zero extra infra, but **cold starts risk breaching Strava's 2-second POST acknowledgement window**, and the handler redeploys every time the frontend does. Use for the *user-facing* OAuth callback (`/api/strava/callback`), which is latency-tolerant; not for the webhook.

**Bundling native/geo dependencies.** esbuild handles pure-JS fine — **`h3-js`, `@turf/*`, `polyline`, `geojson` all bundle cleanly**. Native binaries (`node-canvas`, GDAL bindings, `sharp` in some configurations) are the problem case: you need `bundling.nodeModules` externals plus a Lambda Layer, or a container-image Lambda — and container images require **raw CDK**, not `defineFunction`. **Design constraint: keep the geometry pipeline pure-JS.** H3 + Turf covers cell indexing, buffering, area, and simplification without a single native dependency.

**Secrets.** `npx ampx sandbox secret set STRAVA_CLIENT_SECRET` stores values in **SSM Parameter Store**, either shared (`/amplify/shared/<app-id>/<key>`) or per-branch (`/amplify/<app-id>/<branch>-branch-<hash>/<key>`), and `secret('STRAVA_CLIENT_SECRET')` resolves the right one per environment. **Environment variables are NOT secrets** — they are rendered in plaintext into build artifacts and readable by anyone with `get-app` access. ([Secrets and vars](https://docs.amplify.aws/react/deploy-and-host/fullstack-branching/secrets-and-vars/))

Recommended secret layout:
- SSM via `secret()`: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN`, later `WHOOP_CLIENT_SECRET` / `FITBIT_CLIENT_SECRET`, and `DATABASE_URL` if Neon is added.
- DynamoDB (per-user, rotating): Strava/Whoop/Fitbit **access and refresh tokens**, with `expiresAt` so the scheduled refresher can find the ones about to lapse.

**VPC.** `defineFunction` **does not expose VPC configuration** ([amplify-backend#1112](https://github.com/aws-amplify/amplify-backend/issues/1112)). You can force it via CDK in `backend.ts` by reaching into the underlying CFN resource, but developers report friction. More importantly, **you don't want it** — see the NAT Gateway finding above.

### 6. Storage

`defineStorage({ name, access })` provisions an S3 bucket with declarative path-scoped rules. ([Set up storage](https://docs.amplify.aws/react/build-a-backend/storage/set-up-storage/), [Authorization](https://docs.amplify.aws/react/build-a-backend/storage/authorization/))

Constraints that shape the folder layout:
- **Default deny.** Nothing is accessible until granted.
- **Every path must end in `/*`**, no leading slash.
- **Only one level of nesting** in access rules — you can define `media/*` and `media/albums/*` but not also `media/albums/photos/*`.
- Grantees: `guest`, `authenticated`, `groups`, `entity('identity')` (per-user folders), and `resource(myFunction)` for Lambda access.

Proposed layout:
```
gpx/{entity_id}/*        → owner read/write, process-activity function read
overlays/{entity_id}/*   → owner read, process-activity function write
public/*                 → guest read (small shared assets)
```

**pmtiles.** `defineStorage` will hold them, and S3 supports the HTTP range requests pmtiles needs. But **pmtiles served from Amplify Storage requires signed URLs or a `guest` grant**, and either way egress bills at Amplify/S3 rates. Given a basemap can easily be 100 MB–2 GB and a map-heavy session pulls tens of MB, **host pmtiles separately**: Cloudflare R2 (free egress, the clear winner) or a dedicated public S3 bucket + your own CloudFront distribution added through the CDK escape hatch. Do not route map tiles through Amplify Hosting's $0.15/GB.

### 7. Limitations and escape hatches

**Confirmed: Amplify Gen 2 backends are AWS CDK.** `defineBackend()` returns a backend object exposing every underlying construct, and `backend.createStack('Name')` creates an arbitrary nested CloudFormation stack you can fill with any L1/L2 CDK construct. `backend.addOutput()` surfaces values into `amplify_outputs.json` for the frontend. ([Custom resources](https://docs.amplify.aws/react/build-a-backend/add-aws-services/custom-resources/), [Modify Lambda with CDK](https://docs.amplify.aws/react/build-a-backend/functions/modify-resources-with-cdk/))

```ts
// amplify/backend.ts — shape of the escape hatch
const backend = defineBackend({ auth, data, storage, stravaWebhook, processActivity });

// 1. reach into a generated resource
backend.stravaWebhook.resources.lambda.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });

// 2. add arbitrary infrastructure
const custom = backend.createStack('LostSolesCustom');
const queue  = new sqs.Queue(custom, 'ActivityQueue', { visibilityTimeout: Duration.minutes(16) });
backend.processActivity.resources.lambda.addEventSource(new SqsEventSource(queue));
backend.addOutput({ custom: { activityQueueUrl: queue.queueUrl } });
```

AWS is explicit that **you own the security and correctness of anything you add this way** — Amplify won't validate it.

**What Amplify Gen 2 genuinely cannot do (without CDK, or at all):**

| Limitation | Workaround |
|---|---|
| Non-Node Lambda runtimes | Raw CDK `lambda.Function` in a custom stack |
| Container-image Lambdas | Raw CDK `DockerImageFunction` |
| Lambda Function URLs | CDK on `resources.lambda` (as above) |
| VPC-attached functions | CDK override; **but adds NAT Gateway cost** |
| Container workloads (ECS/Fargate/App Runner) | Entirely outside Amplify — separate stack or account resource |
| Compute > 15 minutes | Step Functions, ECS task, or an external box. **This is the routing-engine wall.** |
| Cannot mix Gen 1 and Gen 2 | N/A |
| DataStore / offline sync | Not supported in Gen 2 |
| Next.js on-demand ISR revalidation | Client refetch or short `revalidate` |
| Edge API routes, streaming, `unstable_after` | Not supported on Amplify compute |
| Amplify Storage rules deeper than one nesting level | Restructure paths, or a Lambda S3 proxy |
| Spatial types in Amplify Data | Custom SQL, or bypass Amplify Data |

**The routing engine specifically.** OSRM and Valhalla need multi-GB OSM extracts, a graph-build step measured in minutes to hours, and several GB of RAM held resident. That is not a Lambda and not an Amplify workload under any configuration. Options, cheapest first: (a) use a hosted routing API (Mapbox Directions, OpenRouteService, Valhalla-as-a-service) and skip infrastructure entirely; (b) a $5–7/month Lightsail instance or Hetzner box running OSRM for one metro area's extract; (c) ECS Fargate with scheduled scale-to-zero. Whichever you pick, it lives *beside* the Amplify app and is called over HTTPS — do not try to force it inside.

### 8. Cost model — sources

All figures us-east-1, verified 2026-08-30:

- **Amplify Hosting** ([pricing](https://aws.amazon.com/amplify/pricing/)): build Standard (8 GB/4 vCPU) 1,000 min free then $0.01/min; Large $0.025/min; XLarge $0.10/min. Storage 5 GB free then $0.023/GB-mo. Data transfer out 15 GB free then **$0.15/GB**. SSR requests 500k free then $0.30/M. SSR duration 100 GB-hr free then $0.20/GB-hr. WAF $15/mo per app plus WAF charges.
- **Cognito** ([pricing](https://aws.amazon.com/cognito/pricing/)): Lite and Essentials each 10,000 MAU free (non-expiring); Lite $0.0055/MAU, Essentials $0.015/MAU, Plus $0.020/MAU. SAML/OIDC: 50 free then $0.015/MAU. Identity pools free.
- **AppSync** ([pricing](https://aws.amazon.com/appsync/pricing/)): $4.00 per million query/mutation operations; $2.00 per million real-time updates; $0.08 per million connection-minutes.
- **DynamoDB on-demand** ([pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/)): **$0.625 per million writes**, **$0.125 per million eventually-consistent reads** (strongly consistent = 2×), $0.25/GB-mo storage, 25 GB storage free.
- **Lambda:** 1M requests + 400,000 GB-seconds free per month, perpetually.
- **S3:** ~$0.023/GB-mo Standard, ~$0.005/1,000 PUT, ~$0.0004/1,000 GET.
- **NAT Gateway:** ~$0.045/hour (~$33/month) + $0.045/GB processed. **The budget killer.**
- **Aurora Serverless v2** ([Aurora pricing](https://aws.amazon.com/rds/aurora/pricing/)): $0.12/ACU-hour Standard, $0.156 I/O-Optimized; storage $0.10/GB-mo Standard vs $0.225 I/O-Optimized; I/O $0.20/million (Standard only).
- **RDS db.t4g.micro Postgres:** ~$0.016/hr ≈ **$12/month** compute alone, Single-AZ, before storage and backups. Cheapest always-on managed Postgres on AWS — still 3–4× the target budget.
- **Neon:** free tier 0.5 GB storage + 100 CU-hours/month (doubled from 50 in Oct 2025), PostGIS supported. Paid: $0.106/CU-hr (Launch), $0.35/GB-mo storage, no monthly minimum since Dec 2025.
- **Supabase:** free tier 500 MB DB, 1 GB storage, 5 GB egress — but **projects pause after 7 days with no API requests** and need a manual restart. Bad fit for an app whose only traffic is a nightly cron and occasional webhooks.
- **Cloudflare:** Workers Paid $5/mo. D1 free tier ~5 GB storage, 5M row reads/day, 100k row writes/day; paid ~$0.001/M rows read, $1.00/M rows written, $0.75/GB-mo. **10 GB hard cap per D1 database.**
- **Vercel:** Hobby $0 (personal, non-commercial; 1M edge requests, 100 GB transfer, cron limited); Pro $20/seat/mo with $20 usage credit.

**Aurora Serverless v2 scale-to-zero — what actually happens** ([auto-pause docs](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)):
- Set `MinCapacity=0` with `SecondsUntilAutoPause` between **300 (5 min, the default and minimum)** and 86,400.
- Requires Aurora PostgreSQL ≥ 16.3 / 15.7 / 14.12 / 13.15 (or Aurora MySQL ≥ 3.08.0).
- Instance charges go to zero while paused; **storage and backups still bill.**
- **Resume takes ~15 seconds**, or **30+ seconds if paused more than 24 hours.** Set client connect timeouts accordingly and implement retry logic. For a personal app this is a real UX tax — every first page load after idle stalls half a minute.
- **Auto-pause is disabled entirely by:** an attached **RDS Proxy**, logical/binlog replication, Aurora Global Database primary, zero-ETL to Redshift, Babelfish, or any provisioned instance in the cluster.
- **`pg_cron` jobs are silently skipped** while paused — Aurora does not wake for scheduled jobs. Your nightly work must come from an EventBridge-triggered Lambda that opens a connection.
- After maintenance wakes an instance, Aurora waits **at least 20 minutes** before pausing again.

Net: technically scale-to-zero exists, practically it is a poor match for an app with a nightly cron, an unpredictable webhook, and a latency-sensitive mobile UI.

---

## Existing devaultsecurity conventions to match

Source: read-only exploration of `/home/vivicat/devaultsecurity/`.

### What's there

A **single git repo** (`github.com/Oofles/devaultsecurity`, default branch **`master`** — not `main`) containing **two eras side by side**:

- **Current:** an **Astro 4** static site (theme: [Astro Sphere](https://github.com/markhorn-dev/astro-sphere)) in `src/`, deployed by **Amplify Hosting** (app id `dmw40r2ui3yeq`, branch `master`).
- **Legacy, dead but still committed:** a Hugo + Docsy site (`content/`, `layouts/`, `themes/docsy/`, `config.toml`, `deploy.sh`, `export.sh`, and a stale GitHub Actions workflow).

It is the **only** Amplify-deployed project in that directory. There are no other apps.

### Stack and versions

| | |
|---|---|
| Framework | **Astro `^4.4.13`**, static output, no SSR adapter |
| Interactive islands | **SolidJS `^1.8.15`** via `@astrojs/solid-js` (5 `.tsx` components) |
| Styling | **Tailwind CSS `^3.4.1`** via `@astrojs/tailwind`, `applyBaseStyles: false` |
| Language | **TypeScript `^5.3.3`** |
| Package manager | **npm** (`package-lock.json` v3 only — no pnpm/yarn) |
| Node version | **Unpinned** — no `engines`, no `packageManager`, no `.nvmrc` |
| Dev server | port **4321** |
| React / Next.js | **Not used anywhere** |

Other deps: `@astrojs/mdx`, `@astrojs/rss`, `@astrojs/sitemap`, `@astrojs/check`, `@tailwindcss/typography`, `clsx`, `tailwind-merge`, `fuse.js`, `sharp`.

### TypeScript conventions

`tsconfig.json` extends `astro/tsconfigs/strict` plus explicit `strictNullChecks`. `jsx: "preserve"`, `jsxImportSource: "solid-js"`. Path aliases: a single wildcard `"@*" → "src/*"` in tsconfig, **duplicated and out of sync** with explicit `vite.resolve.alias` entries in `astro.config.mjs` (which omits `@styles` despite it being imported). **For Lost Soles: declare aliases in exactly one place.**

### Amplify configuration — Gen 1 build spec, hosting only

`amplify.yml` is 16 lines of stock Astro static preset: `version: 1`, `npm ci` → `npm run build`, artifacts from `dist`, cache `node_modules`. **No `backend:` phase, no `appRoot`, no headers/redirects block.**

There is **no `amplify/` directory, no `backend.ts`, no `amplify_outputs.json`, no `team-provider-info.json`, no `aws-exports.js`, and no `@aws-amplify/*` packages.** This is pure Amplify Hosting pointed at a GitHub repo — **the user has no Amplify backend experience yet.** Lost Soles will be their first Gen 2 backend. Plan for that: the `amplify/` directory, `ampx sandbox`, secrets, and the CDK escape hatch are all new territory.

Deployment flow: push to `master` → Amplify builds → CDN deploy, automatic CloudFront invalidation, automatic SSL. Env vars set in the Amplify console.

### Domain / DNS

- `devaultsecurity.com` hard-coded as `site:` in `astro.config.mjs` — single source of truth for canonical URLs, RSS, robots.
- DNS in **Route 53**, **same AWS account**, region **us-east-1**.
- **A prior S3 + CloudFront + ACM architecture was retired** over unresolvable SSL cert problems. Its teardown was never verified from the filesystem. **Before adding `soles.devaultsecurity.com`, audit CloudFront for orphaned distributions carrying `devaultsecurity.com` aliases and clean stale Route 53 records** — this is the exact precondition for `CNAMEAlreadyExistsException`.
- Old blog content links to a `www.` subdomain with dead Hugo URL paths.

### CI

**There is none for the current site.** The only workflow, `.github/workflows/main.yml`, is the dead Hugo→S3 deployer: it triggers on `main` (repo default is `master`, so it never runs) and still contains the **placeholder** role ARN `arn:aws:iam::123456789012:role/MyHugoProject_S3Deployer`. Amplify's own build is the only gate. No lint, typecheck, or tests run on PRs. The migration brief states "no GitHub Actions needed" as a deliberate choice.

### Styling and structure

- **Tailwind, `darkMode: ["class"]`**, toggled by a non-bundled inline `public/js/theme.js`.
- **No custom color palette** — the entire design is monochrome `black`/`white` with opacity modifiers (`text-black/75 dark:text-white/75`).
- Font: **Atkinson Hyperlegible**, self-hosted `.woff` from `public/fonts/`, preloaded in `BaseHead.astro`.
- Custom keyframes `twinkle` (2s) and `meteor` (3s) drive decorative `TwinklingStars` / `MeteorShower` components.
- **No component library** — no shadcn, no Radix, no headless UI. Hand-rolled `.astro` components plus a few Solid `.tsx` islands.
- Utility helper `cn()` = `twMerge(clsx(...))` in `src/lib/utils.ts`, alongside `formatDate()` and `readingTime()`.
- `src/` layout: `components/` (`.astro` static, `.tsx` interactive), `content/` (zod-schema'd collections), `layouts/`, `pages/`, `lib/utils.ts`, `consts.ts`, `types.ts`, `styles/global.css`.
- **All site metadata and nav live in `src/consts.ts`** as UPPERCASE-keyed exported objects typed from `src/types.ts`. Nothing hardcoded in components. **Worth replicating.**
- SEO baked into a single `BaseHead.astro`: canonical URL, OG + Twitter `summary_large_image`, RSS alternate link, font preloads.
- External links always `target="_blank" rel="noopener noreferrer"`.
- Formatting by convention only: **2-space indent, double quotes, no semicolons.**

### Linting — declared but absent

`package.json` defines `lint` and `lint:fix` calling `eslint .`, but **eslint is not installed and no config exists anywhere**. No prettier config either. Both scripts are dead. Similarly, `build` is plain `astro build` with **no `astro check`**, despite `@astrojs/check` being a dependency — type checking was deliberately removed in commit `bf140fa "Fix Amplify build: Skip TypeScript type checking"`.

**For Lost Soles: fix this, don't inherit it.** Set up ESLint flat config + Prettier for real, and run `tsc --noEmit` in CI or the build. A gamified app with geometry math and OAuth token handling is exactly the kind of thing that needs type checking on the deploy path.

### Repo hygiene warts to NOT replicate

- **`node_modules/` is tracked in git** (2,229 files) despite being in `.gitignore`.
- `public.tar.gz` (~19 MB) and `resources/_gen/` build artifacts are committed.
- `.DS_Store` committed at repo root.
- 225 stale Hugo files remain tracked under a gitignored `public/`.
- `README.md` is verbatim Google Docsy boilerplate; `CONTRIBUTING.md` is Google's CLA template; `LICENSE` is inherited Apache 2.0. None reflect the project. **`CLAUDE.md` is the only authoritative doc.**
- `@astrojs/sitemap` is a dependency and `robots.txt.ts` + `BaseHead.astro` both reference `/sitemap-index.xml`, but `sitemap()` was never added to `integrations` — the sitemap is not being generated. Live bug.

### ⚠️ Security finding — act on this

`/home/vivicat/devaultsecurity/.claude/settings.local.json` contains several allowlist entries that are **full literal shell commands embedding what appear to be live AWS access key ID and secret access key values inline** (roughly seven occurrences across `export ...` and inlined `aws amplify get-job` / `list-jobs` invocations). The values were not read or reproduced.

The file is currently **untracked** (`git status` shows `?? .claude/`) and `.claude/` is **not** in `.gitignore` — so the credentials are *not yet* in git history, but one `git add .` would put them there permanently.

**Recommended, before any work on Lost Soles:**
1. Rotate/revoke that IAM access key in the AWS console.
2. Strip the credential-bearing entries from `settings.local.json`.
3. Add `.claude/settings.local.json` (or all of `.claude/*.local.json`) to `.gitignore` in both repos.
4. Never put credentials in a permissions allowlist — use an AWS named profile or SSO.

### Conventions to carry into Lost Soles

**Adopt:**
- npm + `package-lock.json`; no pnpm/yarn.
- TypeScript strict, `strictNullChecks` explicit.
- Tailwind, class-based dark mode, `cn()` = `twMerge(clsx(...))`.
- All site metadata/nav centralized in a typed `consts.ts`.
- One `BaseHead`-style component owning all SEO/meta.
- 2-space indent, double quotes, no semicolons.
- Amplify Hosting from GitHub as the only deploy path.
- Route 53 + Amplify auto-SSL — the thing that made them pick Amplify in the first place.

**Deliberately diverge:**
- **Next.js 15 App Router instead of Astro** — Lost Soles needs SSR, auth-gated routes, and server route handlers; Amplify's Next.js support is first-class and adapter-free, whereas Astro SSR on Amplify depends on a community adapter.
- **Pin Node** via `.nvmrc` + `engines` + an Amplify build-image setting. The unpinned Node in devaultsecurity is a latent build-breaker.
- **Real linting and type checking**, enforced in the build. Do not ship the dead `eslint .` script pattern.
- **A `backend:` phase in `amplify.yml`** running `npx ampx pipeline-deploy` — devaultsecurity has none because it has no backend.
- **Branch strategy:** devaultsecurity uses `master`. Pick `main` for the new repo and be consistent, or match `master` — but decide once, since Amplify branch names drive both deploy targets and per-branch secret namespaces.
- **Clean `.gitignore` from commit one** — `node_modules/`, `.DS_Store`, `.env*`, `.amplify/`, `amplify_outputs.json`, `.claude/*.local.json`, build artifacts.

**One inherited warning worth heeding:** git history (`ed8095b`, `8b4270d`, `8d97534`) shows repeated build failures where **Amplify's clean `npm ci` environment was stricter than local** — path aliases that resolved locally didn't resolve in CI, and a `src/layouts` directory was missing from the commit. Expect the same class of bug. Verify every new path alias and every new file actually lands in the commit before assuming a deploy will pass.

---

## Sources

- [AWS Amplify Gen 2 FAQ](https://docs.amplify.aws/react/how-amplify-works/faq/)
- [AWS Amplify Gen 1 documentation](https://docs.amplify.aws/gen1/)
- [Amplify Gen 1 maintenance-mode notice (amplify-cli#14881)](https://github.com/aws-amplify/amplify-cli/issues/14881)
- [Gen 2 for Gen 1 customers](https://docs.amplify.aws/react/start/migrate-to-gen2/)
- [AWS Amplify pricing](https://aws.amazon.com/amplify/pricing/)
- [Amplify support for Next.js](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html)
- [Deploying SSR applications with Amplify Hosting](https://docs.aws.amazon.com/amplify/latest/userguide/server-side-rendering-amplify.html)
- [Amplify Hosting deployment specification](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-deployment-specification.html)
- [Deploy an Astro.js app to Amplify Hosting](https://docs.aws.amazon.com/amplify/latest/userguide/get-started-astro.html)
- [Adding a custom domain managed by Route 53](https://docs.aws.amazon.com/amplify/latest/userguide/to-add-a-custom-domain-managed-by-amazon-route-53.html)
- [Setting up automatic subdomains for a Route 53 custom domain](https://docs.aws.amazon.com/amplify/latest/userguide/to-set-up-automatic-subdomains-for-a-Route-53-custom-domain.html)
- [Troubleshooting custom domains](https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-custom-domains.html)
- [Configure Functions](https://docs.amplify.aws/react/build-a-backend/functions/configure-functions/)
- [Scheduling Functions](https://docs.amplify.aws/react/build-a-backend/functions/scheduling-functions/)
- [Modify Amplify-generated Lambda resources with CDK](https://docs.amplify.aws/react/build-a-backend/functions/modify-resources-with-cdk/)
- [Set up Amplify REST API](https://docs.amplify.aws/react/build-a-backend/add-aws-services/rest-api/set-up-rest-api/)
- [Set up Amplify HTTP API](https://docs.amplify.aws/react/build-a-backend/add-aws-services/rest-api/set-up-http-api/)
- [Add custom CDK resources](https://docs.amplify.aws/react/build-a-backend/add-aws-services/custom-resources/)
- [Connect to existing MySQL and PostgreSQL databases](https://docs.amplify.aws/react/build-a-backend/data/connect-to-existing-data-sources/connect-postgres-mysql-database/)
- [Set up Storage](https://docs.amplify.aws/react/build-a-backend/storage/set-up-storage/)
- [Storage authorization rules](https://docs.amplify.aws/react/build-a-backend/storage/authorization/)
- [Secrets and environment variables](https://docs.amplify.aws/react/deploy-and-host/fullstack-branching/secrets-and-vars/)
- [defineFunction VPC limitation (amplify-backend#1112)](https://github.com/aws-amplify/amplify-backend/issues/1112)
- [Amplify Hosting deployment skew protection](https://aws.amazon.com/about-aws/whats-new/2025/03/aws-amplify-hosting-deployment-skew-protection-support/)
- [Amplify Hosting WAF GA](https://aws.amazon.com/about-aws/whats-new/2025/03/aws-amplify-hosting-web-application-firewall-protection)
- [Amazon Cognito pricing](https://aws.amazon.com/cognito/pricing/)
- [AWS AppSync pricing](https://aws.amazon.com/appsync/pricing/)
- [DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/)
- [Amazon Aurora pricing](https://aws.amazon.com/rds/aurora/pricing/)
- [Aurora Serverless v2 scaling to zero / auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)
- [Aurora Serverless v2 supports scaling to zero (announcement)](https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-aurora-serverless-v2-scaling-zero-capacity)
- [Managing spatial data with the PostGIS extension on Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Appendix.PostgreSQL.CommonDBATasks.PostGIS.html)
- [Extensions supported for Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraPostgreSQLReleaseNotes/AuroraPostgreSQL.Extensions.html)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
