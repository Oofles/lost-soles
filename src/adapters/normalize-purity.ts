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

import { ImpurityError, runWithPurityTraps } from "@/src/purity/traps";
import type { NormalizedIngest, RawArchiveRef } from "@/src/domain/activity";

import type { IngestJob, SourceAdapter } from "./types";

export { ImpurityError };

export interface NormalizeArgs {
  raw: Buffer;
  ref: RawArchiveRef;
  job: IngestJob;
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
  return runWithPurityTraps(
    "normalize()",
    "  D-100 / D-121.2 — normalize() is the migration seam. It must replay the S3 archive\n" +
      "  years from now, offline, with the vendor gone. Anything it reads that is not an\n" +
      "  argument is a dependency that will not be there. Move it to fetchRaw() (phase 2),\n" +
      "  or carry it on the IngestJob.",
    () => {
      const first = adapter.normalize(args.raw, args.ref, args.job);
      const second = adapter.normalize(args.raw, args.ref, args.job);

      if (JSON.stringify(first) !== JSON.stringify(second)) {
        throw new Error(
          `normalize() is not deterministic: two calls with identical arguments returned ` +
            `different results.\n` +
            "  No global trap can catch this one — the usual causes are a module-level\n" +
            "  counter, a cache, or mutating the input Buffer. D-100 / D-121.2: the rebuild\n" +
            "  drill replays the archive and must get the same activity back every time.",
        );
      }

      return first;
    },
  );
}
