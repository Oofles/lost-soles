/**
 * TEMPORARY — ticket 0027, acceptance criterion 2. Deliberate D-100 violation, seeded on a
 * throwaway branch to prove that check-boundaries.mjs turns the CI GATE red, not merely
 * that it exits 1 locally. This file is never merged; the PR is closed and the branch
 * deleted as soon as the red run is recorded.
 */
export interface StravaActivity {
  stravaId: string
  summary_polyline: string
}
