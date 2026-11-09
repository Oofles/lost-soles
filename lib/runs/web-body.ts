import { gzipSync } from "node:zlib"

import type { WebRunInput } from "@/lib/trace-web/web"

/**
 * `GET /api/runs/web`'s body as the bytes the handler emits. Server only. Ticket `0321`, D-460.
 *
 * ─── GZIPPED BY THE HANDLER, BECAUSE NOTHING DOWNSTREAM DOES IT ─────────────────────────────
 *
 * Amplify compute refuses a response whose raw body passes about 5.94 MB, answering 413 with an
 * empty body, and never compresses a route handler's JSON in transit. So the cap counts exactly
 * these bytes. At year-five scale (D-451: 1,000 runs × 8 km at ~96 pts/km) the raw JSON is well
 * past the cap, and gzipped it is about half of it (`web-body.test.ts`). The route sets
 * `Content-Encoding: gzip` and the browser decodes transparently, so `fetchTraceWebBody` reads the
 * same text as before. Every browser sends `Accept-Encoding: gzip`, so the encoding is not negotiated.
 */
export function encodeWebBody(runs: WebRunInput[]): Buffer {
  return gzipSync(Buffer.from(JSON.stringify({ runs }), "utf8"))
}

/** D-460's measured ceiling: 5,936,087 bytes answered 200 and about 6.03 MB answered 413. */
export const AMPLIFY_RESPONSE_CAP_BYTES = 5_936_087
