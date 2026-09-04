/**
 * T4 — THE PURITY HARNESS. Contract §5 check 4, ticket 0027.
 *
 * `normalize()` is the migration seam: the one function that must still work years from
 * now, replaying the S3 archive, after the client code that fetched those bytes is gone
 * and the vendor's API is unreachable. That is only true if it depends on NOTHING but its
 * arguments. This module is how that is proven rather than asserted.
 *
 * Exported deliberately, and not inlined into a test: `0036` calls it, and so does the
 * rebuild drill in capability `16`. One line per adapter is the whole point —
 *
 *     const out = assertNormalizeIsPure(adapter, { raw, ref, job })
 *
 * NOT a test file, so it holds no vitest import and can be called from a plain script.
 * It throws `ImpurityError` on a violation; a caller in a test asserts on that.
 */

import type { NormalizedIngest, RawArchiveRef } from "@/src/domain/activity"

import type { IngestJob, SourceAdapter } from "./types"

/** Thrown when `normalize()` reaches for something outside its arguments. */
export class ImpurityError extends Error {
  readonly capability: string

  constructor(capability: string, detail: string) {
    super(
      `normalize() is not pure: it used ${capability}. ${detail}\n` +
        "  D-100 / D-121.2 — normalize() is the migration seam. It must replay the S3 archive\n" +
        "  years from now, offline, with the vendor gone. Anything it reads that is not an\n" +
        "  argument is a dependency that will not be there. Move it to fetchRaw() (phase 2),\n" +
        "  or carry it on the IngestJob.",
    )
    this.name = "ImpurityError"
    this.capability = capability
  }
}

export interface NormalizeArgs {
  raw: Buffer
  ref: RawArchiveRef
  job: IngestJob
}

/** Saves a global, installs a trap, and knows how to put the original back. */
interface Trap {
  install(): void
  restore(): void
}

function propertyTrap(
  holder: Record<string, unknown>,
  key: string,
  capability: string,
  detail: string,
): Trap {
  const had = key in holder
  const original = holder[key]
  return {
    install() {
      Object.defineProperty(holder, key, {
        configurable: true,
        writable: true,
        value: () => {
          throw new ImpurityError(capability, detail)
        },
      })
    },
    restore() {
      if (had) {
        Object.defineProperty(holder, key, {
          configurable: true,
          writable: true,
          value: original,
        })
      } else {
        delete holder[key]
      }
    },
  }
}

/**
 * `new Date()` reads the clock; `new Date("2026-01-01T00:00:00Z")` does not. Banning the
 * whole constructor would make `normalize()` unwritable — parsing a source's timestamp is
 * exactly its job — so the trap is on the ZERO-ARGUMENT form and on `Date.now` only.
 *
 * This distinction is the difference between a harness adapters can actually satisfy and
 * one they route around, and a harness that gets routed around protects nothing.
 */
function dateTrap(): Trap {
  const RealDate = globalThis.Date

  // A Proxy rather than a subclass: `ConstructorParameters<DateConstructor>` resolves to
  // the last overload, so a subclass constructor cannot be typed to observe the
  // zero-argument call at all. The Proxy sees the real `argArray` and keeps `instanceof
  // Date`, every static, and the prototype chain intact — which matters, because an
  // adapter that parses a timestamp gets a genuine Date back.
  const PureDate = new Proxy(RealDate, {
    construct(target, argArray: unknown[], newTarget) {
      if (argArray.length === 0) {
        throw new ImpurityError(
          "new Date()",
          "Reading the current time makes the output depend on WHEN it ran. " +
            "Parsing a timestamp — new Date(someString) — is fine and is not trapped.",
        )
      }
      return Reflect.construct(target, argArray, newTarget)
    },
    get(target, prop, receiver) {
      if (prop === "now") {
        return () => {
          throw new ImpurityError(
            "Date.now()",
            "Reading the current time makes the output depend on WHEN it ran. " +
              "An ingest timestamp belongs on the IngestJob, set at accept().",
          )
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })

  return {
    install() {
      globalThis.Date = PureDate
    },
    restore() {
      globalThis.Date = RealDate
    },
  }
}

const NETWORK =
  "The network is phase 2. fetchRaw() has already run and archived the bytes; " +
  "normalize() is handed those bytes and must not reach for more."

const RANDOM =
  "Randomness makes the output non-reproducible, so replaying the same archived " +
  "bytes would produce a different activity. Derive ids from the input instead."

function traps(): Trap[] {
  const g = globalThis as unknown as Record<string, unknown>
  const list: Trap[] = [
    propertyTrap(g, "fetch", "globalThis.fetch", NETWORK),
    propertyTrap(g, "XMLHttpRequest", "XMLHttpRequest", NETWORK),
    propertyTrap(g, "WebSocket", "WebSocket", NETWORK),
    dateTrap(),
    propertyTrap(Math as unknown as Record<string, unknown>, "random", "Math.random()", RANDOM),
    propertyTrap(
      performance as unknown as Record<string, unknown>,
      "now",
      "performance.now()",
      "A monotonic clock is still a clock.",
    ),
  ]

  // `crypto` is a getter on globalThis in some runtimes, so trap its members rather than
  // the object. A missing member is skipped: absent is already un-callable.
  const cryptoObj = (globalThis as unknown as { crypto?: Record<string, unknown> }).crypto
  if (cryptoObj) {
    for (const member of ["randomUUID", "getRandomValues"]) {
      if (member in cryptoObj) {
        list.push(propertyTrap(cryptoObj, member, `crypto.${member}()`, RANDOM))
      }
    }
  }

  return list
}

/**
 * Run `adapter.normalize()` with every impure capability trapped, and prove the result is
 * reproducible. Returns what `normalize()` returned, so the caller can go on asserting
 * about its content.
 *
 * Throws `ImpurityError` if it reached for a trapped capability, and a plain `Error` if it
 * returned something different the second time — which catches the impurities no trap can
 * see, such as a module-level counter or a mutated input.
 */
export function assertNormalizeIsPure<TCreds>(
  adapter: SourceAdapter<TCreds>,
  args: NormalizeArgs,
): NormalizedIngest {
  const installed = traps()
  for (const t of installed) t.install()

  try {
    const first = adapter.normalize(args.raw, args.ref, args.job)
    const second = adapter.normalize(args.raw, args.ref, args.job)

    if (JSON.stringify(first) !== JSON.stringify(second)) {
      throw new Error(
        `normalize() is not deterministic: two calls with identical arguments returned ` +
          `different results.\n` +
          "  No global trap can catch this one — the usual causes are a module-level\n" +
          "  counter, a cache, or mutating the input Buffer. D-100 / D-121.2: the rebuild\n" +
          "  drill replays the archive and must get the same activity back every time.",
      )
    }

    return first
  } finally {
    // Reverse order, so a trap layered over another restores correctly.
    for (const t of [...installed].reverse()) t.restore()
  }
}
