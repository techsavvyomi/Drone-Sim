import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { TelemetryBuffer } from '../sim/telemetryBuffer';

// A single streaming uPlot chart driven by a ring buffer. Redraws on rAF and
// never touches React state, so high-rate traces stay cheap.
export function TelemetryChart({
  buffer,
  title,
  height = 92,
  range,
}: {
  buffer: TelemetryBuffer;
  title: string;
  height?: number;
  range?: [number, number];
}) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const opts: uPlot.Options = {
      width: el.clientWidth || 240,
      height,
      legend: { show: false },
      cursor: { show: false },
      scales: {
        x: { time: false },
        y: range ? { range: [range[0], range[1]] } : {},
      },
      axes: [
        {
          show: false,
        },
        {
          stroke: '#8291a8',
          grid: { stroke: '#1e2a3d', width: 1 },
          ticks: { stroke: '#1e2a3d' },
          size: 34,
          font: '10px Inter, system-ui, sans-serif',
        },
      ],
      series: [
        {},
        ...buffer.series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 1.4,
          points: { show: false },
        })),
      ],
    };

    plot.current = new uPlot(opts, buffer.snapshot() as uPlot.AlignedData, el);

    const onResize = () => plot.current?.setSize({ width: el.clientWidth, height });
    window.addEventListener('resize', onResize);

    let raf = 0;
    const tick = () => {
      plot.current?.setData(buffer.snapshot() as uPlot.AlignedData);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      plot.current?.destroy();
      plot.current = null;
    };
  }, [buffer, height, range]);

  return (
    <div className="chart">
      <div className="chart-head">
        <span>{title}</span>
        <span className="chart-legend">
          {buffer.series.map((s) => (
            <i key={s.key} style={{ color: s.color }}>
              {s.label}
            </i>
          ))}
        </span>
      </div>
      <div ref={host} className="chart-host" />
    </div>
  );
}
