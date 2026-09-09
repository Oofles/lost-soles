import {
  decodeDeltaBlob,
  decodeExploredBlob,
  type DeltaBlob,
  type ExploredBlob,
} from "@/src/domain/explored-blob"

/**
 * THE INSTRUMENTED SEAM. Ticket `0054`, acceptance criterion 3.
 *
 * *"A warm start does no LEB128 parsing (asserted by instrumenting the decoder)."* The
 * decoders themselves live in `src/domain/explored-blob.ts` and are shared with the
 * ingest Lambda, which is exactly where a counter must NOT go: that module is pure, and a
 * mutable module-level counter in it would be a fact about the browser leaking into the
 * scoring path.
 *
 * So the counter is here, on the one path the client is allowed to decode through. The
 * assertion the criterion asks for is therefore also a structural claim: if a future
 * caller reaches for `decodeExploredBlob` directly, the warm-start test stops proving
 * anything — and that is what `blobDecodes` staying at 0 is really watching.
 *
 * `lastBlobMs` is criterion 10's number. It is read by the `?fog=debug` readout, because
 * *"under ~150 ms on the target phone"* is a fact about a phone and cannot be established
 * on a laptop or in CI.
 */
export const decodeStats = {
  /** `LSFG` decodes. Must be 0 across a warm start served entirely from IndexedDB. */
  blobDecodes: 0,
  /** `LSFD` decodes. One per applied hop. */
  deltaDecodes: 0,
  /** Milliseconds the last varint parse took, on its own. */
  lastParseMs: 0,
  /**
   * Milliseconds from `LSFG` bytes to a usable `ExploredSet` — the parse AND the
   * `Set<string>` build. Criterion 10's number, and the one the operator reads, because
   * `02` §6.3 prices the two together (*"decode + Set construction, one time"*) and a
   * figure that omitted the ~50 ms `Set` build would be measuring the cheaper half.
   *
   * Written by `ExploredSet.fromBlob`, which is the only place both halves are in scope.
   */
  lastBlobMs: 0,
  /** Cells in the last `LSFG` decoded, so the readout can report ms against a size. */
  lastBlobCells: 0,
}

export function resetDecodeStats(): void {
  decodeStats.blobDecodes = 0
  decodeStats.deltaDecodes = 0
  decodeStats.lastParseMs = 0
  decodeStats.lastBlobMs = 0
  decodeStats.lastBlobCells = 0
}

/**
 * `performance.now()` where it exists, `Date.now()` otherwise.
 *
 * Not for portability theatre — Node 22 has `performance` — but because this number is
 * reported to a human as a measurement, and silently falling back to a millisecond clock
 * is better than a `TypeError` on a surface whose whole job is to tell the operator what
 * happened.
 */
export const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now()

export function decodeExplored(bytes: Uint8Array): ExploredBlob {
  const started = now()
  const blob = decodeExploredBlob(bytes)
  decodeStats.blobDecodes++
  decodeStats.lastParseMs = now() - started
  decodeStats.lastBlobCells = blob.cells.length
  return blob
}

export function decodeDelta(bytes: Uint8Array): DeltaBlob {
  const delta = decodeDeltaBlob(bytes)
  decodeStats.deltaDecodes++
  return delta
}

/**
 * base64 → bytes, for the delta chain the update route ships inline.
 *
 * `atob` rather than `Buffer`: this module is bundled for the browser, and importing
 * `node:buffer` into a client chunk is how a polyfill ends up in a phone's download for
 * the sake of one 350-byte payload. `atob` is in every browser the app supports and in
 * Node 22, so the tests run against the same function the phone does.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
