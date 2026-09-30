import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { TelemetryBuffer } from '../sim/telemetryBuffer';
import { token } from '../styles/tokens';
import { fixed } from '../hud/cockpitFacts';

// One trace of the telemetry dock's GRAPHS tab (Phase 6): a single `plot`-blue
// line over the last 6 s, the live value in the head and the range it covered
// underneath. Redraws on rAF and writes the two numbers straight into the DOM,
// so a 60 Hz trace never goes through React.

/** Seconds of history each trace shows. */
export const TRACE_SECONDS = 6;

export function TelemetryChart({
  buffer,
  seriesKey,
  title,
  unit,
  digits = 1,
  height = 44,
  minSpan = 0,
}: {
  buffer: TelemetryBuffer;
  seriesKey: string;
  title: string;
  /** "°/s", " %", " V" — printed after each number. */
  unit: string;
  digits?: number;
  height?: number;
  /** The y axis covers at least this much, centred on the data — so a drone
   *  sitting still draws a flat line, not its sensor noise blown up to fill
   *  the plot. */
  minSpan?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLElement>(null);
  const rangeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const data: [number[], number[]] = [[], []];

    const plot = new uPlot(
      {
        width: el.clientWidth || 240,
        height,
        legend: { show: false },
        cursor: { show: false },
        scales: {
          x: { time: false },
          y: {
            range: (_u, lo, hi) => {
              const mid = (lo + hi) / 2;
              const half = Math.max((hi - lo) / 2, minSpan / 2, 1e-6);
              return [mid - half, mid + half];
            },
          },
        },
        axes: [{ show: false }, { show: false }],
        series: [{}, { stroke: token('plot'), width: 1.5, points: { show: false } }],
      },
      data as uPlot.AlignedData,
      el,
    );

    const fmt = (v: number) => `${fixed(v, digits)}${unit}`;
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height }));
    ro?.observe(el);

    let raf = 0;
    let frame = 0;
    const tick = () => {
      buffer.window(seriesKey, TRACE_SECONDS, data);
      plot.setData(data as uPlot.AlignedData);
      // The numbers at the HUD's 10 Hz-ish, not every frame: text that changes
      // sixty times a second cannot be read anyway.
      if (frame++ % 6 === 0 && data[1].length) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of data[1]) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (valueRef.current) valueRef.current.textContent = fmt(data[1][data[1].length - 1]);
        if (rangeRef.current)
          rangeRef.current.textContent = `${fmt(lo)} to ${fmt(hi)} · last ${TRACE_SECONDS} s`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      plot.destroy();
    };
  }, [buffer, seriesKey, height, unit, digits, minSpan]);

  return (
    <div className="tdock-trace">
      <div className="tdock-trace__head">
        <span className="ck-label">{title}</span>
        <b ref={valueRef}>—</b>
      </div>
      <div ref={host} className="tdock-trace__plot" />
      <span ref={rangeRef} className="tdock-trace__range">
        Waiting for data · last {TRACE_SECONDS} s
      </span>
    </div>
  );
}
