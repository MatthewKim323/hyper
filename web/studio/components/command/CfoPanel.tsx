"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Dialog } from "@base-ui/react/dialog";
import ActivityOrb from "@/components/ui/ActivityOrb";
import { getAtriumStations, getDefaultAtriumStations, subscribeAtriumStations } from "@/components/atrium/configuration";
import { useAuth } from "@/components/workspace/useBackend";
import { openSignIn } from "@/lib/backend/auth";
import { MAX_SWARM_EVENTS, MAX_SWARM_TASKS, type SwarmEvent, type SwarmSection, type SwarmTask } from "@/lib/command/cfo-feed";
import { useCfoSwarm } from "./useCfoSwarm";
import styles from "./CfoPanel.module.css";
import type { NarrationRecord } from "@/lib/command/cfo-commentary";

const SECTION_LABELS: Record<SwarmSection, string> = {
  cases: "Accounts Payable", evidence: "Audit & Evidence", review: "Approvals",
  timeline: "Training Arena", benchmarks: "Benchmarks", identity: "Access",
};
const words = (text: string) => text.replaceAll("_", " ");
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const sessionLink = (value: string | null) => {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && ["app.devin.ai", "devin.ai"].includes(url.hostname) ? url.href : null; }
  catch { return null; }
};

type Props = { commentaryHistory?: NarrationRecord[]; open: boolean; instant?: boolean; onOpenChange: (open: boolean) => void; needsIntroduction?: boolean; onIntroduce?: () => void; activity?: string };

export default function CfoPanel({ commentaryHistory = [], open, instant = false, onOpenChange, needsIntroduction, onIntroduce, activity = "composing" }: Props) {
  const auth = useAuth();
  const feed = useCfoSwarm(open);
  const stations = useSyncExternalStore(subscribeAtriumStations, getAtriumStations, getDefaultAtriumStations);
  const [selected, setSelected] = useState<string | null>(null);
  const data = feed.data;
  const selectedTask = data?.tasks.find(task => task.id === selected);
  const selectedId = selectedTask?.id ?? null;
  const shown = (data?.events ?? []).filter(event => !selectedId || event.task_id === selectedId).reverse();
  const latestByTask = useMemo(() => {
    const latest = new Map<string, SwarmEvent>();
    for (const event of data?.events ?? []) {
      if (event.task_id && event.timestamp >= (latest.get(event.task_id)?.timestamp ?? -1)) latest.set(event.task_id, event);
    }
    return latest;
  }, [data?.events]);
  const label = (section: SwarmSection) => stations.find(station => station.section === section)?.label ?? SECTION_LABELS[section];
  const canNavigate = (section: SwarmSection) => stations.some(station => station.section === section);

  useEffect(() => {
    if (!open) return;
    document.body.dataset.cfoOpen = "true";
    return () => { delete document.body.dataset.cfoOpen; };
  }, [open]);

  function navigate(section: SwarmSection) {
    onOpenChange(false);
    window.dispatchEvent(new CustomEvent("hyper:navigate-section", { detail: { section } }));
  }

  function location(section: SwarmSection | null) {
    return section && canNavigate(section)
      ? <button className={styles.location} type="button" onClick={() => navigate(section)} title={`Go to ${label(section)}`}>{label(section)} <span aria-hidden="true">↗</span></button>
      : section ? <span className={styles.unplaced}>{label(section)}</span> : null;
  }

  const connectionLabel = { idle: "Waiting", connecting: "Connecting", connected: "Connected", reconnecting: "Reconnecting", paused: "Paused", disconnected: "Disconnected", unauthorized: "Sign in required" }[feed.connection];
  const cfoActivity = activity !== "composing" ? activity
    : feed.connection !== "connected" ? feed.connection
    : data?.controller.error ? "error"
    : data?.controller.enabled ? data.controller.status : "idle";

  return <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false} disablePointerDismissal>
    <Dialog.Portal>
      <Dialog.Popup
        id="hyper-cfo-panel"
        className={styles.panel}
        data-instant={instant || undefined}
        finalFocus={() => document.querySelector<HTMLButtonElement>("[data-cfo-trigger]") ?? false}
        onPointerDown={event => event.stopPropagation()}
        onPointerUp={event => event.stopPropagation()}
        onWheel={event => event.stopPropagation()}
      >
        {auth.signedIn && data && <aside className={styles.team} aria-label="Agent team">
          <div className={styles.tasks}>
            {!data.tasks.length && <div className={styles.emptyAgents}>No agents yet</div>}
            {data.tasks.map(task => <Task key={task.id} task={task} latest={latestByTask.get(task.id)} selected={task.id === selectedId} onSelect={() => setSelected(task.id)} location={location(task.section)} />)}
            {data.tasks_has_more && <button type="button" className={styles.more} disabled={feed.loadingMore} onClick={() => { void feed.loadMoreTasks(); }}>More agents <span aria-hidden="true">↓</span></button>}
            {data.tasks.length >= MAX_SWARM_TASKS && <p className={styles.taskLimit}>Showing the latest {MAX_SWARM_TASKS.toLocaleString()} tasks.</p>}
          </div>
        </aside>}

        <section className={styles.cfo} aria-label="CFO activity">
          <header className={styles.header}>
            <Dialog.Title className={styles.title}>CFO<ActivityOrb status={cfoActivity} label={`CFO: ${words(cfoActivity)}. Activity feed: ${connectionLabel}`} /></Dialog.Title>
            <Dialog.Close className={styles.close} aria-label="Close CFO activity"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></Dialog.Close>
          </header>
          <Dialog.Description className={styles.srOnly}>Agent activity and workflow locations.</Dialog.Description>
          {!!commentaryHistory.length && <details className={styles.logText}>
            <summary>Commentary transcript</summary>
            <ol aria-label="CFO commentary transcript">{commentaryHistory.map(item => <li key={item.event.id}><p>{item.event.narration.text}</p><small>{item.status === "history" ? "Earlier update" : item.status.replaceAll("-", " ")}</small></li>)}</ol>
          </details>}
          {needsIntroduction && <button className={styles.introduce} type="button" onClick={onIntroduce}>Hear introduction <span aria-hidden="true">↗</span></button>}

          {!auth.ready ? <p className={styles.empty}><ActivityOrb status="connecting" label="Connecting to your workspace" /></p>
            : !auth.signedIn ? <div className={styles.empty}><button type="button" onClick={() => { void openSignIn(); }}>Sign in to view activity ↗</button></div>
            : <>
              {feed.error && <div className={styles.error} role="status"><span>{feed.error}</span><button type="button" onClick={feed.refresh}>Retry</button></div>}
              {!data ? !feed.error && <p className={styles.empty}><ActivityOrb status="loading" label="Loading agent activity" /></p> : <>
                {data.controller.error && <p className={styles.controllerError} role="status">{data.controller.error}</p>}
                <section className={styles.journal} aria-label="Agent activity log">
                  {selectedTask && <div className={styles.objective}>
                    <button type="button" className={styles.all} onClick={() => setSelected(null)}>← All activity</button>
                    <h4>{selectedTask.title || selectedTask.objective}</h4>
                    {selectedTask.objective && selectedTask.objective !== selectedTask.title && <details className={styles.logText}><summary>Task details</summary><p>{selectedTask.objective}</p></details>}
                    {sessionLink(selectedTask.session_url) && <a href={sessionLink(selectedTask.session_url)!} target="_blank" rel="noreferrer">Devin session ↗</a>}
                  </div>}
                  <ol className={styles.events}>
                    {shown.map(event => <LogEntry key={event.id} event={event} location={location(event.section)} />)}
                    {!shown.length && <li className={styles.quiet}>No activity yet</li>}
                  </ol>
                  <div className={styles.paging}>
                    {data.has_more && <button type="button" disabled={feed.loadingMore} onClick={() => { void feed.loadOlder(); }}>Earlier activity</button>}
                    {data.provider_logs.sessions.filter(session => session.has_more && (!selectedId || session.task_id === selectedId)).map(session => <button type="button" key={session.session_id} disabled={feed.loadingMore} onClick={() => { void feed.loadMoreMessages(session.task_id); }}>{session.task_id ? "More agent messages" : "More coordinator messages"}</button>)}
                  </div>
                </section>
                <footer className={styles.footer}><details>
                  <summary>{["partial", "unavailable", "not_configured"].includes(data.provider_logs.status) ? "Log availability" : "Feed details"}</summary>
                  <p>{data.provider_logs.message}{data.events.length >= MAX_SWARM_EVENTS ? ` Showing the latest ${MAX_SWARM_EVENTS.toLocaleString()} events.` : data.events_truncated ? " Showing a bounded window of agent messages." : ""}</p>
                  <p>{data.controller.enabled ? `Coordinator ${words(data.controller.status)}` : "Coordinator paused"} · {data.task_total} tasks</p>
                  <time dateTime={new Date(data.generated_at).toISOString()}>Updated {clock(data.generated_at)}</time>
                </details></footer>
              </>}
            </>}
        </section>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}

function Task({ task, latest, selected, onSelect, location }: { task: SwarmTask; latest?: SwarmEvent; selected: boolean; onSelect: () => void; location: React.ReactNode }) {
  const preview = latest ? latest.source === "devin" && latest.text ? latest.text : latest.title : null;
  return <article className={styles.task} data-selected={selected} onClick={event => {
    if (!(event.target as HTMLElement).closest("button, a")) onSelect();
  }}>
    <button type="button" className={styles.taskSelect} aria-pressed={selected} aria-label={`View ${task.title || task.objective} activity`} onClick={onSelect}>
      <span className={styles.taskHeading}><strong>{task.title || task.objective}</strong><ActivityOrb status={task.status} label={`Agent: ${words(task.status)}`} /></span>
      {preview && <span className={styles.taskPreview}>{preview}</span>}
    </button>
    {location && <div className={styles.taskLocation}>{location}</div>}
    {task.error && <p className={styles.taskError}>{task.error}</p>}
  </article>;
}

function LogEntry({ event, location }: { event: SwarmEvent; location: React.ReactNode }) {
  const preview = event.source === "devin" && event.text ? event.text.slice(0, 160) : event.title;
  const more = event.source === "devin" ? event.text.length > 160 : event.text && event.text !== event.title;
  return <li className={styles.event}>
    <div className={styles.eventHeading}><strong>{preview}{event.source === "devin" && more ? "..." : ""}</strong><time title={new Date(event.timestamp).toLocaleString()} dateTime={new Date(event.timestamp).toISOString()}>{clock(event.timestamp)}</time></div>
    {more && <details className={styles.logText}><summary>More</summary><p>{event.text}</p></details>}
    {(location || event.source === "devin") && <div className={styles.eventMeta}>{event.source === "devin" && <span>Devin</span>}{location}</div>}
  </li>;
}
