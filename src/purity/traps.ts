/**
 * PURITY TRAPS — one definition of "pure", shared by everything that needs to assert it.
 *
 * Extracted from `src/adapters/normalize-purity.ts` (ticket 0027) when ticket 0029 needed the
 * same guarantee for `selectActivitySkills`. Two implementations of "pure" would eventually
 * trap different things, and then the word would quietly mean two things — the same argument
 * that put the rules validator in one place rather than one copy per caller.
 *
 * Lives outside `src/adapters/` because `src/rules/` must not depend on the adapter boundary.
 */

/** Thrown when a function that must be pure reaches for something outside its arguments. */
export class ImpurityError extends Error {
  readonly capability: string
  readonly where: string

  constructor(where: string, capability: string, detail: string, why?: string) {
    super(`${where} is not pure: it used ${capability}. ${detail}${why ? `\n${why}` : ""}`)
    this.name = "ImpurityError"
    this.capability = capability
    this.where = where
  }
}

/** Saves a global, installs a trap, and knows how to put the original back. */
interface Trap {
  install(): void
  restore(): void
}

function propertyTrap(
  where: string,
  why: string,
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
          throw new ImpurityError(where, capability, detail, why)
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
function dateTrap(where: string, why: string): Trap {
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
          where,
          "new Date()",
          "Reading the current time makes the output depend on WHEN it ran. " +
            "Parsing a timestamp — new Date(someString) — is fine and is not trapped.",
          why,
        )
      }
      return Reflect.construct(target, argArray, newTarget)
    },
    get(target, prop, receiver) {
      if (prop === "now") {
        return () => {
          throw new ImpurityError(
            where,
            "Date.now()",
            "Reading the current time makes the output depend on WHEN it ran. " +
              "Derive it from the input, or take it as an argument.",
            why,
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

function traps(where: string, why: string): Trap[] {
  const g = globalThis as unknown as Record<string, unknown>
  const list: Trap[] = [
    propertyTrap(where, why, g, "fetch", "globalThis.fetch", NETWORK),
    propertyTrap(where, why, g, "XMLHttpRequest", "XMLHttpRequest", NETWORK),
    propertyTrap(where, why, g, "WebSocket", "WebSocket", NETWORK),
    dateTrap(where, why),
    propertyTrap(where, why, Math as unknown as Record<string, unknown>, "random", "Math.random()", RANDOM),
    propertyTrap(
      where,
      why,
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
        list.push(propertyTrap(where, why, cryptoObj, member, `crypto.${member}()`, RANDOM))
      }
    }
  }

  return list
}

/**
 * Run `fn` with every impure capability trapped, then restore. Returns what `fn` returned.
 *
 * `where` names the caller in any `ImpurityError`, and `why` carries that caller's OWN reason
 * for needing purity — the decisions it protects. A message saying only "not pure" invites the
 * reader to conclude the rule is pedantry; one that says what it buys can be weighed.
 */
export function runWithPurityTraps<T>(where: string, why: string, fn: () => T): T {
  const installed = traps(where, why)
  for (const t of installed) t.install()
  try {
    return fn()
  } finally {
    // Reverse order, so a trap layered over another restores correctly.
    for (const t of [...installed].reverse()) t.restore()
  }
}
