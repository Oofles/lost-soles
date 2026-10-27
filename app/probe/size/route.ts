import { createHash, timingSafeEqual } from "node:crypto"

import { NextResponse, type NextRequest } from "next/server"

import { withNoStore } from "@/lib/http/no-store"

/**
 * TEMPORARY — ticket `0320`. Removed in the commit after its measurement.
 *
 * Does Amplify compute's response-size cap apply to the raw body or the gzipped one? This returns
 * a synthetic JSON body of `?mb=N` megabytes, shaped like `/api/runs/web` (runs of number pairs)
 * but carrying NO coordinates and nothing about anyone: deterministic made-up integers. It sits
 * outside `/api/` and is exempted in `middleware.ts`'s matcher for the same short life, because
 * the probe cannot hold the operator's session. In its place, a request must carry
 * `x-probe-auth`, whose SHA-256 is below; the value itself never entered the repo. Anything else
 * gets the same 404 as a missing route.
 */

export const dynamic = "force-dynamic"

const PROBE_DIGEST = "f77beb5bb33a70a53125e906b8250a9639007ac90a221b93303288aeb0f275a3"
const MAX_MB = 16

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 })

function admitted(presented: string | null): boolean {
  if (!presented) return false
  const got = createHash("sha256").update(presented).digest()
  return timingSafeEqual(got, Buffer.from(PROBE_DIGEST, "hex"))
}

async function handleGet(request: NextRequest): Promise<NextResponse> {
  if (!admitted(request.headers.get("x-probe-auth"))) return notFound()
  const mb = Math.min(MAX_MB, Math.max(1, Number(request.nextUrl.searchParams.get("mb")) || 1))
  const target = mb * 1024 * 1024
  let seed = 42
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648)
  const runs: { id: string; pts: number[][] }[] = []
  let size = 0
  while (size < target) {
    let a = next() % 1000000
    let b = next() % 1000000
    const pts: number[][] = []
    for (let i = 0; i < 400; i++) {
      a += (next() % 201) - 100
      b += (next() % 201) - 100
      pts.push([a, b])
    }
    runs.push({ id: `r${runs.length}`, pts })
    size += 400 * 17 + 20
  }
  return NextResponse.json({ runs })
}

export const GET = withNoStore(handleGet)
