import type { MetadataRoute } from "next";

const SITE = "https://hyper.stephenhung.me";

// Only the public routes. /onboarding and /world are behind sign-in and render nothing useful to
// a crawler, and /dev/* is disallowed outright in robots.ts.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: SITE, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
  ];
}
