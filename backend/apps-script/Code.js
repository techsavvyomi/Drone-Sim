// Web app entry point: routes JSON requests to the handlers in Api.js.
//
// The simulator POSTs `{ apiVersion, action, payload, authToken? }` with a
// text/plain body and reads back `{ success: true, data }` or
// `{ success: false, code, message }`. Apps Script always answers HTTP 200, so
// the envelope, not the status code, carries the outcome.

const PUBLIC_ACTIONS_ = {
  activateUser: activateUser_,
  loginUser: loginUser_,
};

const AUTHENTICATED_ACTIONS_ = {
  getUserProfile: getUserProfile_,
  getUserDashboard: getUserDashboard_,
  startSession: startSession_,
  endSession: endSession_,
  recordEvent: recordEvent_,
  recordEvents: recordEvents_,
};

function doPost(e) {
  return json_(handleRequest_(e && e.postData ? e.postData.contents : ''));
}

/** A health check, so a deployment URL can be tested from a browser. */
function doGet() {
  return json_({
    success: true,
    data: { service: 'drone-simulator-api', apiVersion: API_VERSION },
  });
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/** Parse, route and run one request. Returns the response envelope. */
function handleRequest_(rawBody) {
  resetTableCache_();
  let body;
  try {
    body = JSON.parse(rawBody || '');
  } catch (err) {
    return { success: false, code: 'VALIDATION', message: 'Request body is not valid JSON' };
  }
  if (!body || typeof body !== 'object') {
    return { success: false, code: 'VALIDATION', message: 'Request body must be an object' };
  }

  const action = body.action;
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};

  try {
    if (Object.prototype.hasOwnProperty.call(PUBLIC_ACTIONS_, action)) {
      return { success: true, data: PUBLIC_ACTIONS_[action](payload) };
    }
    if (Object.prototype.hasOwnProperty.call(AUTHENTICATED_ACTIONS_, action)) {
      const auth = authenticate_(body.authToken);
      touchToken_(auth.token);
      return { success: true, data: AUTHENTICATED_ACTIONS_[action](payload, auth) };
    }
    return { success: false, code: 'UNKNOWN_ACTION', message: 'Unknown action: ' + action };
  } catch (err) {
    if (err instanceof ApiError_) return { success: false, code: err.code, message: err.message };
    console.error('Unhandled error in ' + action + ': ' + (err && err.stack ? err.stack : err));
    return { success: false, code: 'SERVER_ERROR', message: 'Something went wrong on the server' };
  }
}

/** Record when a device was last seen, at most hourly to spare writes. */
function touchToken_(token) {
  const last = token['Last Used'] instanceof Date ? token['Last Used'].getTime() : 0;
  const now = new Date();
  if (now.getTime() - last < 60 * 60 * 1000) return;
  try {
    table_(SHEET.TOKENS).update(token, { 'Last Used': now });
  } catch (err) {
    // Bookkeeping only; never fail a request over it.
    console.warn('Could not update token Last Used: ' + err);
  }
}
