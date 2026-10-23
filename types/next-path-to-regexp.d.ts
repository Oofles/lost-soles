/**
 * The path matcher Next itself uses for `next.config.ts` `headers()` sources, compiled into
 * `next` without types. Ticket 0143: `lib/security-headers.test.ts` matches the config's
 * `source` against real paths with the same engine Next does, rather than a hand-rolled regex
 * that could agree with itself and disagree with Next. Only the one function it uses.
 */
declare module "next/dist/compiled/path-to-regexp" {
  export function pathToRegexp(path: string): RegExp
}
