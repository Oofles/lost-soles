/**
 * THE ONE API TIMEOUT. Ticket `0113`, `06-ui-ux.md` §9.5:
 * *"API timeout 10 s, then queue. No request is allowed to hold a screen."*
 *
 * Every browser call to this app's API — the `fetch` routes under `/api/` and the AppSync calls
 * through Amplify's data client — runs inside `withApiTimeout`. What happens AFTER the timeout is
 * the caller's, and it is always the same two answers: a write stays in its queue and retries
 * (`lib/log/queue.ts`), a read falls back to whatever is cached (the fog's IndexedDB set, the
 * plinth's cached standing) or to "nothing to say". Nothing waits on a spinner.
 *
 * ─── WHY A RACE AS WELL AS AN ABORT ─────────────────────────────────────────
 *
 * The signal aborts a `fetch` — its headers AND its body, so a response that stalls halfway
 * through `arrayBuffer()` is cut off too. But Amplify's data client takes no signal, and a test's
 * hung endpoint may ignore one, so the returned promise also RACES the timer: whatever the
 * underlying call does, the caller hears back at 10 s.
 */

export const API_TIMEOUT_MS = 10_000

export class ApiTimeoutError extends Error {
  constructor(
    readonly what: string,
    readonly ms: number,
  ) {
    super(`${what} timed out after ${ms} ms`)
    this.name = "ApiTimeoutError"
  }
}

/**
 * Run `call`, and reject with `ApiTimeoutError` if it has not settled within `ms`. The signal it is
 * handed is aborted at the same moment, so a `fetch` given it releases its connection.
 */
export function withApiTimeout<T>(
  what: string,
  call: (signal: AbortSignal) => Promise<T>,
  ms: number = API_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new ApiTimeoutError(what, ms)
      controller.abort(error)
      reject(error)
    }, ms)
    let pending: Promise<T>
    try {
      pending = call(controller.signal)
    } catch (error) {
      clearTimeout(timer)
      reject(error)
      return
    }
    pending.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
