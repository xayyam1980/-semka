// Small charts for the dashboard and the analysis: one series each, theme colours, a hover title on every mark.
import type { AreaStatus } from "../../../shared/ipc";
import { shortDate } from "../lib/format";

/** Recent scores as a 2px line with end dot; the percentages are in the title for hover and screen readers. */
export function Sparkline({ values, width = 84, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-xs text-muted">{values.length ? `${values[0]} %` : "–"}</span>;
  const x = (i: number) => 3 + (i * (width - 6)) / (values.length - 1);
  const y = (v: number) => height - 3 - (Math.max(0, Math.min(100, v)) / 100) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} role="img" aria-label={`Ostatnie wyniki: ${values.map((v) => `${v} %`).join(", ")}`} className="shrink-0">
      <title>{values.map((v) => `${v} %`).join(" → ")}</title>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={3} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}

/** A horizontal bar 0–100 % with a rounded end; colour from the status it shows. */
export function Meter({ percent, status, label }: { percent: number | null; status?: AreaStatus; label?: string }) {
  // Too little data: neutral, so a low bar does not look like a verdict.
  const color = status === "opanowane" ? "var(--ok)" : status === "slabe" ? "var(--bad)" : status === "do_pracy" ? "var(--warn)" : status === "za_malo" ? "var(--muted)" : "var(--accent)";
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? 0} aria-label={label ?? "wynik"} title={percent === null ? "brak danych" : `${percent} %`}>
      <div style={{ width: `${percent ?? 0}%`, background: color }} />
    </div>
  );
}

const STATUS: Record<AreaStatus, { icon: string; label: string; cls: string }> = {
  opanowane: { icon: "●", label: "opanowane", cls: "text-[var(--ok)]" },
  do_pracy: { icon: "◐", label: "do pracy", cls: "text-[var(--warn)]" },
  slabe: { icon: "○", label: "słabe", cls: "text-[var(--bad)]" },
  za_malo: { icon: "·", label: "za mało danych", cls: "text-muted" },
};

/** Status always as icon + word, never colour alone. */
export function StatusTag({ status }: { status: AreaStatus }) {
  const s = STATUS[status];
  return (
    <span className={`whitespace-nowrap text-sm font-bold ${s.cls}`}>
      {s.icon} {s.label}
    </span>
  );
}

/** "▲ 6 pp" / "▼ 4 pp" / "━"; the sign is in the text, colour only repeats it. */
export function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-sm text-muted">–</span>;
  if (value === 0) return <span className="text-sm text-muted">━</span>;
  return <span className={`tabular whitespace-nowrap text-sm ${value > 0 ? "text-[var(--ok)]" : "text-[var(--bad)]"}`}>{value > 0 ? "▲" : "▼"} {Math.abs(value)} pp</span>;
}

/**
 * Score over time: one dot per attempt on a 0–100 % axis. Shape tells the mode (● practice, ◆ simulation) and the
 * legend says so; each mark has a hover title with date and points.
 */
export function Timeline({ points }: { points: { at: string; percent: number; mode: "nauka" | "symulacja"; points: number; max: number }[] }) {
  const W = 560, H = 190, L = 40, R = 12, T = 12, B = 28;
  if (!points.length) return <p className="text-sm text-muted">Brak prób w tym okresie.</p>;
  const t0 = Date.parse(points[0]!.at), t1 = Date.parse(points.at(-1)!.at);
  const x = (iso: string) => (t1 === t0 ? (L + W - R) / 2 : L + ((Date.parse(iso) - t0) / (t1 - t0)) * (W - L - R));
  const y = (p: number) => T + (1 - p / 100) * (H - T - B);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.percent).toFixed(1)}`).join(" ");
  return (
    <figure className="m-0 flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Wynik w czasie">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth={1} />
            <text x={L - 6} y={y(g) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {g}%
            </text>
          </g>
        ))}
        <text x={L} y={H - 8} fontSize={11} fill="var(--muted)">{shortDate(points[0]!.at)}</text>
        {points.length > 1 && <text x={W - R} y={H - 8} textAnchor="end" fontSize={11} fill="var(--muted)">{shortDate(points.at(-1)!.at)}</text>}
        <path d={line} fill="none" stroke="var(--line)" strokeWidth={2} />
        {points.map((p, i) => {
          const cx = x(p.at), cy = y(p.percent);
          const title = `${shortDate(p.at)} · ${p.mode === "symulacja" ? "symulacja" : "nauka"} · ${p.points}/${p.max} pkt (${p.percent} %)`;
          return p.mode === "symulacja" ? (
            <g key={i}>
              <rect x={cx - 6} y={cy - 6} width={12} height={12} transform={`rotate(45 ${cx} ${cy})`} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
              <rect x={cx - 12} y={cy - 12} width={24} height={24} fill="transparent"><title>{title}</title></rect>
            </g>
          ) : (
            <g key={i}>
              <circle cx={cx} cy={cy} r={5} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} />
              <circle cx={cx} cy={cy} r={12} fill="transparent"><title>{title}</title></circle>
            </g>
          );
        })}
      </svg>
      <figcaption className="flex gap-4 text-sm text-muted">
        <span>○ nauka</span>
        <span>◆ symulacja</span>
      </figcaption>
    </figure>
  );
}
