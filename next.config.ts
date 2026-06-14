import type { NextConfig } from "next"
import { createRequire } from "module"

const _require = createRequire(import.meta.url)
const { version } = _require("./package.json") as { version: string }

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version.replace(/-.*$/, ""),
    // "dev" | "rc" | "" — set per branch; leave empty on main (stable).
    NEXT_PUBLIC_APP_CHANNEL: process.env.NEXT_PUBLIC_APP_CHANNEL ?? "",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ]
  },
  // Lucid Evolution uses CML (Cardano Multiplatform Library) which is WASM-backed.
  // These packages must not be bundled server-side.
  serverExternalPackages: [
    "@lucid-evolution/lucid",
    "@anastasia-labs/cardano-multiplatform-lib-nodejs",
  ],
}

export default nextConfig
