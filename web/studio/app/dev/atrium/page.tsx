import { notFound } from "next/navigation";
import AtriumPreview from "@/components/atrium/AtriumPreview";
import VoiceMotionPreview from "./VoiceMotionPreview";
import RelicActivityPreview from "./RelicActivityPreview";

// Visual development only. This renders public scene assets and no workspace data.
export default function AtriumDevelopmentPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main data-router-view="projects" data-atrium-dev>
    <style>{`
      body:has([data-atrium-dev]) :is(.js-loader, .naked-loader, .header, .footer, .menu, #gl, #p-cover) { display: none !important; }
      body:has([data-atrium-dev]), body:has([data-atrium-dev]) * { cursor: auto; }
      body:has([data-relic-activity-preview][data-playing="true"]) .voice-motion-preview { display: none; }
      body:has([data-atrium-dev])[data-atrium-focus]:not([data-atrium-focus=""]) .voice-motion-preview { display: none; }
    `}</style>
    <AtriumPreview live={false} />
    <VoiceMotionPreview />
    <RelicActivityPreview />
  </main>;
}
