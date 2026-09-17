// Drone Simulator DB: sheet definitions.
//
// Every sheet is a table whose first row is its header. Code addresses columns
// by header NAME (see Db.js), never by letter, so an admin can add columns or
// reorder them without breaking the API. Renaming or deleting a column listed
// here does break it; run `setupDatabase` to restore any that went missing.
//
// Each table maps to one Firebase collection later (see backend/README.md), and
// the ID column is that collection's document id.

const API_VERSION = 1;

const SHEET = {
  USERS: 'Users',
  KEYS: 'ActivationKeys',
  TOKENS: 'AuthTokens',
  SESSIONS: 'FlightSessions',
  EVENTS: 'GameplayEvents',
  DRONES: 'Drones',
  MISSIONS: 'Missions',
  TRAINING: 'TrainingModules',
  SETTINGS: 'Settings',
  CRASHES: 'CrashReports',
};

const SCHEMA = {
  [SHEET.USERS]: [
    'User ID',
    'Name',
    'Email',
    'Activation Key',
    'Registration Date',
    'Last Active',
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
    'Current Level',
    'Status',
    // The one computer this profile may sign in on. Clear both to let the pilot
    // move to a new computer: the next one to sign in is bound.
    'Device ID',
    'Device Name',
    'Device Bound At',
  ],
  [SHEET.KEYS]: [
    'Activation Key',
    'Status',
    'Assigned Email',
    'User ID',
    'Created Date',
    'Activated Date',
    'Notes',
  ],
  // One row per signed-in device. Only a SHA-256 of the token is stored, so the
  // sheet cannot be used to impersonate anyone. Set Status to REVOKED to sign a
  // device out.
  [SHEET.TOKENS]: ['Token Hash', 'User ID', 'Device ID', 'Created Date', 'Last Used', 'Status'],
  [SHEET.SESSIONS]: [
    'Session ID',
    'User ID',
    'Email',
    'Date',
    'Start Time',
    'End Time',
    'Duration',
    'Flight Time',
    'Flight Type',
    'Mission ID',
    'Mission Name',
    'Training ID',
    'Training Name',
    'Drone ID',
    'Drone Name',
    'Points Earned',
    'Score',
    'Max Score',
    'Score Percent',
    'Stars',
    'Success',
    'Attempts',
    'Crash Count',
    'Collision Count',
    'Distance',
    'Max Altitude',
    'Battery Used',
    'Controls/Input Mode',
    'Objectives Completed',
    'Objectives Total',
    'Fail Reason',
    'App Version',
    'Client Session Key',
    'Timestamp',
  ],
  [SHEET.EVENTS]: [
    'Event ID',
    'Session ID',
    'User ID',
    'Event Type',
    'Event Data',
    'Timestamp',
    'Received At',
  ],
  [SHEET.DRONES]: ['Drone ID', 'Drone Name', 'Model', 'Sim Key', 'Status'],
  [SHEET.MISSIONS]: ['Mission ID', 'Mission Name', 'Sim Key', 'Max Score', 'Order', 'Status'],
  [SHEET.TRAINING]: ['Training ID', 'Training Name', 'Sim Key', 'Order', 'Status'],
  [SHEET.SETTINGS]: ['Key', 'Value', 'Description'],
  // One row per crash. `Fingerprint` groups repeats of the same fault; the
  // `Report: Crashes` sheet counts them. User columns are blank when nobody was
  // signed in.
  [SHEET.CRASHES]: [
    'Report ID',
    'Occurred At',
    'Received At',
    'Kind',
    'Fatal',
    'Message',
    'Fingerprint',
    'User ID',
    'Email',
    'Device ID',
    'Device Name',
    'App Version',
    'Platform',
    'OS Version',
    'Electron Version',
    'Context',
    'Stack',
  ],
};

/** Columns written as timestamps, formatted as date-times in the sheet. */
const DATETIME_COLUMNS = [
  'Device Bound At',
  'Registration Date',
  'Last Active',
  'Created Date',
  'Activated Date',
  'Last Used',
  'Start Time',
  'End Time',
  'Timestamp',
  'Received At',
  'Occurred At',
];

/**
 * Tunable rules, seeded into the Settings sheet. Change the Value in the sheet;
 * the code reads it on every request. SEQ_* are the ID counters.
 */
const DEFAULT_SETTINGS = [
  ['SEQ_USER', 0, 'Last issued USR- number. Do not lower it.'],
  ['SEQ_SESSION', 0, 'Last issued SES- number. Do not lower it.'],
  ['SEQ_EVENT', 0, 'Last issued EVT- number. Do not lower it.'],
  ['SEQ_CRASH', 0, 'Last issued CRS- number. Do not lower it.'],
  ['MAX_CRASH_REPORTS_PER_HOUR', 60, 'Crash reports accepted per device per hour; the rest are dropped.'],
  ['LEVEL_POINTS', 500, 'Points per level. Level = 1 + floor(total points / this).'],
  ['MISSION_COMPLETE_POINTS', 50, 'Points for completing a mission.'],
  ['MISSION_SCORE_POINTS', 10, 'Extra points per mission score point.'],
  ['TRAINING_COMPLETE_POINTS', 30, 'Points for completing a training module.'],
  ['STAR_POINTS', 25, 'Extra points per star on a completed mission or module.'],
  ['REPEAT_COMPLETION_PERCENT', 25, 'Percent of the award paid for re-completing the same mission/module.'],
  ['FREE_FLIGHT_POINTS_PER_MINUTE', 2, 'Points per full airborne minute of free flight.'],
  ['FREE_FLIGHT_POINTS_CAP', 30, 'Most points one free-flight session can earn.'],
  ['MAX_LOGIN_FAILURES', 10, 'Failed activations/logins per email before a 15 minute lockout.'],
];
