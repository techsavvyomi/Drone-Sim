// Admin tools: create the database, seed the catalog, issue activation keys.
//
// Run from the "Drone Simulator" menu in the spreadsheet (a script bound to the
// sheet), or pick the function in the Apps Script editor and press Run.
// Everything here is safe to run again: it adds what is missing and leaves
// existing rows and edits alone.

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Drone Simulator')
    .addItem('Set up / repair database', 'setupDatabase')
    .addItem('Generate activation keys…', 'promptGenerateKeys')
    .addSeparator()
    .addItem('Refresh analytics reports', 'refreshAnalytics')
    .addItem('Refresh reports every hour', 'installAnalyticsTrigger')
    .addToUi();
}

function setupDatabase() {
  const ss = spreadsheet_();
  Object.keys(SCHEMA).forEach((name) => ensureSheet_(ss, name, SCHEMA[name]));
  resetTableCache_();
  seedSettings_();
  seedCatalog_();
  return 'Database ready';
}

/** Create the sheet if needed and append any schema columns it lacks. */
function ensureSheet_(ss, name, columns) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const width = sheet.getLastColumn();
  const existing =
    width > 0 ? sheet.getRange(1, 1, 1, width).getValues()[0].map((h) => String(h).trim()) : [];
  const missing = columns.filter((c) => existing.indexOf(c) < 0);
  if (missing.length > 0) {
    const start = existing.filter((h) => h !== '').length + 1;
    sheet.getRange(1, start, 1, missing.length).setValues([missing]);
  }
  const headers = existing.filter((h) => h !== '').concat(missing);
  const header = sheet.getRange(1, 1, 1, headers.length);
  header.setFontWeight('bold');
  header.setBackground('#1f2937');
  header.setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  // Date-time columns get a readable format for the whole column. Rows are
  // capped so a fresh sheet does not format a million empty cells.
  headers.forEach((h, i) => {
    if (DATETIME_COLUMNS.indexOf(h) >= 0) {
      sheet.getRange(2, i + 1, 5000, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    } else if (h === 'Date') {
      sheet.getRange(2, i + 1, 5000, 1).setNumberFormat('yyyy-mm-dd');
    } else if (h === 'Activation Key' || h === 'Token Hash' || h === 'Client Session Key') {
      sheet.getRange(2, i + 1, 5000, 1).setNumberFormat('@');
    }
  });
  return sheet;
}

function seedSettings_() {
  const settings = table_(SHEET.SETTINGS);
  const rows = DEFAULT_SETTINGS.filter(([key]) => !settings.find((r) => r.Key === key)).map(
    ([key, value, description]) => ({ Key: key, Value: value, Description: description }),
  );
  settings.append(rows);
}

function seedCatalog_() {
  upsertCatalog_(SHEET.DRONES, 'Drone ID', CATALOG.drones, (d) => ({
    'Drone ID': d.id,
    'Drone Name': d.name,
    Model: d.model,
    'Sim Key': d.simKey,
    Status: 'ACTIVE',
  }));
  upsertCatalog_(SHEET.MISSIONS, 'Mission ID', CATALOG.missions, (m) => ({
    'Mission ID': m.id,
    'Mission Name': m.name,
    'Sim Key': m.simKey,
    'Max Score': m.maxScore,
    Order: m.order,
    Status: 'ACTIVE',
  }));
  upsertCatalog_(SHEET.TRAINING, 'Training ID', CATALOG.training, (t) => ({
    'Training ID': t.id,
    'Training Name': t.name,
    'Sim Key': t.simKey,
    Order: t.order,
    Status: 'ACTIVE',
  }));
}

/** Add catalog rows that are missing. Rows already there are left as edited. */
function upsertCatalog_(sheetName, idColumn, items, toRow) {
  const table = table_(sheetName);
  const fresh = items.filter((item) => !table.find((r) => r[idColumn] === item.id)).map(toRow);
  table.append(fresh);
}

// ---------------------------------------------------------------------------
// Activation keys
// ---------------------------------------------------------------------------

/** No 0/O, 1/I/L: keys get read aloud and typed from paper. */
const KEY_ALPHABET_ = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Four unbiased random characters from the key alphabet. */
function randomKeyBlock_() {
  let out = '';
  while (out.length < 4) {
    // A v4 UUID carries 122 bits from a secure source; Math.random does not.
    const hex = Utilities.getUuid().replace(/-/g, '');
    for (let i = 0; i + 2 <= hex.length && out.length < 4; i += 2) {
      const byte = parseInt(hex.substr(i, 2), 16);
      // Rejection sampling keeps every character equally likely.
      if (byte < 248) out += KEY_ALPHABET_.charAt(byte % KEY_ALPHABET_.length);
    }
  }
  return out;
}

function newActivationKey_() {
  return 'PLUTO-SIM-' + randomKeyBlock_() + '-' + randomKeyBlock_();
}

/**
 * Append `count` new AVAILABLE keys and return them. `notes` is stored beside
 * each (for example the school or batch the keys are for).
 */
function generateActivationKeys(count, notes) {
  const n = Math.max(1, Math.min(500, Math.floor(Number(count) || 10)));
  return withLock_(() => {
    const table = table_(SHEET.KEYS);
    const taken = {};
    table.rows().forEach((r) => (taken[String(r['Activation Key']).toUpperCase()] = true));
    const now = new Date();
    const keys = [];
    while (keys.length < n) {
      const key = newActivationKey_();
      if (taken[key]) continue;
      taken[key] = true;
      keys.push(key);
    }
    table.append(
      keys.map((key) => ({
        'Activation Key': key,
        Status: 'AVAILABLE',
        'Created Date': now,
        Notes: notes ? String(notes) : '',
      })),
    );
    return keys;
  });
}

/** For the editor's Run button, which cannot pass arguments. */
function generateTenActivationKeys() {
  const keys = generateActivationKeys(10, '');
  console.log(keys.join('\n'));
  return keys;
}

function promptGenerateKeys() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Generate activation keys', 'How many keys? (1-500)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const note = ui.prompt('Notes (optional)', 'Batch or recipient, stored beside each key', ui.ButtonSet.OK);
  const keys = generateActivationKeys(res.getResponseText(), note.getResponseText());
  ui.alert(keys.length + ' keys added to the ActivationKeys sheet.');
}

// ---------------------------------------------------------------------------
// Repairing hand-entered users
// ---------------------------------------------------------------------------

const USER_NUMBER_COLUMNS_ = [
  'Total Points',
  'Total Flights',
  'Total Flight Time',
  'Training Flights',
  'Mission Flights',
  'Free Flights',
  'Missions Completed',
  'Training Completed',
  'Free Flight Time',
  'Crash Count',
  'Scored Sessions',
  'Score Percent Sum',
];

/**
 * Make users typed straight into the Users sheet work like activated ones.
 *
 * Activation fills in a dozen columns, links the key in ActivationKeys and
 * advances the ID counter. A row added by hand has none of that, so its owner
 * cannot sign in and the next real activation reuses its ID. For every user row
 * this:
 *   - gives it a User ID if it has none, and lower-cases the email;
 *   - fills blank totals with 0, a blank Status with ACTIVE, blank dates with now;
 *   - marks its key ACTIVATED and linked to it (adding the key row if missing);
 *   - moves SEQ_USER past the highest USR- number in use.
 * A key already linked to a different email is reported and left alone. Safe to
 * run any number of times; rows that are already fine are not rewritten.
 */
function repairUsers() {
  return withLock_(() => {
    const now = new Date();
    const users = table_(SHEET.USERS);
    const keys = table_(SHEET.KEYS);
    const report = [];

    let highest = 0;
    users.rows().forEach((u) => {
      const m = /^USR-(\d+)$/.exec(String(u['User ID']).trim());
      if (m) highest = Math.max(highest, Number(m[1]));
    });
    const settings = table_(SHEET.SETTINGS);
    const counter = settings.find((r) => r.Key === 'SEQ_USER');
    if (counter && Number(counter.Value) < highest) {
      settings.update(counter, { Value: highest });
      report.push('SEQ_USER moved to ' + highest);
    }

    const seenEmails = {};
    users.rows().forEach((u) => {
      const patch = {};
      const label = String(u.Email || u['User ID'] || 'row ' + u._row);

      if (!String(u['User ID']).trim()) patch['User ID'] = nextIds_('SEQ_USER', 'USR-', 6, 1)[0];
      const userId = patch['User ID'] || String(u['User ID']).trim();
      if (userId !== u['User ID'] && !patch['User ID']) patch['User ID'] = userId;

      const email = String(u.Email || '').trim().toLowerCase();
      if (email !== u.Email) patch.Email = email;
      if (!EMAIL_RE_.test(email)) {
        report.push(label + ': email is missing or invalid, skipped');
        return;
      }
      if (seenEmails[email]) {
        report.push(label + ': same email as ' + seenEmails[email] + ', skipped');
        return;
      }
      seenEmails[email] = userId;

      USER_NUMBER_COLUMNS_.forEach((c) => {
        if (u[c] === '' || u[c] === null || isNaN(Number(u[c]))) patch[c] = 0;
      });
      if (!(u['Registration Date'] instanceof Date)) patch['Registration Date'] = now;
      if (!(u['Last Active'] instanceof Date)) patch['Last Active'] = patch['Registration Date'] || u['Registration Date'];
      if (!u.Status) patch.Status = 'ACTIVE';
      const points = patch['Total Points'] !== undefined ? 0 : num_(u['Total Points']);
      const level = levelFor_(points).level;
      if (num_(u['Current Level']) !== level) patch['Current Level'] = level;

      const key = String(u['Activation Key'] || '').trim().toUpperCase();
      if (key !== u['Activation Key']) patch['Activation Key'] = key;
      if (!KEY_RE_.test(key)) {
        report.push(label + ': activation key is missing or not PLUTO-SIM-XXXX-XXXX; user cannot sign in');
      } else {
        const keyRow = keys.find((r) => String(r['Activation Key']).trim().toUpperCase() === key);
        const linked = {
          'Activation Key': key,
          Status: 'ACTIVATED',
          'Assigned Email': email,
          'User ID': userId,
        };
        if (!keyRow) {
          keys.append(Object.assign({}, linked, { 'Created Date': now, 'Activated Date': now, Notes: 'added by repairUsers' }));
          report.push(label + ': added key ' + key);
        } else {
          const assigned = String(keyRow['Assigned Email'] || '').trim().toLowerCase();
          if (assigned && assigned !== email) {
            report.push(label + ': key ' + key + ' already belongs to ' + assigned + ', left alone');
          } else if (keyRow.Status === 'DISABLED') {
            report.push(label + ': key ' + key + ' is DISABLED, left alone');
          } else if (keyRow.Status !== 'ACTIVATED' || keyRow['User ID'] !== userId || keyRow['Assigned Email'] !== email) {
            keys.update(keyRow, Object.assign({}, linked, { 'Activated Date': keyRow['Activated Date'] || now }));
            report.push(label + ': linked key ' + key);
          }
        }
      }

      if (Object.keys(patch).length > 0) {
        users.update(u, patch);
        report.push(label + ': filled ' + Object.keys(patch).join(', '));
      }
    });

    if (report.length === 0) report.push('Nothing to repair');
    console.log(report.join('\n'));
    return report;
  });
}
