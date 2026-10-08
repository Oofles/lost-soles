"use client"

import { useEffect } from "react"

import type { RunSummary } from "@/lib/runs/wire"

/**
 * THE SEQUENCE'S SEAT. Ticket `0078` lays it out; `0079`–`0084` fill it.
 *
 * Mounted over the end state by an autoplay entry or `⟲ Relive`, unmounted by `onDone`. No beat
 * exists yet, so it finishes at once and the page is the end state again — which is the contract
 * every beat ticket inherits: whatever plays here, it ends by calling `onDone`, and the end state
 * is already underneath.
 */
export function RunSequence({ onDone }: { summary: RunSummary; onDone: () => void }) {
  useEffect(() => {
    onDone()
  }, [onDone])
  return null
}
