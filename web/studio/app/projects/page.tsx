import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Welcome | Hyper",
  description: "Meet your Hyper onboarding agent and explore your workspace.",
};

// The empty gallery keeps the ProjectMenu scene and its entrance transition.
export default function ProjectsPage() {
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
