// Admin analytics: computed report sheets over the raw tables.
//
// The raw sheets (FlightSessions, GameplayEvents, Users) are the record, and
// pivot tables or ad-hoc formulas over them are always an option. These reports
// answer the standing questions without anyone having to build one: they are
// recomputed from scratch by `refreshAnalytics`, from the menu or hourly once
// `installAnalyticsTrigger` has been run. Report sheets are overwritten on each
// refresh, so do not edit them by hand.
//
// A section may list `charts`, drawn beside the tables on refresh: one series
// per chart, so each reads without a legend.

const REPORT = {
  OVERVIEW: 'Report: Overview',
  USERS: 'Report: Users',
  MISSIONS: 'Report: Missions',
  TRAINING: 'Report: Training',
  DRONES: 'Report: Drones',
};

function refreshAnalytics() {
  resetTableCache_();
  const reports = buildAnalytics_(new Date());
  const ss = spreadsheet_();
  Object.keys(reports).forEach((name) => writeReport_(ss, name, reports[name]));
  return 'Reports refreshed';
}

function installAnalyticsTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'refreshAnalytics')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('refreshAnalytics').timeBased().everyHours(1).create();
  return 'Hourly refresh installed';
}

// ---------------------------------------------------------------------------
// Computation (no sheet writes; unit-tested)
// ---------------------------------------------------------------------------

function round1_(n) {
  return Math.round(n * 10) / 10;
}

function hours_(sec) {
  return round1_(sec / 3600);
}

function mean_(values) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function pct_(part, whole) {
  return whole > 0 ? round1_((part / whole) * 100) : 0;
}

function mode_(values) {
  const counts = {};
  let best = '';
  let bestCount = 0;
  values.forEach((v) => {
    if (!v) return;
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > bestCount) {
      best = v;
      bestCount = counts[v];
    }
  });
  return best ? best + ' (' + bestCount + ')' : '';
}

function distinct_(values) {
  const seen = {};
  values.forEach((v) => (seen[v] = true));
  return Object.keys(seen).length;
}

/**
 * Every report as { name: sections[] }, where a section is
 * { title, headers, rows }.
 */
function buildAnalytics_(now) {
  const users = table_(SHEET.USERS).rows();
  const keys = table_(SHEET.KEYS).rows();
  const all = table_(SHEET.SESSIONS).rows();
  const finished = all.filter((r) => r.Success !== 'IN_PROGRESS');
  const startMs = (r) => timeOf_(r['Start Time']);

  const dayMs = 86400000;
  const todayKey = dayKey_(now);
  const within = (ms) => finished.filter((r) => now.getTime() - startMs(r) <= ms);
  const pilotsIn = (rows) => distinct_(rows.map((r) => r['User ID']));
  const byType = (type) => finished.filter((r) => r['Flight Type'] === type);

  const overview = [
    {
      title: 'Users',
      headers: ['Metric', 'Value'],
      rows: [
        ['Registered users', users.length],
        ['Active accounts', users.filter((u) => u.Status === 'ACTIVE').length],
        ['Pilots who flew today', pilotsIn(finished.filter((r) => dayKey_(new Date(startMs(r))) === todayKey))],
        ['Pilots who flew in the last 7 days', pilotsIn(within(7 * dayMs))],
        ['Pilots who flew in the last 30 days', pilotsIn(within(30 * dayMs))],
        ['Activation keys available', keys.filter((k) => k.Status === 'AVAILABLE').length],
        ['Activation keys activated', keys.filter((k) => k.Status === 'ACTIVATED').length],
        ['Activation keys disabled', keys.filter((k) => k.Status === 'DISABLED').length],
      ],
    },
    {
      title: 'Activity',
      headers: ['Metric', 'Value'],
      rows: [
        ['Sessions (finished)', finished.length],
        ['Sessions still open', all.length - finished.length],
        ['Sessions today', finished.filter((r) => dayKey_(new Date(startMs(r))) === todayKey).length],
        ['Sessions in the last 7 days', within(7 * dayMs).length],
        ['Sessions in the last 30 days', within(30 * dayMs).length],
        ['Total flight time (hours)', hours_(finished.reduce((s, r) => s + num_(r['Flight Time']), 0))],
        ['Total session time (hours)', hours_(finished.reduce((s, r) => s + num_(r.Duration), 0))],
        ['Total points awarded', finished.reduce((s, r) => s + num_(r['Points Earned']), 0)],
        ['Training sessions', byType('TRAINING').length],
        ['Mission sessions', byType('MISSION').length],
        ['Free-flight sessions', byType('FREE_FLIGHT').length],
      ],
    },
    {
      title: 'Daily activity, last 30 days',
      headers: ['Date', 'Sessions', 'Active pilots', 'Flight hours', 'Points'],
      rows: dailyRows_(finished, now, 30),
      charts: [
        { type: 'COLUMN', title: 'Sessions per day', columns: [0, 1] },
        { type: 'COLUMN', title: 'Flight hours per day', columns: [0, 3] },
      ],
    },
    {
      title: 'Last refreshed',
      headers: ['Time'],
      rows: [[now]],
    },
  ];

  const userRows = users.slice().sort((a, b) => num_(b['Total Points']) - num_(a['Total Points'])).map((u) => {
    const mine = finished.filter((r) => r['User ID'] === u['User ID']);
    const scored = mine.filter((r) => r['Score Percent'] !== '' && r.Success !== 'ABORTED');
    return [
      u['User ID'],
      u.Name,
      u.Email,
      num_(u['Total Points']),
      num_(u['Current Level']),
      mine.length,
      hours_(mine.reduce((s, r) => s + num_(r['Flight Time']), 0)),
      mine.filter((r) => r['Flight Type'] === 'MISSION' && r.Success === 'SUCCESS').length,
      mine.filter((r) => r['Flight Type'] === 'TRAINING' && r.Success === 'SUCCESS').length,
      hours_(
        mine.filter((r) => r['Flight Type'] === 'FREE_FLIGHT').reduce((s, r) => s + num_(r['Flight Time']), 0),
      ),
      round1_(mean_(scored.map((r) => num_(r['Score Percent'])))),
      mine.reduce((s, r) => s + num_(r['Crash Count']), 0),
      u['Last Active'],
      u.Status,
    ];
  });

  const catalogReport = (catalogRows, idColumn, nameColumn, type) =>
    catalogRows
      .slice()
      .sort((a, b) => num_(a.Order) - num_(b.Order))
      .map((c) => {
        const rows = finished.filter((r) => r['Flight Type'] === type && r[idColumn] === c[idColumn]);
        const done = rows.filter((r) => r.Success === 'SUCCESS');
        const failed = rows.filter((r) => r.Success === 'FAILED');
        const attempts = rows.reduce((s, r) => s + num_(r.Attempts), 0);
        const base = [
          c[idColumn],
          c[nameColumn],
          rows.length,
          pilotsIn(rows),
          attempts,
          round1_(rows.length ? attempts / rows.length : 0),
          done.length,
          pct_(done.length, rows.length),
          round1_(mean_(done.map((r) => num_(r['Score Percent'])))),
          round1_(mean_(rows.map((r) => num_(r.Duration))) / 60),
          rows.reduce((s, r) => s + num_(r['Crash Count']), 0),
        ];
        return type === 'MISSION'
          ? base.concat([failed.length, mode_(failed.map((r) => String(r['Fail Reason'] || '')))])
          : base;
      });

  const catalogHeaders = [
    'Sessions',
    'Pilots',
    'Attempts',
    'Avg attempts / session',
    'Completions',
    'Completion rate %',
    'Avg score % (completed)',
    'Avg duration (min)',
    'Crashes',
  ];

  const droneRows = table_(SHEET.DRONES)
    .rows()
    .map((d) => {
      const rows = finished.filter((r) => r['Drone ID'] === d['Drone ID']);
      const crashes = rows.reduce((s, r) => s + num_(r['Crash Count']), 0);
      const flightSec = rows.reduce((s, r) => s + num_(r['Flight Time']), 0);
      const scored = rows.filter((r) => r['Score Percent'] !== '' && r.Success !== 'ABORTED');
      return [
        d['Drone ID'],
        d['Drone Name'],
        rows.length,
        pilotsIn(rows),
        hours_(flightSec),
        rows.filter((r) => r['Flight Type'] === 'MISSION' && r.Success === 'SUCCESS').length,
        round1_(mean_(scored.map((r) => num_(r['Score Percent'])))),
        crashes,
        pct_(rows.filter((r) => num_(r['Crash Count']) > 0).length, rows.length),
        flightSec > 0 ? round1_(crashes / (flightSec / 3600)) : 0,
      ];
    })
    .sort((a, b) => b[2] - a[2]);

  const reports = {};
  reports[REPORT.OVERVIEW] = overview;
  reports[REPORT.USERS] = [
    {
      title: 'Per user',
      headers: [
        'User ID',
        'Name',
        'Email',
        'Total points',
        'Level',
        'Sessions',
        'Flight time (h)',
        'Missions completed',
        'Training completed',
        'Free-flight time (h)',
        'Avg score %',
        'Crashes',
        'Last active',
        'Status',
      ],
      rows: userRows,
      charts: [{ type: 'BAR', title: 'Top pilots by points', columns: [1, 3], maxRows: 10 }],
    },
  ];
  reports[REPORT.MISSIONS] = [
    {
      title: 'Per mission',
      headers: ['Mission ID', 'Mission'].concat(catalogHeaders, ['Failures', 'Most common failure']),
      rows: catalogReport(table_(SHEET.MISSIONS).rows(), 'Mission ID', 'Mission Name', 'MISSION'),
      charts: [{ type: 'BAR', title: 'Mission completion rate %', columns: [1, 7] }],
    },
  ];
  reports[REPORT.TRAINING] = [
    {
      title: 'Per training module',
      headers: ['Training ID', 'Module'].concat(catalogHeaders),
      rows: catalogReport(table_(SHEET.TRAINING).rows(), 'Training ID', 'Training Name', 'TRAINING'),
      charts: [{ type: 'BAR', title: 'Training sessions by module', columns: [1, 2] }],
    },
  ];
  reports[REPORT.DRONES] = [
    {
      title: 'Per drone',
      headers: [
        'Drone ID',
        'Drone',
        'Sessions',
        'Pilots',
        'Flight time (h)',
        'Missions completed',
        'Avg score %',
        'Crashes',
        'Sessions with a crash %',
        'Crashes per flight hour',
      ],
      rows: droneRows,
      charts: [{ type: 'BAR', title: 'Flight hours by drone', columns: [1, 4] }],
    },
  ];
  return reports;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** One row per day, oldest first: date, sessions, pilots, flight hours, points. */
function dailyRows_(finished, now, days) {
  const byDay = {};
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey_(new Date(now.getTime() - i * 86400000));
    byDay[key] = { sessions: 0, pilots: {}, flightSec: 0, points: 0 };
    rows.push(key);
  }
  finished.forEach((r) => {
    const day = byDay[dayKey_(new Date(timeOf_(r['Start Time'])))];
    if (!day) return;
    day.sessions += 1;
    day.pilots[r['User ID']] = true;
    day.flightSec += num_(r['Flight Time']);
    day.points += num_(r['Points Earned']);
  });
  return rows.map((key) => {
    const d = byDay[key];
    return [key, d.sessions, Object.keys(d.pilots).length, hours_(d.flightSec), d.points];
  });
}

const CHART_COLOR_ = '#1d7fb8';

function writeReport_(ss, name, sections) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.clearContents();
  sheet.getCharts().forEach((c) => sheet.removeChart(c));
  const widest = sections.reduce((w, s) => Math.max(w, s.headers.length), 1);
  let row = 1;
  let chartRow = 1;
  sections.forEach((section) => {
    sheet.getRange(row, 1, 1, 1).setValues([[section.title]]).setFontWeight('bold');
    row += 1;
    const width = section.headers.length;
    const headerRow = row;
    sheet.getRange(row, 1, 1, width).setValues([section.headers]).setFontWeight('bold');
    row += 1;
    if (section.rows.length > 0) {
      sheet.getRange(row, 1, section.rows.length, width).setValues(section.rows);
      row += section.rows.length;
    }

    (section.charts || []).forEach((chart) => {
      if (section.rows.length === 0) return;
      const count = Math.min(section.rows.length, chart.maxRows || section.rows.length) + 1;
      let builder = sheet
        .newChart()
        .setChartType(Charts.ChartType[chart.type])
        .setNumHeaders(1)
        .setOption('title', chart.title)
        .setOption('legend', { position: 'none' })
        .setOption('colors', [CHART_COLOR_])
        .setOption('width', 620)
        .setOption('height', 300);
      chart.columns.forEach((c) => {
        builder = builder.addRange(sheet.getRange(headerRow, c + 1, count, 1));
      });
      // Charts stack down a column to the right of the widest table.
      sheet.insertChart(builder.setPosition(chartRow, widest + 2, 0, 0).build());
      chartRow += 16;
    });
    row += 1;
  });
}
