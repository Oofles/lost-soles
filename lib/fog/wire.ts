/**
 * THE DELIVERY ENDPOINT'S CONTRACT. Ticket `0054`. `05-fog-of-war.md` §7.3, §7.4;
 * `02-data-model.md` §6.4, §6.5; `01-architecture.md` §5.
 *
 * Shared by `app/api/fog/route.ts` (the server half) and `lib/fog/transport.ts` (the
 * browser half), so the two cannot drift. It carries no logic — the decision this file
 * records is a shape.
 *
 * ─── WHY THE BROWSER TALKS TO US AND NOT TO S3 ──────────────────────────────
 *
 * `01-architecture.md` §5 has a server component calling `getUrl()` for a short-lived
 * presigned GET on the blob. That was written before the delta chain existed, and D-220
 * made it unworkable: the chain is walked BACKWARDS, so a client learns hop N-1's key only
 * after reading hop N's header. Presigning a chain would be one round trip to us per hop,
 * to save a transfer of ~350 bytes each.
 *
 * There is a second reason, and it is the one that actually forced the change. The worker
 * writes `users/<cognito-sub>/…` (`02` T1: *"the `<uid>` in every S3 key"*), while
 * `amplify/storage/resource.ts` grants the browser `users/{entity_id}/*`, where
 * `entity_id` is the **identity-pool identity id** — a different string. Nothing a browser
 * can hold has ever been able to read what the pipeline writes. `0049` found this and
 * assigned it here.
 *
 * So the browser asks THIS origin, the SSR compute role reads S3, and the identity used is
 * the `sub` re-derived from the verified session (`08-security-privacy.md` §5.3 — never a
 * uid from a query string). See D-228.
 *
 * ─── TWO OBJECTS, TWO ROUTES, TWO CACHE POLICIES ────────────────────────────
 *
 *   GET /api/fog?since=<gen>      the manifest, resolved into a PLAN. `no-store`.
 *   GET /api/fog/blob/<gen>       the `LSFG` bytes for one generation. `immutable`.
 *
 * The split is `05` §7.3's, kept intact: one mutable object that is revalidated on every
 * load, and generation-named immutable objects that no cache anywhere can ever have a
 * stale copy of.
 */

/** The manifest route. Always fetched with `?since` and a matching `If-None-Match`. */
export const FOG_UPDATE_PATH = "/api/fog"

/** The blob route. Generation-named, so the browser HTTP cache is safe to trust. */
export const fogBlobPath = (generation: number): string => `/api/fog/blob/${generation}`

/**
 * What the client must do next. Resolved on the server because the server is what holds
 * the manifest — the client sends its cached generation and is told the answer, rather
 * than fetching a manifest and re-deriving the same three-way branch.
 */
export type FogPlan =
  /** `manifest.generation === since`. Nothing else is fetched. `02` §6.4 step 3. */
  | "up-to-date"
  /** `since >= manifest.deltasFrom`. `deltas` carries the whole chain. Step 4. */
  | "delta"
  /** Too far behind, or no cache at all. Take `/api/fog/blob/<generation>`. Step 5. */
  | "full"
  /**
   * No manifest exists yet — the user has ingested nothing. An explored set of size zero,
   * which is a renderable answer (full fog, no revealed ground) rather than an error.
   * `02` §6.4's steps 3-5 assume a user with at least one activity; this is the case they
   * do not cover, and answering `full` instead would send the client after a blob that
   * does not exist.
   */
  | "empty"

export interface FogUpdate {
  /** The manifest's generation — what the client will be at once it applies this. */
  generation: number
  /**
   * D-115. The client refuses to render anything but 10 and discards its cache
   * (`02` §6.4: *"a silent mis-parse of cell IDs looks like territory teleporting"*).
   * Present in the payload precisely so the refusal can happen BEFORE any bytes are
   * fetched.
   */
  res: number
  /** The manifest's own count, used only to sanity-check a decode. */
  cellCount: number
  /** The oldest generation the delta chain still reaches. `05` §7.3. */
  deltasFrom: number
  plan: FogPlan
  /**
   * `LSFD` objects, base64, in APPLICATION order — oldest first. Only on `plan: "delta"`.
   *
   * INLINE RATHER THAN AS URLS, because a delta is 100–350 bytes (R3 §2) — *"smaller than
   * the HTTP headers requesting it"* — and the whole retained chain is ~7 KB. The client
   * still validates `fromGen === state.generation` on each hop before applying it
   * (`02` §6.5); the server having assembled the chain does not make the client trust it.
   */
  deltas?: string[]
}

/**
 * A 304 is the common case and carries no body, so the client's transport reports it as a
 * status rather than as a `FogUpdate`. `02` §6.4: *"this is the common case, and it costs
 * one 304."*
 */
export type FogUpdateResponse =
  | { status: 200; update: FogUpdate }
  | { status: 304 }
