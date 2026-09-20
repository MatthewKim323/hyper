import { notFound } from "next/navigation";
import AtriumPreview from "@/components/atrium/AtriumPreview";
import DialoguePreview from "./DialoguePreview";

/** Development fixture only. Sample captions, no voice connection or microphone access. */
export default function DialogueDevelopmentPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main data-router-view="projects" data-dialogue-dev>
    <style>{`
      body:has([data-dialogue-dev]) :is(.js-loader, .naked-loader, .header, .footer, .menu, #gl, #p-cover) { display: none !important; }
      body:has([data-dialogue-dev]), body:has([data-dialogue-dev]) * { cursor: auto; }
    `}</style>
    <AtriumPreview live={false} />
    <DialoguePreview />
  </main>;
}
