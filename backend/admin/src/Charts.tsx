// Small SVG charts for the portal: lines with a crosshair tooltip, horizontal bars, a funnel and a week × hour heatmap.
// Colours follow the validated categorical order (blue, orange, aqua) and one blue ramp for magnitude; values and
// labels use text colours, the coloured mark beside them carries identity; every chart has a hover read-out.
import { useState, type ReactNode } from 'react';

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const;
/** Light → dark blue, for magnitude (the heatmap). */
const RAMP = ['#eef4fc', '#cfe0f7', '#a6c6ef', '#78a6e3', '#4c86d6', '#2a6ac4', '#174f9f', '#0b3a78'];

export interface Line {
  readonly name: string;
  readonly color: string;
  readonly values: readonly number[];
}

/** One y-axis; nice round top value. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function LineChart({ labels, lines, format = (n) => String(n), height = 240, area = false }: { readonly labels: readonly string[]; readonly lines: readonly Line[]; readonly format?: (n: number) => string; readonly height?: number; readonly area?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const max = niceMax(Math.max(0, ...lines.flatMap((l) => l.values)));
  const n = labels.length;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  // Whole numbers for small counts (no "1" twice); quarters otherwise.
  const ticks = max <= 8 ? Array.from({ length: max + 1 }, (_, i) => i).filter((v) => max <= 4 || v % 2 === 0) : [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(n / 8));
  const showLabel = (i: number) => i % every === 0 || (i === n - 1 && (n - 1) % every >= every / 2);
  return (
    <div className="chart">
      {lines.length > 1 ? <Legend items={lines.map((l) => ({ name: l.name, color: l.color }))} /> : null}
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="gridline" />
            <text x={pad.l - 8} y={y(t) + 4} className="axis" textAnchor="end">{format(Math.round(t))}</text>
          </g>
        ))}
        {labels.map((l, i) => (showLabel(i) ? <text key={l} x={x(i)} y={H - 8} className="axis" textAnchor={i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>{l}</text> : null))}
        {lines.map((l) => {
          const d = l.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
          return (
            <g key={l.name}>
              {area ? <path d={`${d} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={l.color} opacity="0.12" /> : null}
              <path d={d} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="crosshair" />
            {lines.map((l) => <circle key={l.name} cx={x(hover)} cy={y(l.values[hover] ?? 0)} r="4.5" fill={l.color} stroke="#fff" strokeWidth="2" />)}
          </g>
        ) : null}
      </svg>
      {hover !== null ? (
        <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{labels[hover]}</b>
          {lines.map((l) => <div key={l.name}><i style={{ background: l.color }} />{l.name}: <b>{format(l.values[hover] ?? 0)}</b></div>)}
        </div>
      ) : null}
    </div>
  );
}

export function Legend({ items }: { readonly items: readonly { readonly name: string; readonly color: string }[] }) {
  return <div className="legend">{items.map((i) => <span key={i.name}><i className="dot" style={{ background: i.color }} />{i.name}</span>)}</div>;
}

export function HBars({ rows, color = SERIES[0], format = (n) => String(n), empty = 'No data yet' }: { readonly rows: readonly { readonly label: ReactNode; readonly value: number; readonly sub?: string }[]; readonly color?: string; readonly format?: (n: number) => string; readonly empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <div className="muted small chart-empty">{empty}</div>;
  return (
    <div className="hbars">
      {rows.map((r, i) => (
        <div key={i} className="hbar" title={`${typeof r.label === 'string' ? r.label : ''}: ${format(r.value)}${r.sub ? ` · ${r.sub}` : ''}`}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track"><span className="hbar-fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color }} /></span>
          <span className="hbar-value">{format(r.value)}{r.sub ? <small> {r.sub}</small> : null}</span>
        </div>
      ))}
    </div>
  );
}

export function Funnel({ steps }: { readonly steps: readonly { readonly label: string; readonly value: number }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <div className="funnel">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1]!.value : null;
        return (
          <div key={s.label} className="funnel-step" title={`${s.label}: ${s.value}`}>
            <div className="funnel-bar" style={{ width: `${Math.max(4, (s.value / top) * 100)}%` }}><b>{s.value}</b></div>
            <span>{s.label}</span>
            <small className="muted">{prev ? `${Math.round((s.value / Math.max(1, prev)) * 100)}% of the step before` : 'all bookings'}</small>
          </div>
        );
      })}
    </div>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Bookings by weekday and hour (India time): one blue, light to dark. */
export function Heatmap({ cells }: { readonly cells: readonly { readonly dow: number; readonly hour: number; readonly count: number }[] }) {
  const [hover, setHover] = useState<{ dow: number; hour: number; count: number } | null>(null);
  const max = Math.max(1, ...cells.map((c) => c.count));
  const at = (dow: number, hour: number) => cells.find((c) => c.dow === dow && c.hour === hour)?.count ?? 0;
  return (
    <div className="heatmap">
      <div className="heat-grid">
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="heat-hour">{h % 3 === 0 ? h : ''}</span>)}
        {DAYS.map((d, di) => (
          <div key={d} className="heat-row">
            <span className="heat-day">{d}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const c = at(di + 1, h);
              const step = c === 0 ? -1 : Math.min(RAMP.length - 1, Math.floor((c / max) * (RAMP.length - 1)));
              return <span key={h} className="heat-cell" style={{ background: step < 0 ? '#f3f5fa' : RAMP[step] }} onMouseEnter={() => setHover({ dow: di + 1, hour: h, count: c })} onMouseLeave={() => setHover(null)} />;
            })}
          </div>
        ))}
      </div>
      <div className="heat-foot">
        <span className="muted small">{hover ? `${DAYS[hover.dow - 1]} ${hover.hour}:00–${hover.hour + 1}:00 · ${hover.count} booking${hover.count === 1 ? '' : 's'}` : 'Hover a square'}</span>
        <span className="heat-scale"><span className="muted small">fewer</span>{RAMP.map((c) => <i key={c} style={{ background: c }} />)}<span className="muted small">more</span></span>
      </div>
    </div>
  );
}
