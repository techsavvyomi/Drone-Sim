// A thin table layer over Google Sheets.
//
// Everything that touches a sheet goes through here. Rows come back as plain
// objects keyed by header name, with dates as Date objects, and go in the same
// way. Swapping Sheets for Firebase replaces this file and the ID counter; the
// handlers in Api.js only ever see objects.

/**
 * The prototype's DroneSimulatorDB. A `SPREADSHEET_ID` Script Property
 * overrides it (for a test copy); with neither, a script bound to a sheet uses
 * that sheet.
 */
const DEFAULT_SPREADSHEET_ID = '19q9iUHRDD6MPORsL98WOGi6GtxQ4-b4m1l9THFUg-S0';

let spreadsheetCache_ = null;

function spreadsheet_() {
  if (spreadsheetCache_) return spreadsheetCache_;
  const id =
    PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || DEFAULT_SPREADSHEET_ID;
  spreadsheetCache_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheetCache_) throw new Error('No spreadsheet: set SPREADSHEET_ID or bind the script');
  return spreadsheetCache_;
}

function timeZone_() {
  return spreadsheet_().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
}

/**
 * Anything a user typed that starts with = + - or @ would be evaluated by Sheets
 * as a formula (and could, for example, IMPORTXML data out of the sheet).
 * Prefixing an apostrophe stores it as literal text.
 */
function cellSafe_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

/** Per-request cache, so one request reads each sheet at most once. */
let tableCache_ = {};

function resetTableCache_() {
  tableCache_ = {};
}

function table_(name) {
  if (!tableCache_[name]) tableCache_[name] = new Table_(name);
  return tableCache_[name];
}

function Table_(name) {
  let sheet = spreadsheet_().getSheetByName(name);
  // A table added in a later version is created on first use, like a column.
  if (!sheet && SCHEMA[name]) sheet = ensureSheet_(spreadsheet_(), name, SCHEMA[name]);
  if (!sheet) throw new Error('Missing sheet "' + name + '". Run setupDatabase.');
  this.name = name;
  this.sheet = sheet;
  const width = Math.max(sheet.getLastColumn(), 1);
  this.headers = sheet
    .getRange(1, 1, 1, width)
    .getValues()[0]
    .map((h) => String(h).trim());
  // A column added to the schema in a later version is added to the sheet the
  // first time it is needed, so deploying new code never breaks a live sheet
  // that `setupDatabase` has not been re-run on.
  const missing = (SCHEMA[name] || []).filter((col) => this.headers.indexOf(col) < 0);
  if (missing.length > 0) {
    const used = this.headers.filter((h) => h !== '').length;
    sheet.getRange(1, used + 1, 1, missing.length).setValues([missing]);
    this.headers = this.headers.slice(0, used).concat(missing);
  }
  this.rowsCache = null;
}

/** All data rows as objects. `_row` is the 1-based sheet row. */
Table_.prototype.rows = function () {
  if (this.rowsCache) return this.rowsCache;
  const last = this.sheet.getLastRow();
  const out = [];
  if (last >= 2) {
    const values = this.sheet.getRange(2, 1, last - 1, this.headers.length).getValues();
    for (let i = 0; i < values.length; i++) {
      const obj = { _row: i + 2 };
      let blank = true;
      for (let c = 0; c < this.headers.length; c++) {
        const v = values[i][c];
        if (v !== '' && v !== null) blank = false;
        if (this.headers[c]) obj[this.headers[c]] = v;
      }
      if (!blank) out.push(obj);
    }
  }
  this.rowsCache = out;
  return out;
};

Table_.prototype.find = function (predicate) {
  const rows = this.rows();
  for (let i = 0; i < rows.length; i++) if (predicate(rows[i])) return rows[i];
  return null;
};

Table_.prototype.filter = function (predicate) {
  return this.rows().filter(predicate);
};

Table_.prototype.toValues_ = function (obj) {
  return this.headers.map((h) => (h && obj[h] !== undefined ? cellSafe_(obj[h]) : ''));
};

/** Append one or more row objects in a single write. */
Table_.prototype.append = function (objs) {
  const list = Array.isArray(objs) ? objs : [objs];
  if (list.length === 0) return;
  const values = list.map((o) => this.toValues_(o));
  const start = this.sheet.getLastRow() + 1;
  this.sheet.getRange(start, 1, values.length, this.headers.length).setValues(values);
  if (this.rowsCache) {
    list.forEach((o, i) => {
      const copy = Object.assign({}, o, { _row: start + i });
      this.rowsCache.push(copy);
    });
  }
};

/** Write the given fields of an existing row object back to its sheet row. */
Table_.prototype.update = function (row, patch) {
  Object.assign(row, patch);
  const values = [this.headers.map((h) => (h && row[h] !== undefined ? cellSafe_(row[h]) : ''))];
  this.sheet.getRange(row._row, 1, 1, this.headers.length).setValues(values);
};

// ---------------------------------------------------------------------------
// Settings & ID counters
// ---------------------------------------------------------------------------

function setting_(key, fallback) {
  const row = table_(SHEET.SETTINGS).find((r) => r.Key === key);
  if (!row || row.Value === '' || row.Value === null) return fallback;
  const n = Number(row.Value);
  return isNaN(n) ? row.Value : n;
}

/**
 * Reserve `count` sequential ids like USR-000001. Must be called under the
 * script lock (see withLock_), which every writing handler holds.
 */
function nextIds_(counterKey, prefix, width, count) {
  const settings = table_(SHEET.SETTINGS);
  let row = settings.find((r) => r.Key === counterKey);
  if (!row) {
    settings.append({ Key: counterKey, Value: 0, Description: 'ID counter' });
    row = settings.find((r) => r.Key === counterKey);
  }
  const last = Number(row.Value) || 0;
  settings.update(row, { Value: last + count });
  const ids = [];
  for (let i = 1; i <= count; i++) {
    ids.push(prefix + String(last + i).padStart(width, '0'));
  }
  return ids;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // Rows read before the lock may be stale; re-read inside it.
    resetTableCache_();
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function iso_(value) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : '';
}

function num_(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

function dayKey_(date) {
  return Utilities.formatDate(date, timeZone_(), 'yyyy-MM-dd');
}
