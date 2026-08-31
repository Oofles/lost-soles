import type { NextConfig } from "next"

// Path aliases are declared in tsconfig.json and NOWHERE else (01-architecture.md §5).
// The existing devaultsecurity repo declares them twice and they have drifted; do not
// reintroduce that here.
const nextConfig: NextConfig = {
  reactStrictMode: true,
}

export default nextConfig
