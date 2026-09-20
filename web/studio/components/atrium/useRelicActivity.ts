"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/workspace/useBackend";
import { backend, BackendError, poll } from "@/lib/backend/client";
import { fetchBenchmarks, REAL_URL } from "@/lib/benchmarks/load";
import { importTimelineJson, mergeTimeline } from "@/lib/timeline/registry";
import { mapRelicActivity, RELIC_ACTIVITY_SECTIONS, RELIC_COMPLETION_MS, type RelicActivity, type RelicActivityMap, type RelicActivitySection, type RelicActivitySnapshot } from "./relic-activity";

type Read = { sections: RelicActivitySection[]; load: () => Promise<Partial<RelicActivitySnapshot>> };
type Feed = Pick<RelicActivitySnapshot, "observedAt" | "errors"> & Partial<RelicActivitySnapshot>;
type Loaded = { scope: string; activities: RelicActivityMap; updatedAt: number | null; loading: boolean };
const TIMELINE_STORAGE_KEY = "hyper.framework-timeline.v1";

async function readActivity(reads: Read[]): Promise<Feed> {
  const results = await Promise.allSettled(reads.map(read => read.load()));
  const snapshot: Feed = { observedAt: Date.now(), errors: {}, incomplete: {} };
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const { incomplete, ...data } = result.value;
      Object.assign(snapshot, data);
      for (const [section, truncated] of Object.entries(incomplete ?? {})) {
        if (truncated) snapshot.incomplete![section as RelicActivitySection] = true;
      }
    } else {
      for (const section of reads[index].sections) {
        snapshot.errors![section] = result.reason instanceof BackendError && [401, 403].includes(result.reason.status)
          ? "Sign in to read live activity" : "Live activity unavailable";
      }
    }
  });
  return snapshot;
}

const fastReads: Read[] = [
  { sections: ["cases"], load: async () => { const response = await backend.tasks(); return { tasks: response.tasks, incomplete: { cases: response.has_more } }; } },
  { sections: ["cases"], load: async () => ({ scenarios: (await backend.scenarios()).scenarios }) },
  { sections: ["cases", "review"], load: async () => ({ proposals: (await backend.payableProposals()).proposals }) },
  { sections: ["review"], load: async () => { const response = await backend.concerns(); return { concerns: response.concerns, incomplete: { review: response.has_more } }; } },
];

const slowReads: Read[] = [
  { sections: ["cases"], load: async () => ({ controller: await backend.controller() }) },
  { sections: ["cases"], load: async () => { const response = await backend.cases(); return { cases: response.cases, incomplete: { cases: response.has_more } }; } },
  { sections: ["cases"], load: async () => ({ engineCases: (await backend.engineCases()).cases }) },
  { sections: ["evidence"], load: async () => { const response = await backend.sources(100); return { sources: response.sources, incomplete: { evidence: response.has_more } }; } },
  { sections: ["identity"], load: async () => { const response = await backend.connections(); return { connections: response.connections, incomplete: { identity: response.has_more } }; } },
  { sections: ["timeline"], load: async () => ({ skills: (await backend.skills()).skills }) },
];

const publicReads: Read[] = [
  { sections: ["benchmarks"], load: async () => {
    const benchmarks = await fetchBenchmarks(REAL_URL);
    if (benchmarks.display_mode === "DEV_FIXTURE") throw new Error("Development results cannot describe live activity");
    return { benchmarks };
  } },
  { sections: ["timeline"], load: async () => {
    const response = await fetch("/api/timeline", { cache: "no-store" });
    if (!response.ok) throw new Error("Source history unavailable");
    const timeline = importTimelineJson(await response.text());
    const saved = localStorage.getItem(TIMELINE_STORAGE_KEY);
    return { timeline: saved ? mergeTimeline(timeline, importTimelineJson(saved)) : timeline };
  } },
];

/** Mount once for the visible world. Focused panels are not involved in live polling. */
export function useRelicActivity(enabled: boolean): { activities: RelicActivityMap; loading: boolean; updatedAt: number | null } {
  const auth = useAuth();
  const scope = auth.signedIn ? auth.scope : "signed-out";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const fallback = useMemo(() => mapRelicActivity({ observedAt: 0, signedIn: auth.signedIn }), [auth.signedIn]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let current: RelicActivitySnapshot = { observedAt: Date.now(), signedIn: auth.signedIn };
    const feeds: Record<"fast" | "slow" | "public", Feed> = {
      fast: { observedAt: current.observedAt }, slow: { observedAt: current.observedAt }, public: { observedAt: current.observedAt },
    };
    const received = { fast: !auth.signedIn, slow: !auth.signedIn, public: false };
    let expiration: ReturnType<typeof setTimeout> | undefined;
    const completions = new Map<RelicActivitySection, { activity: RelicActivity; until: number }>();

    const publish = (feed?: Feed, source: keyof typeof feeds = "public") => {
      if (stopped) return;
      const previous = current;
      if (feed) {
        feeds[source] = feed;
        received[source] = true;
        current = { ...feeds.public, ...feeds.slow, ...feeds.fast, signedIn: auth.signedIn, observedAt: feed.observedAt,
          errors: { ...feeds.slow.errors, ...feeds.fast.errors, ...feeds.public.errors },
          incomplete: { ...feeds.slow.incomplete, ...feeds.fast.incomplete, ...feeds.public.incomplete } };
      }
      const now = Date.now();
      const activities = mapRelicActivity(current, feed ? previous : undefined, now);
      for (const section of RELIC_ACTIVITY_SECTIONS) {
        const activity = activities[section];
        if (activity.status === "complete") completions.set(section, { activity, until: now + RELIC_COMPLETION_MS });
        else if (activity.status !== "idle") completions.delete(section);
        const completion = completions.get(section);
        if (completion && completion.until > now) activities[section] = completion.activity;
        else completions.delete(section);
      }
      setLoaded({ scope, activities, updatedAt: current.observedAt, loading: !received.fast || !received.slow || !received.public });
      if (expiration) clearTimeout(expiration);
      const deadlines = [...completions.values()].map(item => item.until);
      for (const scenario of current.scenarios ?? []) {
        const activity = scenario.agent.activity;
        if (activity?.status === "running" && activity.expires_at && activity.expires_at > now) deadlines.push(activity.expires_at);
      }
      if (deadlines.length) expiration = setTimeout(() => publish(), Math.max(1, Math.min(...deadlines) - now));
    };

    const stopPublic = poll(() => readActivity(publicReads), feed => publish(feed), { everyMs: 15_000 });
    const stopFast = auth.ready && auth.signedIn
      ? poll(() => readActivity(fastReads), feed => publish(feed, "fast"), { everyMs: 4_000 }) : undefined;
    const stopSlow = auth.ready && auth.signedIn
      ? poll(() => readActivity(slowReads), feed => publish(feed, "slow"), { everyMs: 15_000 }) : undefined;
    return () => { stopped = true; stopPublic(); stopFast?.(); stopSlow?.(); if (expiration) clearTimeout(expiration); };
  }, [enabled, auth.ready, auth.signedIn, scope]);

  const visible = enabled && loaded?.scope === scope ? loaded : null;
  return visible ? { activities: visible.activities, loading: visible.loading, updatedAt: visible.updatedAt }
    : { activities: fallback, loading: enabled, updatedAt: null };
}
