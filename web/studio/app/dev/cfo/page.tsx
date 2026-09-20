import { notFound } from "next/navigation";
import AtriumPreview from "@/components/atrium/AtriumPreview";
import CfoPreview from "./CfoPreview";

export default function CfoDevelopmentPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main data-router-view="projects" data-cfo-dev>
    <style>{`
      body:has([data-cfo-dev]) :is(.js-loader, .naked-loader, .header, .footer, .menu, #gl, #p-cover) { display: none !important; }
      body:has([data-cfo-dev]), body:has([data-cfo-dev]) * { cursor: auto; }
    `}</style>
    <AtriumPreview live={false} />
    <CfoPreview />
  </main>;
}
