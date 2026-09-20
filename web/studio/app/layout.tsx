import type { Metadata } from "next";
import "./globals.css";
import "./styles/cursor.css";
import "./styles/intro.css";
import "./styles/theme.css";
import "./styles/gallery-nav.css";
import "./styles/timeline.css";
import "./styles/timeline-carousel.css";
import "./styles/onboarding.css";
import "./styles/finger.css";
import "./styles/command.css";
import "./styles/benchmarks-tw.css";
import "./styles/benchmarks.css";
import "./styles/workspace.css";
import Shell, { ShellPost } from "@/components/Shell";
import EngineRoot from "@/components/EngineRoot";
import WorkspaceSections from "@/components/workspace/WorkspaceSections";
import SignInGate from "@/components/workspace/SignInGate";
import { ALWAYS_ONBOARD } from "@/lib/onboarding/interface";
import OnboardingWorkspace from "@/components/onboarding/OnboardingWorkspace";
import FingerCursor from "@/components/finger/FingerCursor";
import CommandLayer from "@/components/command/CommandLayer";
import HomeLinks from "@/components/HomeLinks";

const SITE = "https://hyper.stephenhung.me";
const TITLE = "hyper. — accounts payable that shows its work";
const DESCRIPTION =
  "Hyper resolves accounts-payable exceptions from your own documents. Every amount is recomputed by a deterministic engine and every claim cites the source it came from.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: TITLE, template: "%s — hyper." },
  description: DESCRIPTION,
  applicationName: "hyper.",
  authors: [{ name: "Matthew Kim" }, { name: "Stephen Hung" }],
  keywords: [
    "accounts payable", "AP automation", "three-way match", "invoice exceptions",
    "financial evidence", "audit trail", "Elasticsearch", "AI agent", "HackMIT 2026",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", url: SITE, siteName: "hyper.", title: TITLE, description: DESCRIPTION,
    locale: "en_GB",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "hyper. — accounts payable that shows its work" }],
  },
  twitter: {
    card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"],
  },
  // The /dev pages are scratch surfaces, excluded in robots.ts. Everything public is indexable.
  robots: { index: true, follow: true },
};

// Route-specific body classes are applied before first paint;
// on client navigation the router swaps them (NAVIGATE_IN copies the next page's body class).
const BODY_CLASS_SCRIPT = `(function(){var p=location.pathname.replace(/\\/+$/,"")||"/";var c;
if(p==="/")c="home page-template-home-contact";
else if(p==="/contact")c="page-template-home-contact";
else if(p==="/onboarding"||p==="/world")c="archive post-type-archive post-type-archive-project";
else c="error404 dark";
document.body.className=c;
var done=false;if(!${ALWAYS_ONBOARD}){try{done=localStorage.getItem("hyper.onboarding.v1")==="complete";}catch(e){}}
document.documentElement.dataset.onboarding=done?"complete":"required";})();`;

// Structured data. SoftwareApplication rather than Organization: this is a product page, and the
// authors are the people who built it, not a company that employs them.
const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "hyper.",
  url: SITE,
  description: DESCRIPTION,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  author: [
    { "@type": "Person", name: "Matthew Kim" },
    { "@type": "Person", name: "Stephen Hung" },
  ],
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
});

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className="asscroll-disabled" data-onboarding="required" suppressHydrationWarning>
      <body className="home page-template-home-contact" suppressHydrationWarning>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
        <script dangerouslySetInnerHTML={{ __html: BODY_CLASS_SCRIPT }} />
        <Shell />
        <div asscroll-container="" data-router-wrapper="">
          {children}
        </div>
        <ShellPost />
        <WorkspaceSections />
        <SignInGate />
        <OnboardingWorkspace />
        <CommandLayer />
        <HomeLinks />
        <FingerCursor />
        <EngineRoot />
      </body>
    </html>
  );
}
