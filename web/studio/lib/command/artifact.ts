// Reads the chart card the dashboard agent composes. Jev only picks the presentation (line or bar);
// every number and the notes are fixed by the backend, so they are taken from spec.state untouched.
export type ArtifactPoint = { period: string; value: string; kind: "actual" | "projected" };

export type ArtifactCardModel = {
  id: string;
  title: string;
  chart: "line" | "bar";
  currency: string;
  unit: "major_currency" | "minor_currency" | "number";
  points: ArtifactPoint[];
  notes: string;
  elapsedMs: number | null;
};

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Returns a renderable card, or null when the artifact is not ready or is not a chart card. */
export function readArtifactCard(result: unknown): ArtifactCardModel | null {
  if (!record(result) || result.status !== "ready" || !record(result.spec)) return null;
  const { spec } = result;
  if (typeof spec.root !== "string" || !record(spec.elements) || !record(spec.state)) return null;
  const root = spec.elements[spec.root];
  if (!record(root) || root.type !== "FinancialArtifactCard" || !record(root.props)) return null;
  const { props } = root;
  const raw = spec.state.points;
  if (!Array.isArray(raw) || !raw.length) return null;
  const points: ArtifactPoint[] = [];
  for (const p of raw) {
    if (!record(p) || typeof p.period !== "string" || typeof p.value !== "string" || !/^-?\d+(\.\d+)?$/.test(p.value)) return null;
    points.push({ period: p.period, value: p.value, kind: p.kind === "projected" ? "projected" : "actual" });
  }
  const evaluation = record(result.evaluation) ? result.evaluation : null;
  return {
    id: typeof result.id === "string" ? result.id : crypto.randomUUID(),
    title: typeof props.title === "string" ? props.title : "Financial chart",
    chart: props.chart === "bar" ? "bar" : "line",
    currency: typeof props.currency === "string" ? props.currency : "",
    unit: props.unit === "minor_currency" || props.unit === "number" ? props.unit : "major_currency",
    points,
    notes: typeof spec.state.notes === "string" ? spec.state.notes : "",
    elapsedMs: evaluation && typeof evaluation.elapsed_ms === "number" ? evaluation.elapsed_ms : null,
  };
}

/** Periods like 2026-01 or 2026-01-15 can sit on a time axis; anything else is categorical. */
export function periodDate(period: string): Date | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(period);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatValue(value: string, card: Pick<ArtifactCardModel, "currency" | "unit">): string {
  const n = Number(value);
  if (card.unit === "number" || !card.currency) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  try {
    return n.toLocaleString("en-US", { style: "currency", currency: card.currency, maximumFractionDigits: card.unit === "minor_currency" ? 0 : 2 });
  } catch {
    return `${n.toLocaleString("en-US")} ${card.currency}`;
  }
}
