import type { Metadata } from "next";
import "./globals.css";
import "./styles/cursor.css";
import "./styles/intro.css";
import Shell, { ShellPost } from "@/components/Shell";
import EngineRoot from "@/components/EngineRoot";

export const metadata: Metadata = {
  title: "Hyper | Immersive Web Experience",
  description:
    "Hyper explores interactive 3D scenes, motion, and digital experiences.",
};

// Route-specific body classes are applied before first paint;
// on client navigation the router swaps them (NAVIGATE_IN copies the next page's body class).
const BODY_CLASS_SCRIPT = `(function(){var p=location.pathname.replace(/\\/+$/,"")||"/";var c;
if(p==="/")c="home page-template-home-contact";
else if(p==="/contact")c="page-template-home-contact";
else if(p==="/projects")c="archive post-type-archive post-type-archive-project";
else c="error404 dark";
document.body.className=c;})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className="asscroll-disabled" suppressHydrationWarning>
      <body className="home page-template-home-contact" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: BODY_CLASS_SCRIPT }} />
        <Shell />
        <div asscroll-container="" data-router-wrapper="">
          {children}
        </div>
        <ShellPost />
        <EngineRoot />
      </body>
    </html>
  );
}
