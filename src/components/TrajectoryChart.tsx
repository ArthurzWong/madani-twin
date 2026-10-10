/**
 * Lightweight dependency-free SVG charts driven purely by engine output.
 * Deterministic: same engine result => same chart.
 */
import type { EngineResult, ScenarioState } from "../engine/types";
import { formatMYR } from "../engine/money";

interface Props {
  scenarios: Array<{ name: string; engine: EngineResult; color: string; emphasize?: boolean }>;
  reserveSen: number;
  height?: number;
}

export function TrajectoryChart({ scenarios, reserveSen, height = 260 }: Props) {
  const W = 900;
  const H = height;
  const PAD_L = 74;
  const PAD_R = 16;
  const PAD_T = 18;
  const PAD_B = 34;
  const horizon = scenarios[0]?.engine.horizonDays ?? 30;

  const allVals = scenarios.flatMap((s) => s.engine.daily.map((d) => d.closingSen)).concat(reserveSen);
  const minV = Math.min(0, ...allVals);
  const maxV = Math.max(...allVals);
  const span = maxV - minV || 1;
  const x = (day: number) => PAD_L + (day / horizon) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - (v - minV) / span) * (H - PAD_T - PAD_B);

  // y ticks: 5 values
  const ticks = Array.from({ length: 5 }, (_, i) => minV + (span * i) / 4);
  // x ticks every 5 days
  const xticks = Array.from({ length: Math.floor(horizon / 5) + 1 }, (_, i) => i * 5).filter((d) => d <= horizon);

  const path = (s: { engine: EngineResult }) =>
    s.engine.daily.map((d, i) => `${i === 0 ? "M" : "L"}${x(d.day).toFixed(1)},${y(d.closingSen).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Projected daily closing cash trajectories">
      {/* grid */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={y(t)} x2={W - PAD_R} y2={y(t)} stroke="#e5e9f0" strokeWidth="1" />
          <text x={PAD_L - 8} y={y(t) + 4} textAnchor="end" className="chart-tick">{formatMYR(t, { compact: true })}</text>
        </g>
      ))}
      {xticks.map((d) => (
        <g key={d}>
          <line x1={x(d)} y1={PAD_T} x2={x(d)} y2={H - PAD_B} stroke="#f0f3f8" strokeWidth="1" />
          <text x={x(d)} y={H - PAD_B + 16} textAnchor="middle" className="chart-tick">Day {d}</text>
        </g>
      ))}
      {/* reserve line */}
      <line x1={PAD_L} y1={y(reserveSen)} x2={W - PAD_R} y2={y(reserveSen)} stroke="#d64545" strokeWidth="1.5" strokeDasharray="6 4" />
      <text x={W - PAD_R - 4} y={y(reserveSen) - 6} textAnchor="end" className="chart-reserve-label">Minimum reserve {formatMYR(reserveSen, { compact: true })}</text>
      {/* breach shading for emphasized scenario */}
      {scenarios.filter((s) => s.emphasize).map((s) =>
        s.engine.breachEpisodes.map((ep, i) => (
          <rect key={i} x={x(ep.startDay)} y={PAD_T} width={Math.max(2, x(ep.endDay) - x(ep.startDay))} height={H - PAD_T - PAD_B} fill="rgba(214,69,69,0.08)" />
        ))
      )}
      {/* lines */}
      {scenarios.map((s) => (
        <g key={s.name}>
          <path d={path(s)} fill="none" stroke={s.color} strokeWidth={s.emphasize ? 2.6 : 1.8} strokeDasharray={s.emphasize ? undefined : "0"} />
          {/* min point marker */}
          <circle cx={x(s.engine.minDay)} cy={y(s.engine.minBalanceSen)} r="4" fill={s.color} stroke="#fff" strokeWidth="1.5" />
        </g>
      ))}
    </svg>
  );
}

export function ChartLegend({ items }: { items: Array<{ name: string; color: string; desc?: string }> }) {
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span key={it.name} className="legend-item">
          <span className="legend-swatch" style={{ background: it.color }} />
          <strong>{it.name}</strong>{it.desc && <span className="muted"> — {it.desc}</span>}
        </span>
      ))}
    </div>
  );
}
