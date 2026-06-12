import type { NextConfig } from "next"
import { createRequire } from "module"

const _require = createRequire(import.meta.url)
const { version } = _require("./package.json") as { version: string }

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    // "dev" | "rc" | "" — set per branch; leave empty on main (stable).
    NEXT_PUBLIC_APP_CHANNEL: "",
  },
  // Lucid Evolution uses CML (Cardano Multiplatform Library) which is WASM-backed.
  // These packages must not be bundled server-side.
  serverExternalPackages: [
    "@lucid-evolution/lucid",
    "@anastasia-labs/cardano-multiplatform-lib-nodejs",
  ],
}

export default nextConfig
