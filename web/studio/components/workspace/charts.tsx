"use client";

// Workspace charts, built from the bklit components as documented (bklit.com/docs/components): the
// library's own caps, tokens, glow and entrance animation are left alone. Each chart replaces a paragraph.
import { Area, AreaChart, Bar, BarChart, BarYAxis, ChartTooltip, FunnelChart, Gauge, Grid, Ring, RingCenter, RingChart, XAxis } from "@/components/charts";

const money = (currency: string) => (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);

/** Billed amount narrowing to the payable as each verified credit comes off. bklit FunnelChart. */
export function PayableFunnel({ billed, credits, currency }: { billed: number; credits: { id: string; cents: number }[]; currency: string }) {
  const format = money(currency);
  const stages = [{ label: "Billed", value: billed / 100 }];
  credits.forEach((credit, index) => {
    const left = (billed - credits.slice(0, index + 1).reduce((sum, item) => sum + item.cents, 0)) / 100;
    stages.push({ label: index === credits.length - 1 ? "Payable" : `After ${credit.id}`, value: left });
  });
  const data = stages.map(stage => ({ ...stage, displayValue: format(stage.value) }));
  return <div className="chart-scope ws-chart--funnel" role="img" aria-label={`Billed ${format(billed / 100)}, payable ${data[data.length - 1].displayValue}`}>
    <FunnelChart data={data} color="var(--chart-1)" layers={3} formatValue={format} />
  </div>;
}

/** Two independent routes to the same payable. Equal bars mean the case ties. bklit BarChart, horizontal. */
export function RouteBars({ netCents, supportedCents, currency }: { netCents: number; supportedCents: number; currency: string }) {
  const rows = [{ route: "By invoice", value: netCents / 100 }, { route: "By receipt", value: supportedCents / 100 }];
  const ties = netCents === supportedCents;
  return <div className="chart-scope ws-chart--routes" role="img" aria-label={ties ? "Both routes agree" : "The two routes disagree"} data-currency={currency}>
    <BarChart data={rows} xDataKey="route" orientation="horizontal" aspectRatio="auto" className="h-full" barGap={0.4} margin={{ left: 84, right: 16, top: 4, bottom: 4 }}>
      <Grid vertical horizontal={false} />
      <Bar dataKey="value" fill={ties ? "var(--chart-line-primary)" : "var(--chart-line-secondary)"} />
      <BarYAxis showAllLabels />
      <ChartTooltip showCrosshair={false} />
    </BarChart>
  </div>;
}

/** Code checks as a bklit RingChart: the ring closes as checks pass. */
export function ChecksRing({ passed, total }: { passed: number; total: number }) {
  const data = [{ label: `of ${total} checks`, value: passed, maxValue: Math.max(total, 1), color: passed === total ? "var(--chart-3)" : "var(--chart-2)" }];
  return <div className="chart-scope ws-ring" role="img" aria-label={`${passed} of ${total} checks pass`}>
    <RingChart data={data} size={132} strokeWidth={12} baseInnerRadius={44}>
      <Ring index={0} />
      <RingCenter defaultLabel={`of ${total} checks`} />
    </RingChart>
  </div>;
}

/** Precision against recall per system. bklit BarChart, grouped and horizontal. */
export function TradeoffBars({ rows }: { rows: { system: string; precision: number; recall: number }[] }) {
  return <div className="chart-scope ws-chart--tradeoff" role="img" aria-label="Precision and recall by system" style={{ height: rows.length * 52 + 24 }}>
    <BarChart data={rows} xDataKey="system" orientation="horizontal" aspectRatio="auto" className="h-full" barGap={0.28} margin={{ left: 148, right: 16, top: 4, bottom: 4 }}>
      <Grid vertical horizontal={false} />
      <Bar dataKey="precision" fill="var(--chart-line-primary)" />
      <Bar dataKey="recall" fill="var(--chart-line-secondary)" />
      <BarYAxis showAllLabels />
      <ChartTooltip showCrosshair={false} />
    </BarChart>
  </div>;
}

/** Payables volume over time. bklit AreaChart on a time axis. */
export function VolumeArea({ points }: { points: { date: Date; value: number }[] }) {
  return <div className="chart-scope ws-chart--volume" role="img" aria-label="Payables by month">
    <AreaChart data={points} xDataKey="date" aspectRatio="auto" className="h-full" margin={{ left: 8, right: 8, top: 12, bottom: 28 }}>
      <Grid horizontal />
      <Area dataKey="value" />
      <XAxis />
      <ChartTooltip />
    </AreaChart>
  </div>;
}

/** Share of sources that are searchable. bklit arc Gauge with its own center label. */
export function CoverageGauge({ percent, count, label }: { percent: number; count: number; label: string }) {
  return <div className="chart-scope ws-gauge" role="img" aria-label={`${Math.round(percent)} percent ${label}`}>
    <Gauge value={Math.max(0, Math.min(100, percent))} centerValue={count} defaultLabel={label} spacing={25} inactiveFillOpacity={0.4} minWidth={220} />
  </div>;
}

/** Reported run outcomes for a skill, one ring each. bklit RingChart. */
export function OutcomeRings({ passed, failed, needsInput }: { passed: number; failed: number; needsInput: number }) {
  const total = Math.max(passed + failed + needsInput, 1);
  const data = [
    { label: "Passed", value: passed, maxValue: total, color: "var(--chart-3)" },
    { label: "Failed", value: failed, maxValue: total, color: "var(--chart-2)" },
    { label: "Needs input", value: needsInput, maxValue: total, color: "var(--chart-4)" },
  ];
  return <div className="chart-scope ws-rings" role="img" aria-label={`${passed} passed, ${failed} failed, ${needsInput} need input`}>
    <RingChart data={data} size={150} strokeWidth={9} ringGap={5} baseInnerRadius={34}>
      {data.map((item, index) => <Ring key={item.label} index={index} />)}
      <RingCenter defaultLabel="Runs" />
    </RingChart>
  </div>;
}
