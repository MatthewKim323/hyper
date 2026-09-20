import { notFound } from "next/navigation";
import AtriumPreview from "@/components/atrium/AtriumPreview";
import VoiceMotionPreview from "./VoiceMotionPreview";

// Visual development only. This renders public scene assets and no workspace data.
export default function AtriumDevelopmentPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main data-router-view="projects" data-atrium-dev>
    <style>{`
      body:has([data-atrium-dev]) :is(.js-loader, .naked-loader, .header, .footer, .menu, #gl, #p-cover) { display: none !important; }
      body:has([data-atrium-dev]), body:has([data-atrium-dev]) * { cursor: auto; }
      body:has([data-atrium-dev])[data-atrium-focus]:not([data-atrium-focus=""]) .voice-motion-preview { display: none; }
    `}</style>
    <AtriumPreview />
    <VoiceMotionPreview />
  </main>;
}
