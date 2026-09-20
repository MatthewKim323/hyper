"use client";

// What orbits a focused relic: three hero numbers, one small chart, the agent's state and the single
// most urgent item. Everything is read from the same backend routes the panel uses; nothing is invented.
import { backend } from "@/lib/backend/client";
import { useBackend } from "@/components/workspace/useBackend";

export type RelicAnalytics = {
  /** The section these figures describe, so a relic never shows another relic's numbers mid-hop. */
  section: string;
  numbers: { label: string; value: number; suffix?: string }[];
  chart: { title: string; rows: { label: string; value: number }[] } | null;
  status: { tone: "active" | "waiting" | "idle" | "alert"; text: string };
  top: { eyebrow: string; title: string; detail: string; pointable: string } | null;
};

const words = (value: string) => value.replaceAll("_", " ");
const tally = <T,>(items: T[], key: (item: T) => string) => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts].map(([label, value]) => ({ label: words(label), value })).sort((a, b) => b.value - a.value).slice(0, 5);
};

async function load(section: string): Promise<RelicAnalytics> {
  if (section === "cases") {
    const [controller, cases, tasks, invoices] = await Promise.all([
      backend.controller(), backend.cases(), backend.tasks(),
      backend.aggregate({ dataset: "ap_invoices", operation: "count", group_by: ["status"] }).catch(() => null),
    ]);
    const open = tasks.tasks.filter(task => !["complete", "failed"].includes(task.status));
    const urgent = [...cases.cases].sort((a, b) => b.state.unknowns.length - a.state.unknowns.length)[0];
    const rows = invoices?.results.map(row => ({ label: words(String(Object.values(row.group ?? {})[0] ?? "all")), value: Number(row.value) })).slice(0, 5);
    return {
      section,
      numbers: [
        { label: "Open cases", value: cases.cases.length },
        { label: "Still unknown", value: cases.cases.reduce((sum, item) => sum + item.state.unknowns.length, 0) },
        { label: "Tasks in flight", value: open.length },
      ],
      chart: rows?.length ? { title: "Invoices by status", rows } : { title: "Tasks by status", rows: tally(tasks.tasks, task => task.status) },
      status: !controller.enabled ? { tone: "idle", text: "Agent is switched off" }
        : controller.status === "blocked" ? { tone: "alert", text: "Agent is blocked" }
        : open.length ? { tone: "active", text: `Working ${open.length} task${open.length === 1 ? "" : "s"}` } : { tone: "waiting", text: `Agent ${words(controller.status)}` },
      top: urgent ? { eyebrow: urgent.case_key, title: urgent.title, detail: urgent.state.unknowns[0] ?? urgent.state.next_actions[0] ?? "", pointable: `case:${urgent.id}` } : null,
    };
  }
  if (section === "review") {
    const { concerns } = await backend.concerns();
    const waiting = concerns.filter(concern => concern.status === "awaiting_response");
    const first = waiting[0];
    return {
      section,
      numbers: [
        { label: "Need your call", value: waiting.length },
        { label: "High severity", value: concerns.filter(concern => ["high", "critical"].includes(concern.request.severity)).length },
        { label: "Raised in total", value: concerns.length },
      ],
      chart: { title: "Decisions by state", rows: tally(concerns, concern => concern.status) },
      status: waiting.length ? { tone: "waiting", text: `${waiting.length} decision${waiting.length === 1 ? "" : "s"} waiting on you` } : { tone: "idle", text: "Nothing needs you right now" },
      top: first ? { eyebrow: `${first.request.severity} severity`, title: first.request.title, detail: first.card?.summary ?? first.request.description, pointable: `concern:${first.id}` } : null,
    };
  }
  if (section === "evidence") {
    const [datasets, sources] = await Promise.all([backend.datasets(), backend.sources()]);
    const ready = sources.sources.filter(source => source.index_status === "ready").length;
    const indexing = sources.sources.filter(source => ["pending", "running"].includes(source.index_status)).length;
    const newest = [...sources.sources].sort((a, b) => b.created_at - a.created_at)[0];
    return {
      section,
      numbers: [
        { label: "Sources", value: sources.sources.length },
        { label: "Records", value: datasets.datasets.reduce((sum, dataset) => sum + dataset.record_count, 0) },
        { label: "Searchable", value: sources.sources.length ? Math.round((ready / sources.sources.length) * 100) : 0, suffix: "%" },
      ],
      chart: { title: "Records by dataset", rows: [...datasets.datasets].sort((a, b) => b.record_count - a.record_count).slice(0, 5).map(dataset => ({ label: words(dataset.dataset), value: dataset.record_count })) },
      status: indexing ? { tone: "active", text: `Indexing ${indexing} source${indexing === 1 ? "" : "s"}` } : { tone: "idle", text: "Every source is searchable" },
      top: newest ? { eyebrow: "Newest source", title: newest.filename, detail: newest.dataset ? `${words(newest.dataset)} · ${(newest.record_count ?? 0).toLocaleString("en-US")} records` : "document", pointable: `source:${newest.id}` } : null,
    };
  }
  const { simulations } = await backend.simulations();
  const run = simulations[0];
  const events = run ? (await backend.simulationEvents(run.id)).events : [];
  const latest = events[events.length - 1];
  return {
    section,
    numbers: [
      { label: "Events", value: events.filter(event => event.status === "published").length },
      { label: "Company runs", value: simulations.length },
      { label: "Failed", value: events.filter(event => event.status === "failed").length },
    ],
    chart: { title: "Events by dataset", rows: tally(events, event => event.payload.dataset) },
    status: !run ? { tone: "idle", text: "No company activity yet" } : run.status === "failed" ? { tone: "alert", text: "The activity run failed" } : { tone: run.status === "running" ? "active" : "waiting", text: `Company activity ${run.status}` },
    top: latest ? { eyebrow: "Latest event", title: words(latest.payload.event_type), detail: `${words(latest.payload.dataset)} · ${latest.payload.source}`, pointable: `event:${latest.id}` } : null,
  };
}

export function useRelicAnalytics(section: string | null, enabled: boolean) {
  return useBackend(() => load(section ?? "cases"), enabled && !!section, 6000);
}
