import type { MetadataRoute } from "next"

const baseUrl =
  process.env.NEXT_PUBLIC_BASE_URL ??
  "https://midnight-dust-inspector.vercel.app"

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ]
}
