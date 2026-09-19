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
import "./styles/benchmarks-tw.css";
import "./styles/benchmarks.css";
import "./styles/workspace.css";
import Shell, { ShellPost } from "@/components/Shell";
import EngineRoot from "@/components/EngineRoot";
import TimelineWorkspace from "@/components/timeline/TimelineWorkspace";
import BenchmarksWorkspace from "@/components/benchmarks/BenchmarksWorkspace";
import WorkspaceSections from "@/components/workspace/WorkspaceSections";
import { ALWAYS_ONBOARD } from "@/lib/onboarding/interface";
import OnboardingWorkspace from "@/components/onboarding/OnboardingWorkspace";
import FingerCursor from "@/components/finger/FingerCursor";

export const metadata: Metadata = {
  title: "hyper. | HackMIT 2026",
  description:
    "An accounts-payable exception-resolution project by Matthew Kim and Stephen Hung for HackMIT 2026.",
};

// Route-specific body classes are applied before first paint;
// on client navigation the router swaps them (NAVIGATE_IN copies the next page's body class).
const BODY_CLASS_SCRIPT = `(function(){var p=location.pathname.replace(/\\/+$/,"")||"/";var c;
if(p==="/")c="home page-template-home-contact";
else if(p==="/contact")c="page-template-home-contact";
else if(p==="/projects")c="archive post-type-archive post-type-archive-project";
else c="error404 dark";
document.body.className=c;
var done=false;if(!${ALWAYS_ONBOARD}){try{done=localStorage.getItem("hyper.onboarding.v1")==="complete";}catch(e){}}
document.documentElement.dataset.onboarding=done?"complete":"required";})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className="asscroll-disabled" data-onboarding="required" suppressHydrationWarning>
      <body className="home page-template-home-contact" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: BODY_CLASS_SCRIPT }} />
        <Shell />
        <div asscroll-container="" data-router-wrapper="">
          {children}
        </div>
        <ShellPost />
        <TimelineWorkspace />
        <BenchmarksWorkspace />
        <WorkspaceSections />
        <OnboardingWorkspace />
        <FingerCursor />
        <EngineRoot />
      </body>
    </html>
  );
}
