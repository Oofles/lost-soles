import { Stub } from "@/components/stub"

import { ActivityKind } from "./activity-kind"

// §3 — "the most important screen in the app, and it is not really a screen".
// Auto-plays on new import, replays on demand. This is where the budget goes (P2).
//
// `0244` mounts the kind correction under the stub; `0078` builds the route around it and
// places it in the persistent end state.
export default async function RunMoment({ params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params
  return (
    <>
      <Stub route={`/run/${activityId}`} becomes="The post-run moment" note="Return from the Fog. Auto-plays on a new import, replays on demand (§3)." />
      <ActivityKind activityId={activityId} />
    </>
  )
}
