import { Stub } from "@/components/stub"

// §1.3 — small and boring, and must stay under one screenful. Strava re-auth lives
// here (the one recurring chore S3 permits), plus reduced-motion, units, sign out,
// and the theme override, which is the only visual preference the app offers (§8.3).
export default function Settings() {
  return <Stub route="/settings" becomes="Settings" note="Strava re-auth, reduced motion, units, sign out, and the theme override. Keep it under one screenful." />
}
