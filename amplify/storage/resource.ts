import { defineStorage } from "@aws-amplify/backend"

/**
 * The raw-trace archive (D-101, D-121.2) and the home of `explored-r11.<gen>.bin`
 * (01-architecture.md §5). A lifetime GPS history is the one thing in this system that must
 * never be readable by anyone else (08-security-privacy.md §6.2).
 *
 * NO `access` BLOCK (D-472, `0334`). It held one rule, `users/{entity_id}/*` for
 * `allow.entity("identity")`, and that rule never matched an object: `{entity_id}` is an
 * identity-pool id, and every key here is the user-pool sub (D-228). With Cognito gone there is
 * no identity pool for it to name. NO BROWSER HOLDS ANY GRANT ON THIS BUCKET: the map is served
 * through `/api/fog` as the SSR compute role (`../backend.ts`), and the only writers are the
 * Lambda execution roles. `raw/*` has no read path through the app at all.
 *
 * The two flags below arrived with ticket 0039 and both carry I-3:
 *
 * `versioned` — S3 versioning. This is the ransomware and fat-finger control
 * (§6.2), and it is the half of I-3's immutability that holds even against code that
 * never runs `src/pipeline/archive.ts`. An overwrite of an archived object cannot
 * destroy the original bytes; it can only add a version alongside them, and
 * `s3:DeleteObjectVersion` is denied in `../backend.ts` so that version stays.
 *
 * `keepOnDelete` — RETAIN, and it removes CDK's auto-delete-objects custom resource
 * with it. Before 0039 this bucket was `RemovalPolicy.DESTROY` with
 * `autoDeleteObjects: true`, which meant a live IAM role holding `s3:DeleteObject*`
 * on the whole bucket and a stack teardown that would have emptied the archive. I-3
 * says `raw/` objects are undeletable; a teardown that deletes them is not an
 * exception to that, it is the loudest possible violation of it.
 *
 * THE COST, stated rather than discovered: a torn-down stack leaves the bucket
 * behind, and the next deploy creates a new one rather than adopting it. That is the
 * same trade `LostSolesSourceAccount` records, and it is the correct direction — the
 * archive is the one artifact in this system that no rebuild can reproduce
 * (02-data-model.md §1.1, §8).
 *
 * Note `keepOnDelete` is IGNORED in `ampx sandbox`, by Amplify's own design: a
 * sandbox bucket is always destroyed. A sandbox is a different bucket holding no
 * real history, so that is fine — but it does mean the deployed `main` bucket is the
 * only place this guarantee can be verified.
 */
export const storage = defineStorage({
  name: "lostSolesUserData",
  versioned: true,
  keepOnDelete: true,
})
