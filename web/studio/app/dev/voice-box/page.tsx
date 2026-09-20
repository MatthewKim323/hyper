import { notFound } from "next/navigation";
import AtriumPreview from "@/components/atrium/AtriumPreview";
import VoiceBoxPreview from "./VoiceBoxPreview";

/** Isolated visual fixture. No customer data, microphone capture or backend session. */
export default function VoiceBoxDevelopmentPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main data-router-view="projects" data-voice-box-dev>
    <style>{`
      body:has([data-voice-box-dev]) :is(.js-loader, .naked-loader, .header, .footer, .menu, #gl, #p-cover) { display: none !important; }
      body:has([data-voice-box-dev]), body:has([data-voice-box-dev]) * { cursor: auto; }
    `}</style>
    <AtriumPreview live={false} />
    <VoiceBoxPreview />
  </main>;
}
