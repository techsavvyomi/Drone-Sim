import { useState } from 'react';

// The dashboard's two chart forms, drawn as plain SVG/HTML.
//
// Every chart here plots ONE series in the app accent, so there is no legend
// (the card title names the series), no second axis, and text stays in the text
// tokens rather than the data colour. Each mark carries its own hover/focus
// tooltip, and every value is also reachable without hovering: the column chart
// has a table view, and the bar list prints its values.

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** A clean round maximum for the y axis: 1, 2, 5 x 10^n. */
function niceMax(value: number): number {
  // Never below 2, so the half-way gridline is a whole number too.
  if (value <= 2) return 2;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 5, 10]) if (value <= step * exp) return step * exp;
  return 10 * exp;
}

/** Axis maxima for durations whose half is also a round time. */
const TIME_MAXIMA = [20, 60, 120, 600, 1200, 3600, 7200, 14400, 36000, 72000, 172800];

function niceTimeMax(sec: number): number {
  return TIME_MAXIMA.find((m) => sec <= m) ?? niceMax(sec);
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export interface ColumnDatum {
  date: string;
  value: number;
}

/** Daily columns with a hover tooltip and a table view. */
export function DailyColumns({
  data,
  format,
  label,
  timeAxis = false,
}: {
  data: ColumnDatum[];
  /** Values are seconds: the axis steps in round minutes and hours. */
  timeAxis?: boolean;
  format: (v: number) => string;
  /** What one value is, for the tooltip and the table header. */
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const W = 560;
  const H = 180;
  const pad = { top: 10, right: 8, bottom: 22, left: 44 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const peak = Math.max(0, ...data.map((d) => d.value));
  const max = timeAxis ? niceTimeMax(peak) : niceMax(peak);
  const band = data.length > 0 ? plotW / data.length : plotW;
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const total = data.reduce((s, d) => s + d.value, 0);

  if (asTable) {
    return (
      <div className="pchart">
        <button type="button" className="pchart-toggle" onClick={() => setAsTable(false)}>
          Chart view
        </button>
        <div className="pchart-table">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>{label}</th>
              </tr>
            </thead>
            <tbody>
              {data
                .filter((d) => d.value > 0)
                .map((d) => (
                  <tr key={d.date}>
                    <td>{shortDate(d.date)}</td>
                    <td>{format(d.value)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {total === 0 && <p className="pempty">Nothing in this period yet.</p>}
        </div>
      </div>
    );
  }

  const tip = hover !== null ? data[hover] : null;

  // An empty month is a sentence, not an axis of zeros.
  if (total === 0) {
    return <p className="pempty pchart-empty">Nothing in the last {data.length} days yet.</p>;
  }

  return (
    <div className="pchart">
      <button type="button" className="pchart-toggle" onClick={() => setAsTable(true)}>
        Table view
      </button>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="pchart-svg"
        role="img"
        aria-label={`${label} per day, last ${data.length} days: ${format(total)} in total`}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={y(max * f)}
              y2={y(max * f)}
              className="pchart-grid"
            />
            <text x={pad.left - 8} y={y(max * f) + 4} className="pchart-tick" textAnchor="end">
              {format(max * f)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.left + i * band + (band - barW) / 2;
          const h = (d.value / max) * plotH;
          const r = Math.min(4, barW / 2, h);
          const top = pad.top + plotH - h;
          const base = pad.top + plotH;
          // Rounded at the data end, square at the baseline.
          const path =
            h <= 0
              ? ''
              : `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`;
          // Weekly, counted back from today so the last column is always labelled.
          const showLabel = (data.length - 1 - i) % 7 === 0;
          return (
            <g key={d.date}>
              {path && <path d={path} className={`pchart-bar ${hover === i ? 'on' : ''}`} />}
              {/* The hit target is the whole column band, not just the ink. */}
              <rect
                x={pad.left + i * band}
                y={pad.top}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${shortDate(d.date)}: ${format(d.value)}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {showLabel && (
                <text x={pad.left + i * band + band / 2} y={H - 6} className="pchart-tick" textAnchor="middle">
                  {shortDate(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tip && hover !== null && (
        <div
          className="pchart-tip"
          style={{ left: `${((pad.left + hover * band + band / 2) / W) * 100}%` }}
        >
          <b>{format(tip.value)}</b>
          <span>{shortDate(tip.date)}</span>
        </div>
      )}
    </div>
  );
}

export interface BarDatum {
  id: string;
  label: string;
  value: number;
  /** Printed beside the bar. */
  display: string;
  /** Extra line in the tooltip. */
  detail?: string;
}

/** Horizontal bars, values printed at the tip. */
export function BarList({ data, empty }: { data: BarDatum[]; empty: string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  if (data.length === 0 || max === 0) return <p className="pempty">{empty}</p>;
  return (
    <ul className="pbars">
      {data.map((d) => (
        <li key={d.id} title={d.detail ? `${d.label}: ${d.display}. ${d.detail}` : `${d.label}: ${d.display}`}>
          <span className="pbars-label">{d.label}</span>
          <span className="pbars-track">
            <span className="pbars-fill" style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="pbars-value">{d.display}</span>
        </li>
      ))}
    </ul>
  );
}
