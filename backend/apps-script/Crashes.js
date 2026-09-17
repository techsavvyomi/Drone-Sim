// Crash reports from the simulator.
//
// Accepted signed in or not: a crash on the activation screen is as worth
// knowing about as one mid-mission. When the report carries a valid token the
// row is attributed to that pilot; an expired or missing one just leaves the
// user columns blank rather than losing the report.
//
// Reports are grouped by a fingerprint computed here, not by the client: the
// kind, the message with its numbers and quoted values blanked, and the top
// stack frame without line numbers. "Cannot read properties of undefined
// (reading 'x')" at the same place is one issue however many times it fires.

const CRASH_KINDS_ = [
  'MAIN_EXCEPTION',
  'MAIN_REJECTION',
  'RENDERER_EXCEPTION',
  'RENDERER_REJECTION',
  'RENDER_ERROR',
  'RENDERER_GONE',
  'CHILD_PROCESS_GONE',
  'WEBGL_CONTEXT_LOST',
  'NATIVE_CRASH',
];

function crashFingerprint_(kind, message, stack) {
  const normalisedMessage = String(message)
    .split('\n')[0]
    .replace(/(['"`]).*?\1/g, '$1…$1')
    .replace(/\b\d+(\.\d+)?\b/g, 'N')
    .slice(0, 200);
  const frames = String(stack || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^at\s/.test(l) || /@/.test(l));
  const topFrame = (frames[0] || '').replace(/:\d+(:\d+)?\)?$/, '').replace(/\?[^)\s]*/g, '');
  return sha256_(kind + '|' + normalisedMessage + '|' + topFrame).slice(0, 12);
}

function reportCrashes_(payload, auth) {
  const reports = payload.reports;
  if (!Array.isArray(reports) || reports.length === 0) fail_('VALIDATION', 'reports must be a non-empty array');
  if (reports.length > 20) fail_('VALIDATION', 'at most 20 reports per request');

  const now = new Date();
  const rows = reports.map((r, i) => {
    if (!r || typeof r !== 'object') fail_('VALIDATION', 'reports[' + i + '] must be an object');
    const kind = oneOf_(r, 'kind', CRASH_KINDS_);
    const message = str_(r, 'message', { max: 1000 });
    const stack = typeof r.stack === 'string' ? r.stack.slice(0, 8000) : '';
    let context = '';
    if (r.context !== undefined && r.context !== null) {
      if (typeof r.context !== 'object') fail_('VALIDATION', 'reports[' + i + '].context must be an object');
      context = JSON.stringify(r.context).slice(0, 4000);
    }
    let occurred = now;
    const at = new Date(r.occurredAt);
    // A report from a crash can arrive days late, and a broken clock is common
    // on exactly the machines that crash; keep the time but never reject over it.
    if (!isNaN(at.getTime()) && at.getTime() <= now.getTime() + CLOCK_SKEW_MS_) occurred = at;
    return {
      'Occurred At': occurred,
      'Received At': now,
      Kind: kind,
      Fatal: r.fatal === true,
      Message: message,
      Fingerprint: crashFingerprint_(kind, message, stack),
      'User ID': auth ? auth.user['User ID'] : '',
      Email: auth ? auth.user.Email : '',
      'Device ID': str_(r, 'deviceId', { optional: true, max: 128 }),
      'Device Name': str_(r, 'deviceName', { optional: true, max: 80 }),
      'App Version': str_(r, 'appVersion', { optional: true, max: 40 }),
      Platform: str_(r, 'platform', { optional: true, max: 40 }),
      'OS Version': str_(r, 'osVersion', { optional: true, max: 80 }),
      'Electron Version': str_(r, 'electronVersion', { optional: true, max: 40 }),
      Context: context,
      Stack: stack,
    };
  });

  // A crash loop must not be able to fill the sheet. Per device (or per caller
  // when there is none), per hour; the excess is acknowledged and dropped so the
  // client does not keep retrying it.
  const cache = CacheService.getScriptCache();
  const limit = setting_('MAX_CRASH_REPORTS_PER_HOUR', 60);
  const bucket = 'crash:' + (rows[0]['Device ID'] || rows[0]['User ID'] || 'anonymous');
  const used = Number(cache.get(bucket) || 0);
  const accepted = rows.slice(0, Math.max(0, limit - used));
  cache.put(bucket, String(used + rows.length), 60 * 60);
  if (accepted.length === 0) return { reportIds: [], dropped: rows.length };

  return withLock_(() => {
    const ids = nextIds_('SEQ_CRASH', 'CRS-', 6, accepted.length);
    table_(SHEET.CRASHES).append(accepted.map((row, i) => Object.assign({ 'Report ID': ids[i] }, row)));
    return { reportIds: ids, dropped: rows.length - accepted.length };
  });
}
