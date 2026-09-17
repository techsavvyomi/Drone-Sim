import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Runs the Apps Script backend (backend/apps-script/*.js) inside Node.
//
// Apps Script concatenates a project's files into one global scope; this does
// the same in a VM context and supplies in-memory stand-ins for the handful of
// Google services the backend touches. The fakes are deliberately literal: a
// sheet is a 2-D array, a range reads and writes slices of it. What they do NOT
// model is Sheets' own type coercion (a typed "2026-01-01" becoming a date),
// which is why the backend writes Date objects and numbers itself.

type Cell = unknown;

export interface FakeChart {
  type: string;
  options: Record<string, unknown>;
  ranges: { row: number; col: number; numRows: number; numCols: number }[];
  position: [number, number];
}

export class FakeSheet {
  data: Cell[][] = [];
  frozen = 0;
  charts: FakeChart[] = [];
  constructor(public name: string) {}

  getName(): string {
    return this.name;
  }

  getLastRow(): number {
    for (let r = this.data.length - 1; r >= 0; r--) {
      if ((this.data[r] ?? []).some((v) => v !== '' && v !== undefined && v !== null)) return r + 1;
    }
    return 0;
  }

  getLastColumn(): number {
    let max = 0;
    for (const row of this.data) {
      for (let c = row.length - 1; c >= 0; c--) {
        if (row[c] !== '' && row[c] !== undefined && row[c] !== null) {
          max = Math.max(max, c + 1);
          break;
        }
      }
    }
    return max;
  }

  getRange(row: number, col: number, numRows = 1, numCols = 1): FakeRange {
    return new FakeRange(this, row, col, numRows, numCols);
  }

  getCharts(): FakeChart[] {
    return [...this.charts];
  }

  removeChart(chart: FakeChart): void {
    this.charts = this.charts.filter((c) => c !== chart);
  }

  insertChart(chart: FakeChart): void {
    this.charts.push(chart);
  }

  newChart() {
    const chart: FakeChart = { type: '', options: {}, ranges: [], position: [0, 0] };
    const builder = {
      setChartType: (t: string) => ((chart.type = t), builder),
      setNumHeaders: () => builder,
      setOption: (k: string, v: unknown) => ((chart.options[k] = v), builder),
      addRange: (r: FakeRange) => (chart.ranges.push(r.bounds()), builder),
      setPosition: (row: number, col: number) => ((chart.position = [row, col]), builder),
      build: () => chart,
    };
    return builder;
  }

  setFrozenRows(n: number): void {
    this.frozen = n;
  }

  clearContents(): void {
    this.data = [];
  }

  /** Header + rows as objects, for assertions. */
  objects(): Record<string, Cell>[] {
    const [headers, ...rows] = this.data;
    return rows
      .filter((r) => r.some((v) => v !== '' && v !== undefined))
      .map((r) => Object.fromEntries((headers as string[]).map((h, i) => [h, r[i] ?? ''])));
  }
}

class FakeRange {
  constructor(
    private sheet: FakeSheet,
    private row: number,
    private col: number,
    private numRows: number,
    private numCols: number,
  ) {
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) {
      throw new Error(`Invalid range ${row},${col},${numRows},${numCols}`);
    }
  }

  bounds() {
    return { row: this.row, col: this.col, numRows: this.numRows, numCols: this.numCols };
  }

  getValues(): Cell[][] {
    const out: Cell[][] = [];
    for (let r = 0; r < this.numRows; r++) {
      const src = this.sheet.data[this.row - 1 + r] ?? [];
      const line: Cell[] = [];
      for (let c = 0; c < this.numCols; c++) line.push(src[this.col - 1 + c] ?? '');
      out.push(line);
    }
    return out;
  }

  setValues(values: Cell[][]): this {
    if (values.length !== this.numRows || values.some((v) => v.length !== this.numCols)) {
      throw new Error(
        `setValues dimensions ${values.length}x${values[0]?.length} do not match range ${this.numRows}x${this.numCols}`,
      );
    }
    values.forEach((line, r) => {
      const idx = this.row - 1 + r;
      while (this.sheet.data.length <= idx) this.sheet.data.push([]);
      const target = this.sheet.data[idx];
      line.forEach((v, c) => {
        const ci = this.col - 1 + c;
        while (target.length < ci) target.push('');
        // Apps Script rejects undefined in setValues.
        if (v === undefined) throw new Error('setValues received undefined');
        // Stored as-is: a Date made inside the VM must stay that realm's Date, or
        // the backend's `instanceof Date` checks fail when it is read back.
        target[ci] = v;
      });
    });
    return this;
  }

  setFontWeight(): this {
    return this;
  }
  setBackground(): this {
    return this;
  }
  setFontColor(): this {
    return this;
  }
  setNumberFormat(): this {
    return this;
  }
}

export class FakeSpreadsheet {
  sheets = new Map<string, FakeSheet>();

  getSheetByName(name: string): FakeSheet | null {
    return this.sheets.get(name) ?? null;
  }

  insertSheet(name: string): FakeSheet {
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }

  getSpreadsheetTimeZone(): string {
    return 'UTC';
  }

  sheet(name: string): FakeSheet {
    const s = this.sheets.get(name);
    if (!s) throw new Error(`No sheet ${name}`);
    return s;
  }
}

export interface Backend {
  ss: FakeSpreadsheet;
  /** POST a request body the way the simulator does and parse the response. */
  call: (action: string, payload: unknown, authToken?: string) => any;
  raw: (body: string) => any;
  get: () => any;
  fn: Record<string, (...args: any[]) => any>;
  cache: Map<string, string>;
}

const SOURCE_DIR = fileURLToPath(new URL('../../backend/apps-script', import.meta.url));

/** A fresh backend over an empty spreadsheet. */
export function loadBackend(): Backend {
  const ss = new FakeSpreadsheet();
  const cache = new Map<string, string>();

  const context = {
    console: { log() {}, warn() {}, error() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => cache.get(k) ?? null,
        put: (k: string, v: string) => void cache.set(k, v),
        remove: (k: string) => void cache.delete(k),
      }),
    },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_alg: string, text: string) =>
        Array.from(new Int8Array(createHash('sha256').update(text, 'utf8').digest())),
      formatDate: (date: Date, _tz: string, fmt: string) => {
        if (fmt !== 'yyyy-MM-dd') throw new Error(`fake formatDate does not support ${fmt}`);
        return date.toISOString().slice(0, 10);
      },
    },
    Charts: { ChartType: { COLUMN: 'COLUMN', BAR: 'BAR', LINE: 'LINE' } },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content: string) => ({
        content,
        setMimeType() {
          return this;
        },
      }),
    },
  };

  const files = readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();
  const exported = [
    'handleRequest_',
    'doGet',
    'doPost',
    'setupDatabase',
    'generateActivationKeys',
    'buildAnalytics_',
    'refreshAnalytics',
    'resetTableCache_',
    'repairUsers',
  ];
  const source =
    files.map((f) => readFileSync(path.join(SOURCE_DIR, f), 'utf8')).join('\n;\n') +
    `\n;({ ${exported.join(', ')} })`;

  vm.createContext(context);
  const fn = vm.runInContext(source, context, { filename: 'apps-script-bundle.js' });

  // JSON round trips, exactly as over HTTP: Dates become strings, undefined
  // fields vanish.
  const raw = (body: string) => JSON.parse(JSON.stringify(fn.handleRequest_(body)));
  const call = (action: string, payload: unknown, authToken?: string) =>
    raw(JSON.stringify({ apiVersion: 1, action, payload, authToken }));
  const get = () => JSON.parse(fn.doGet().content);

  return { ss, call, raw, get, fn, cache };
}
