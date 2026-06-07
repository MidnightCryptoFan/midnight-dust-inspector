import { ImageResponse } from "next/og"

export const runtime = "edge"
export const alt = "Midnight DUST Inspector"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top label */}
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#a78bfa",
            marginBottom: 24,
          }}
        >
          Midnight DUST Inspector
        </div>

        {/* Main headline */}
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            color: "#f8fafc",
            lineHeight: 1.1,
            marginBottom: 32,
            maxWidth: 800,
          }}
        >
          Check your DUST generation status
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 28,
            color: "#94a3b8",
            lineHeight: 1.5,
            maxWidth: 700,
            marginBottom: 56,
          }}
        >
          Non-custodial tool for Midnight &amp; Cardano. No seed phrase required.
        </div>

        {/* Badges */}
        <div style={{ display: "flex", gap: 16 }}>
          {["NIGHT Balance", "Registration Status", "DUST Cap"].map((label) => (
            <div
              key={label}
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 999,
                padding: "10px 24px",
                fontSize: 20,
                color: "#cbd5e1",
                fontWeight: 600,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  )
}
