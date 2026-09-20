import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "World | Hyper",
  description: "Your Hyper workspace: cases, evidence, review and activity.",
};

// The 3D atrium and the workspace sections that open from it.
export default function WorldPage() {
  return (
    <main
      {...{ asscroll: "" }}
      data-router-view="projects"
      role="main"
      itemScope
      itemProp="mainContentOfPage"
    >
      <h1 className="sr">Hyper workspace</h1>
      <div className="project-grid-cta | js-project-grid-cta" aria-hidden="true" />
    </main>
  );
}
