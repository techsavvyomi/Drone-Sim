// Fixed-size ring buffers for streaming telemetry. Charts read straight from
// these typed arrays; nothing per-sample goes through React state, so a 60 Hz
// trace costs no re-renders.

export interface Series {
  key: string;
  label: string;
  color: string;
}

const CAPACITY = 900; // ~15 s at 60 Hz

export class TelemetryBuffer {
  readonly capacity = CAPACITY;
  private time = new Float64Array(CAPACITY);
  private data: Map<string, Float32Array> = new Map();
  private head = 0;
  private filled = 0;

  constructor(readonly series: Series[]) {
    for (const s of series) this.data.set(s.key, new Float32Array(CAPACITY));
  }

  push(t: number, values: Record<string, number>): void {
    this.time[this.head] = t;
    for (const s of this.series) {
      const arr = this.data.get(s.key);
      if (arr) arr[this.head] = values[s.key] ?? 0;
    }
    this.head = (this.head + 1) % CAPACITY;
    this.filled = Math.min(this.filled + 1, CAPACITY);
  }

  clear(): void {
    this.head = 0;
    this.filled = 0;
  }

  /** Snapshot in chronological order: [time, ...series] as uPlot expects. */
  snapshot(): number[][] {
    const n = this.filled;
    const out: number[][] = [new Array(n)];
    for (let i = 0; i < this.series.length; i++) out.push(new Array(n));

    const start = this.filled === CAPACITY ? this.head : 0;
    for (let i = 0; i < n; i++) {
      const idx = (start + i) % CAPACITY;
      out[0][i] = this.time[idx];
      for (let s = 0; s < this.series.length; s++) {
        const arr = this.data.get(this.series[s].key)!;
        out[s + 1][i] = arr[idx];
      }
    }
    return out;
  }
}
