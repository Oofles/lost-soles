import { Stub } from "@/components/stub"

// §7.5 — tap a row, get the rendered markdown detail. Read-only: no editing, no
// closing, no reordering, no comments, no kanban board (§7.6).
export default async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <Stub route={`/dev/tickets/${id}`} becomes="Ticket detail" note="Read-only rendered markdown. No editing, no closing, no kanban (§7.6)." />
}
