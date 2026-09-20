"use client";

import ActivityOrb from "@/components/ui/ActivityOrb";

// Orbit cards: analytics that unfold out of the focused relic and hang around it. The scene reports
// where the relic and its orbit slots land on the frame every frame; each card springs from the relic's
// center to its slot, staggered, starting once the camera is most of the way in. Positions are written
// straight to the DOM, so React never re-renders during the flight.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bar, BarChart, BarYAxis, ChartTooltip, Grid } from "@/components/charts";
import { useAuth } from "@/components/workspace/useBackend";
import { useRelicAnalytics, type RelicAnalytics } from "./relic-analytics";
import type { FocusFrame } from "./scene";
import styles from "./RelicOrbit.module.css";

// Cards start leaving the relic at this share of the camera flight, one after another.
const RELEASE = 0.5;
const STAGGER = 0.09;
const STIFFNESS = 120;
const DAMPING = 17; // slightly under critical: a small, soft overshoot as each card lands
const TILT = [12, 12, -9, -9];
// The panel takes the right of the screen; cards live in the rest.
const FREE_SHARE = 0.5;

export type OrbitHandle = (frame: FocusFrame) => void;

function CountUp({ value, suffix = "", run }: { value: number; suffix?: string; run: boolean }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!run) return;
    let frame = 0;
    const started = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 900);
      setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - t, 4))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, run]);
  return <>{(run ? shown : 0).toLocaleString("en-US")}{suffix}</>;
}

function Cards({ data, landed }: { data: RelicAnalytics; landed: boolean[] }) {
  const cards: ReactNode[] = [
    <div key="numbers" className={styles.numbers}>
      {data.numbers.map(number => <div key={number.label}><strong><CountUp value={number.value} suffix={number.suffix} run={landed[0]} /></strong><span>{number.label}</span></div>)}
    </div>,
    data.chart && data.chart.rows.length > 0 ? <div key="chart" className={styles.chart} data-pointable="chart:relic-orbit" data-pointable-label={data.chart.title} data-pointable-data={JSON.stringify(data.chart.rows)}>
      <span className={styles.eyebrow}>{data.chart.title}</span>
      <div style={{ height: data.chart.rows.length * 22 + 14 }}>
        {landed[1] && <BarChart data={data.chart.rows} xDataKey="label" orientation="horizontal" className="h-full" aspectRatio="auto" barGap={0.45} animationDuration={700} margin={{ left: 92, right: 10, top: 2, bottom: 2 }}>
          <Grid vertical horizontal={false} />
          <Bar dataKey="value" fill="var(--chart-1)" lineCap={3} />
          <BarYAxis showAllLabels />
          <ChartTooltip showCrosshair={false} />
        </BarChart>}
      </div>
    </div> : null,
    <div key="status" className={styles.status} data-tone={data.status.tone}><ActivityOrb status={data.status.tone} label={data.status.text} /><span>{data.status.text}</span></div>,
    data.top ? <div key="top" className={styles.top} data-pointable={data.top.pointable} data-pointable-label={data.top.title}>
      <span className={styles.eyebrow}>{data.top.eyebrow}</span>
      <strong>{data.top.title}</strong>
      {data.top.detail && <p>{data.top.detail}</p>}
    </div> : null,
  ];
  return <>{cards.map((card, index) => <div key={index} className={styles.card} data-slot={index} data-empty={!card || undefined}>{card}</div>)}</>;
}

export default function RelicOrbit({ section, register }: { section: string | null; register: (handle: OrbitHandle | null) => void }) {
  const auth = useAuth();
  const root = useRef<HTMLDivElement>(null);
  // Content outlives the focus by the fold-back, so cards return to the relic with their numbers still on them.
  const [content, setContent] = useState<string | null>(section);
  const [landed, setLanded] = useState<boolean[]>([false, false, false, false]);
  const live = useRef({ section, landed: [false, false, false, false] });
  const springs = useRef(Array.from({ length: 4 }, () => ({ value: 0, velocity: 0 })));
  const last = useRef(0);
  const { data } = useRelicAnalytics(content, auth.ready && auth.signedIn);

  if (section && section !== content) setContent(section);
  useEffect(() => { live.current.section = section; }, [section]);

  useEffect(() => {
    const handle: OrbitHandle = frame => {
      const element = root.current;
      if (!element) return;
      const now = performance.now();
      const dt = Math.min((now - (last.current || now)) / 1000, 0.05);
      last.current = now;
      const cards = element.querySelectorAll<HTMLElement>(`.${styles.card}`);
      const bounds = element.getBoundingClientRect();
      let visible = false;
      let changed = false;
      springs.current.forEach((spring, index) => {
        const goal = live.current.section && frame.progress > RELEASE + index * STAGGER ? 1 : 0;
        let remaining = dt;
        while (remaining > 0) {
          const step = Math.min(remaining, 1 / 120);
          spring.velocity += (STIFFNESS * (goal - spring.value) - DAMPING * spring.velocity) * step;
          spring.value += spring.velocity * step;
          remaining -= step;
        }
        const card = cards[index];
        if (!card) return;
        const amount = spring.value;
        const slot = frame.slots[index] ?? frame.center;
        // Keep a landed card fully inside the part of the screen the panel leaves free.
        const halfW = card.offsetWidth / 2 / bounds.width;
        const halfH = card.offsetHeight / 2 / bounds.height;
        const minX = (16 - bounds.left) / bounds.width + halfW;
        const maxX = (window.innerWidth * FREE_SHARE - 16 - bounds.left) / bounds.width - halfW;
        const minY = (104 - bounds.top) / bounds.height + halfH;
        const maxY = (window.innerHeight - 84 - bounds.top) / bounds.height - halfH;
        const goalX = Math.max(minX, Math.min(maxX, slot.x));
        const goalY = Math.max(minY, Math.min(maxY, slot.y));
        const x = frame.center.x + (goalX - frame.center.x) * amount;
        const y = frame.center.y + (goalY - frame.center.y) * amount;
        const shown = Math.max(0, Math.min(1, amount));
        card.style.left = `${x * 100}%`;
        card.style.top = `${y * 100}%`;
        card.style.opacity = String(Math.min(1, shown * 1.6));
        card.style.transform = `translate(-50%, -50%) perspective(900px) rotateY(${TILT[index] * shown}deg) scale(${0.35 + 0.65 * amount})`;
        card.style.filter = shown < 0.98 ? `blur(${(1 - shown) * 7}px)` : "";
        card.style.pointerEvents = shown > 0.9 ? "auto" : "none";
        if (shown > 0.01) visible = true;
        const isLanded = amount > 0.82;
        if (isLanded !== live.current.landed[index]) { live.current.landed[index] = isLanded; changed = true; }
      });
      element.style.visibility = visible ? "visible" : "hidden";
      if (changed) setLanded([...live.current.landed]);
    };
    register(handle);
    return () => register(null);
  }, [register]);

  return <div ref={root} className={`${styles.orbit} cmd`} style={{ visibility: "hidden" }} aria-live="polite">
    {data && data.section === content && <Cards key={content} data={data} landed={landed} />}
  </div>;
}
