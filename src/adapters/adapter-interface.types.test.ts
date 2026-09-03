import { describe, expect, it } from "vitest"

import type { NormalizedIngest } from "@/src/domain/activity"

import type {
  AckResult,
  IngestCommand,
  IngestJob,
  InboundRequest,
  SourceAdapter,
} from "./types"

/**
 * COMPILE-TIME assertions, ticket 0026. Checked by `tsc --noEmit`, not by vitest — the
 * runtime `it()` blocks at the bottom exist so the file is also a normal test file and a
 * failure is legible in CI output.
 *
 * Named `adapter-interface.types.test.ts` and not `types.types.test.ts`: the convention
 * from 0025 is `<module>.types.test.ts`, and the module here is literally called `types`.
 * Matching the `*.types.test.ts` suffix is what matters — it is what grants the
 * `_`-prefixed unused-binding exemption in `eslint.config.mjs`.
 *
 * Four of this ticket's acceptance criteria are properties of the TYPE and cannot be
 * checked at runtime at all: an interface has no reflectable members. Asserting them
 * here is the only way they are checked by anything.
 */

/** True iff A and B are exactly the same type — not merely mutually assignable. */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

/** The keys of T that may be omitted from an object literal. */
type OptionalKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? K : never
}[keyof T]

/* ── `listSince` is MANDATORY (D-140) ───────────────────────────────────────── */

// The reconciliation sweep that covers silently dropped webhooks. If it ever becomes
// optional, every push adapter quietly stops being reconcilable and nothing tells us —
// the sweep just finds no adapters that implement it.
//
// @ts-expect-error — an adapter without `listSince` MUST NOT compile.
const _noListSince: SourceAdapter = {
  id: "gpslogger",
  accept: async () => ({ status: 200, commands: [] }),
  fetchRaw: async () => ({ body: Buffer.alloc(0), contentType: "application/json", ext: "json" }),
  normalize: () => ({ activity: {} as NormalizedIngest["activity"] }),
}

/* ── `refreshCredentials` is the ONLY optional member ───────────────────────── */

// Stated as an equality rather than an inclusion: this fails both when
// `refreshCredentials` is made required AND when a second member is made optional. The
// second direction is the one that matters — optionality is how a mandatory phase erodes.
type _OnlyOptional = Expect<Equals<OptionalKeys<SourceAdapter>, "refreshCredentials">>

/* ── `normalize` is SYNCHRONOUS ─────────────────────────────────────────────── */

// The migration seam's purity is enforced by CI (0027), but the signature is what makes
// the enforcement possible: a `Promise` return would let an `await fetch` hide inside the
// one function that must survive to replay the S3 archive years from now.
type _NormalizeSync = Expect<Equals<ReturnType<SourceAdapter["normalize"]>, NormalizedIngest>>

// ...and it is not merely "not declared async" — nothing about it is awaitable.
type _NormalizeNotThenable = Expect<
  Equals<Extract<ReturnType<SourceAdapter["normalize"]>, PromiseLike<unknown>>, never>
>

/* ── `SourceAdapter` is generic in TCreds, defaulting to `unknown` ──────────── */

// `unknown` and not `any`: a credential blob must be narrowed before it is used, and an
// adapter that never declares its own credential type should not get to skip that.
type _CredsDefault = Expect<Equals<Parameters<SourceAdapter["fetchRaw"]>[1], unknown>>

// The generic actually threads through, rather than being a decorative parameter.
type _CredsThreaded = Expect<
  Equals<Parameters<SourceAdapter<{ token: string }>["fetchRaw"]>[1], { token: string }>
>

/* ── `IngestCommand`: exactly four variants, all inert ──────────────────────── */

type _FourVariants = Expect<
  Equals<IngestCommand["kind"], "ingest" | "reingest" | "retract" | "disconnect">
>

// "Intents, never side effects" made structural: a variant is data only, so no member of
// any variant is callable. A command that can DO something is a command that will be
// executed somewhere other than the pipeline.
type _NoBehaviour = Expect<
  Equals<Extract<IngestCommand[keyof IngestCommand], (...args: never[]) => unknown>, never>
>

/* ── `IngestJob` carries no vendor-specific field ───────────────────────────── */

// The temptation this ticket exists to resist. Spelled out as an exact key set so that
// adding `aspectType` or `ownerId` "just for now" stops the build here, where the reason
// is written down, rather than at 0027's grep, where it is not.
type _JobKeys = Expect<
  Equals<
    keyof IngestJob,
    "ingestKey" | "userId" | "source" | "externalId" | "command" | "meta" | "enqueuedAt"
  >
>

// `command` is the narrow kind union, not `IngestCommand` — see the note on
// `IngestCommandKind`. If this were `IngestCommand`, the type would nest for ever.
type _JobCommand = Expect<Equals<IngestJob["command"], "ingest" | "reingest">>

// Opaque. The moment this is anything but `unknown`, the queue knows a vendor's shape.
type _JobMeta = Expect<Equals<IngestJob["meta"], unknown>>

/* ── `AckResult` can express a deletion (D-187) ─────────────────────────────── */

// `01-architecture.md` had `jobs: IngestJob[]`, which could not: a delete webhook and a
// deauthorisation both arrive at `accept()` and neither is a job. This is the assertion
// that the amendment stuck.
type _AckCarriesCommands = Expect<Equals<AckResult["commands"], IngestCommand[]>>
type _AckHasNoJobs = Expect<Equals<Extract<keyof AckResult, "jobs">, never>>

/* ── `InboundRequest` hands over BYTES ──────────────────────────────────────── */

// A signature is computed over the exact bytes sent. Parse the body before verifying it
// and the signature can never be checked again — key order and whitespace are gone.
type _RawBodyIsBytes = Expect<Equals<InboundRequest["rawBody"], Buffer>>

describe("the adapter interface behaves as the contract's reasoning requires", () => {
  it("compiles — every assertion above is enforced by tsc --noEmit", () => {
    expect(true).toBe(true)
  })

  it("an ack with no commands is a valid result: accepted and intentionally dropped", () => {
    const ack: AckResult = { status: 200, commands: [] }
    expect(ack.commands).toHaveLength(0)
  })

  it("a retract command carries no job, because a deleted activity has nothing to fetch", () => {
    const retract: IngestCommand = { kind: "retract", source: "gpslogger", externalId: "17" }
    expect("job" in retract).toBe(false)
  })
})
