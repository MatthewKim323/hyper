import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gallery | Hyper",
  description: "An open 3D gallery space in Hyper.",
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
      <h1 className="sr">Gallery</h1>
      <div className="project-grid-cta | js-project-grid-cta" aria-hidden="true" />
    </main>
  );
}
