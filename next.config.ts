import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Lucid Evolution uses CML (Cardano Multiplatform Library) which is WASM-backed.
  // These packages must not be bundled server-side.
  serverExternalPackages: [
    "@lucid-evolution/lucid",
    "@anastasia-labs/cardano-multiplatform-lib-nodejs",
  ],
}

export default nextConfig
