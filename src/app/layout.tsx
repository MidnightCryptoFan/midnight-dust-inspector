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
  process.env.NEXT_PUBLIC_BASE_URL ??
  "https://midnight-dust-inspector.vercel.app"

const title = "Midnight DUST Inspector – Check DUST Generation and Registration Status"
const description =
  "Check your Midnight DUST generation status, NIGHT balance, and registration state. Non-custodial — no seed phrase or sign-up required."

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title,
  description,
  keywords: [
    "Midnight",
    "DUST",
    "NIGHT",
    "Cardano",
    "DUST generation",
    "Midnight network",
    "NIGHT registration",
    "DUST cap",
    "Midnight wallet",
    "Cardano stake",
    "blockchain",
    "crypto",
  ],
  openGraph: {
    title,
    description,
    url: baseUrl,
    siteName: "Midnight DUST Inspector",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  alternates: {
    canonical: baseUrl,
  },
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Midnight DUST Inspector",
  description,
  url: baseUrl,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web Browser",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
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
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full bg-slate-100 text-slate-950">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
