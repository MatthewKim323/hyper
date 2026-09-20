import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Welcome | Hyper",
  description: "Meet your Hyper onboarding agent.",
};

// Voice onboarding. Shares the project-menu scene with /world so the handoff between them
// is a wipe over one continuous scene rather than a scene teardown.
export default function OnboardingPage() {
  return (
    <main
      {...{ asscroll: "" }}
      data-router-view="projects"
      role="main"
      itemScope
      itemProp="mainContentOfPage"
    >
      <h1 className="sr">Hyper onboarding</h1>
      <div className="project-grid-cta | js-project-grid-cta" aria-hidden="true" />
    </main>
  );
}
