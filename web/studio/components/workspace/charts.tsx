"use client";

// Small bklit charts for the workspace. Each one replaces a paragraph: the picture is the explanation.
import { Bar, BarChart, BarXAxis, BarYAxis, ChartTooltip, Grid, Ring, RingCenter, RingChart } from "@/components/charts";

const REVEAL_MS = 520;

/** How a payable was reached: billed amount, each verified credit taken off, what is left. */
export function PayableWaterfall({ billed, credits, currency }: { billed: number; credits: { id: string; cents: number }[]; currency: string }) {
  const payable = billed - credits.reduce((sum, credit) => sum + credit.cents, 0);
  const rows = [
    { step: "Billed", base: 0, amount: billed / 100, credit: 0, total: 0 },
    ...credits.map((credit, index) => ({ step: credit.id, base: (billed - credits.slice(0, index + 1).reduce((sum, item) => sum + item.cents, 0)) / 100, amount: 0, credit: credit.cents / 100, total: 0 })),
    { step: "Payable", base: 0, amount: 0, credit: 0, total: payable / 100 },
  ];
  const format = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
  return <div className="chart-scope ws-chart ws-chart--waterfall" role="img" aria-label={`Billed ${format(billed / 100)}, payable ${format(payable / 100)}`}>
    <BarChart data={rows} xDataKey="step" stacked aspectRatio="auto" className="h-full" animationDuration={REVEAL_MS} barGap={0.34} margin={{ left: 8, right: 8, top: 10, bottom: 26 }}>
      <Grid horizontal />
      <Bar dataKey="base" fill="transparent" lineCap="butt" />
      <Bar dataKey="amount" fill="var(--chart-neutral, #252321)" lineCap={3} />
      <Bar dataKey="credit" fill="var(--chart-credit, #b3362f)" lineCap={3} />
      <Bar dataKey="total" fill="var(--chart-1)" lineCap={3} />
      <BarXAxis />
      <ChartTooltip showCrosshair={false} />
    </BarChart>
  </div>;
}

/** Two independent routes to the same payable. Equal bars mean the case ties. */
export function RouteBars({ netCents, supportedCents, currency }: { netCents: number; supportedCents: number; currency: string }) {
  const rows = [{ route: "By invoice", value: netCents / 100 }, { route: "By receipt", value: supportedCents / 100 }];
  const ties = netCents === supportedCents;
  return <div className="chart-scope ws-chart ws-chart--routes" role="img" aria-label={ties ? "Both routes agree" : "The two routes disagree"} data-currency={currency}>
    <BarChart data={rows} xDataKey="route" orientation="horizontal" aspectRatio="auto" className="h-full" animationDuration={REVEAL_MS} barGap={0.42} margin={{ left: 84, right: 12, top: 2, bottom: 2 }}>
      <Grid vertical horizontal={false} />
      <Bar dataKey="value" fill={ties ? "var(--chart-1)" : "var(--chart-credit, #b3362f)"} lineCap={3} />
      <BarYAxis showAllLabels />
      <ChartTooltip showCrosshair={false} />
    </BarChart>
  </div>;
}

/** Code checks as one ring: full and green when everything passes. */
export function ChecksRing({ passed, total }: { passed: number; total: number }) {
  const ok = passed === total;
  return <div className="chart-scope ws-ring" role="img" aria-label={`${passed} of ${total} checks pass`}>
    <RingChart data={[{ label: "Checks", value: passed, maxValue: Math.max(total, 1), color: ok ? "#2a9d63" : "#b3362f" }]} size={84} strokeWidth={7} animationDuration={REVEAL_MS}>
      <Ring index={0} />
      <RingCenter>{() => <span className="ws-ring-center"><strong>{passed}</strong>/{total}</span>}</RingCenter>
    </RingChart>
  </div>;
}

/** Precision against recall per system. High precision means little when recall collapses. */
export function TradeoffBars({ rows }: { rows: { system: string; precision: number; recall: number }[] }) {
  return <div className="chart-scope ws-chart ws-chart--tradeoff" role="img" aria-label="Precision and recall by system" style={{ height: rows.length * 46 + 30 }}>
    <BarChart data={rows} xDataKey="system" orientation="horizontal" aspectRatio="auto" className="h-full" animationDuration={REVEAL_MS} barGap={0.3} margin={{ left: 132, right: 14, top: 2, bottom: 2 }}>
      <Grid vertical horizontal={false} />
      <Bar dataKey="precision" fill="var(--chart-neutral, #252321)" lineCap={3} />
      <Bar dataKey="recall" fill="var(--chart-1)" lineCap={3} />
      <BarYAxis showAllLabels />
      <ChartTooltip showCrosshair={false} />
    </BarChart>
  </div>;
}
