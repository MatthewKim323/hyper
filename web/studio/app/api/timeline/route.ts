import { discoverTimeline } from "@/lib/timeline/discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await discoverTimeline();
    return Response.json(result.document, {
      headers: {
        "Cache-Control": "no-store",
        "X-Timeline-Source": result.source,
        ...(result.notice ? { "X-Timeline-Notice": result.notice } : {}),
      },
    });
  } catch {
    return Response.json({ error: "Timeline snapshots are unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
