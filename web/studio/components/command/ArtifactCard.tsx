"use client";

// A chart the agent composed, drawn with the bklit charts. Geometry uses JS numbers; the table keeps
// the backend's exact decimal strings.
import { useState } from "react";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid, Line, LineChart, XAxis } from "@/components/charts";
import { formatValue, periodDate, type ArtifactCardModel } from "@/lib/command/artifact";

// Short reveal: the default 1.1 s animation would eat the whole voice-to-chart budget.
const REVEAL_MS = 360;

export default function ArtifactCard({ card, onDismiss }: { card: ArtifactCardModel; onDismiss: () => void }) {
  const [table, setTable] = useState(false);
  const dates = card.points.map((p) => periodDate(p.period));
  const timeAxis = card.chart === "line" && dates.every(Boolean) && card.points.length > 1;
  const rows = card.points.map((p, i) => ({ period: p.period, date: dates[i] ?? undefined, value: Number(p.value) }));

  return (
    <article className="cmd-card" data-pointable={`artifact:${card.id}`} data-pointable-label={card.title}>
      <header>
        <div>
          <span className="cmd-eyebrow">{timeAxis ? "Line" : "Bar"} · {card.currency || "count"}{card.elapsedMs !== null ? ` · chosen in ${Math.round(card.elapsedMs)} ms` : ""}</span>
          <h3>{card.title}</h3>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss chart" data-cursor="hide">×</button>
      </header>
      <div className="cmd-chart">
        {timeAxis ? (
          <LineChart data={rows} xDataKey="date" aspectRatio="auto" className="h-full" animationDuration={REVEAL_MS} margin={{ left: 12, right: 16, top: 12, bottom: 28 }}>
            <Grid horizontal />
            <Line dataKey="value" stroke="var(--chart-1)" />
            <XAxis />
            <ChartTooltip />
          </LineChart>
        ) : (
          <BarChart data={rows} xDataKey="period" aspectRatio="auto" className="h-full" animationDuration={REVEAL_MS} barGap={0.3} margin={{ left: 12, right: 16, top: 12, bottom: 28 }}>
            <Grid horizontal />
            <Bar dataKey="value" fill="var(--chart-1)" lineCap={3} />
            <BarXAxis />
            <ChartTooltip showCrosshair={false} />
          </BarChart>
        )}
      </div>
      <button type="button" className="cmd-link" onClick={() => setTable((v) => !v)} aria-expanded={table} data-cursor="hide">
        {table ? "Hide exact values" : "Exact values and sources"}
      </button>
      {table && (
        <div className="cmd-detail">
          <table>
            <tbody>
              {card.points.map((p) => (
                <tr key={p.period}><th scope="row">{p.period}</th><td>{formatValue(p.value, card)}</td></tr>
              ))}
            </tbody>
          </table>
          {card.notes && <p>{card.notes}</p>}
        </div>
      )}
    </article>
  );
}
