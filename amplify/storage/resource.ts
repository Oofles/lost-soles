import { defineStorage } from "@aws-amplify/backend"

/**
 * SKELETON ONLY. This bucket becomes the raw-trace archive (D-101, D-121.2) and
 * the home of `explored-r10.bin` (01-architecture.md §5). Paths are scoped to the
 * owning identity from the start — a lifetime GPS history is the one thing in this
 * system that must never be readable by anyone else (08-security-privacy.md §6.2).
 */
export const storage = defineStorage({
  name: "lostSolesUserData",
  access: (allow) => ({
    "users/{entity_id}/*": [allow.entity("identity").to(["read", "write", "delete"])],
  }),
})
