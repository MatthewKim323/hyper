import type { MetadataRoute } from "next";

// /dev/* are scratch surfaces for building components in isolation, and /api/onboarding is the
// proxy to the backend: neither is content, and both would waste crawl budget on pages that
// answer 401 or render half a component.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dev/", "/api/"] }],
    sitemap: "https://hyper.stephenhung.me/sitemap.xml",
    host: "https://hyper.stephenhung.me",
  };
}
