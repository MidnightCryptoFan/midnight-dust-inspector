import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const baseUrl =
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://midnight-dust-inspector.vercel.app"

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: "Midnight DUST Inspector",
  description:
    "Check your Midnight DUST generation status, NIGHT balance, and registration state. Non-custodial — no seed phrase required.",
  openGraph: {
    title: "Midnight DUST Inspector",
    description:
      "Check your Midnight DUST generation status, NIGHT balance, and registration state. Non-custodial — no seed phrase required.",
    url: baseUrl,
    siteName: "Midnight DUST Inspector",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Midnight DUST Inspector",
    description:
      "Check your Midnight DUST generation status, NIGHT balance, and registration state. Non-custodial — no seed phrase required.",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-slate-100 text-slate-950">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
