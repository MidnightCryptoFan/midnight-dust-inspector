import { ImageResponse } from "next/og"

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        background: "#0f172a",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "28px",
      }}
    >
      <svg width="120" height="120" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="4" height="4" fill="white" />
        <rect x="3" y="10" width="4" height="4" fill="white" />
        <rect x="3" y="17" width="4" height="4" fill="white" />
        <path
          d="M12.8765 7H7V3.05761C13.5 3.05761 21 1.71441 21 11.9994C21 22.2845 14.2593 20.943 10.4074 20.9421V16.4708H12.8148C13.9383 16.4708 16.1852 16.9188 16.1852 11.9994C16.1852 7.52808 14 7 12.8765 7Z"
          fill="white"
        />
      </svg>
    </div>,
    { ...size },
  )
}
