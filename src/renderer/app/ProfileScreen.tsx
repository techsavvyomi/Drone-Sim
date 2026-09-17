import { useCallback, useEffect, useState } from 'react';
import type { SessionSummary, UserDashboard } from '@shared/backend/contract';
import type { TelemetryStatus } from '@shared/backend/ipc';
import { useAccountStore } from '../state/accountStore';
import { UserService } from '../services/userService';
import { AnalyticsService } from '../services/analyticsService';
import { BarList, DailyColumns, formatDuration, formatNumber } from './profileCharts';
import { IconCap, IconDrone, IconMedal } from './icons';
import { rankForLevel } from './pilotRank';

// The pilot's career screen: who they are, what they have flown, and how it is
// going, dressed the way a game's player card is rather than an account page.
//
// Everything on it comes from one `getUserDashboard` call, so adding a panel is
// adding a field to that response, not another round trip.

const TYPE_LABEL: Record<SessionSummary['flightType'], string> = {
  MISSION: 'Mission',
  TRAINING: 'Training',
  FREE_FLIGHT: 'Free flight',
};

const TYPE_ICON: Record<SessionSummary['flightType'], React.ReactNode> = {
  MISSION: <IconMedal size={18} />,
  TRAINING: <IconCap size={18} />,
  FREE_FLIGHT: <IconDrone size={18} />,
};

const RESULT_LABEL: Record<SessionSummary['result'], string> = {
  SUCCESS: 'Complete',
  FAILED: 'Failed',
  ABORTED: 'Aborted',
  IN_PROGRESS: 'Syncing',
};

function sessionTitle(s: SessionSummary): string {
  if (s.flightType === 'MISSION') return s.missionName || s.missionId;
  if (s.flightType === 'TRAINING') return s.trainingName || s.trainingId;
  return 'Open airspace';
}

/** A level emblem: a hexagon with the number set in it. */
function LevelEmblem({ level, progress }: { level: number; progress: number }) {
  // Hexagon perimeter as a stroke-dash, so the ring fills with level progress.
  const hex = 'M60 6 L107 33 L107 87 L60 114 L13 87 L13 33 Z';
  return (
    <svg className="pro-emblem" viewBox="0 0 120 120" aria-hidden="true">
      <path d={hex} className="pro-emblem-bg" />
      <path d={hex} className="pro-emblem-track" pathLength={100} />
      <path
        d={hex}
        className="pro-emblem-fill"
        pathLength={100}
        strokeDasharray={`${Math.max(0, Math.min(100, progress))} 100`}
      />
      <path d="M60 22 L93 41 L93 79 L60 98 L27 79 L27 41 Z" className="pro-emblem-inner" />
      <text x="60" y="56" className="pro-emblem-caption" textAnchor="middle">
        LVL
      </text>
      <text x="60" y="84" className="pro-emblem-level" textAnchor="middle">
        {level}
      </text>
    </svg>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="pro-stat">
      <span className="pro-stat-label">{label}</span>
      <b className="pro-stat-value">{value}</b>
      {sub && <span className="pro-stat-sub">{sub}</span>}
    </div>
  );
}

function Panel({
  title,
  tag,
  children,
  className = '',
}: {
  title: string;
  tag?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`pro-panel ${className}`}>
      <header className="pro-panel-head">
        <h2>{title}</h2>
        {tag && <span className="pro-panel-tag">{tag}</span>}
      </header>
      {children}
    </section>
  );
}

export function ProfileScreen() {
  const profile = useAccountStore((s) => s.profile);
  const signOut = useAccountStore((s) => s.signOut);
  const [dash, setDash] = useState<UserDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sync, setSync] = useState<TelemetryStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await UserService.dashboard({ recentLimit: 10, days: 30 });
      if (res.success) {
        setDash(res.data);
        setError(null);
      } else {
        setError(res.code === 'NETWORK' ? 'Offline. Showing your last known totals.' : res.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload when a finished session lands and the profile's totals move.
  const flights = profile?.stats.totalFlights;
  useEffect(() => {
    void load();
  }, [load, flights]);

  useEffect(() => {
    const poll = () => void AnalyticsService.status().then(setSync).catch(() => undefined);
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  if (!profile) return null;
  const p = dash?.profile ?? profile;
  const stats = p.stats;
  const levelPct = p.levelPoints.next > 0 ? (p.levelPoints.current / p.levelPoints.next) * 100 : 0;
  const segments = 20;
  const litSegments = Math.floor((levelPct / 100) * segments);
  const since = p.registeredAt
    ? new Date(p.registeredAt).toLocaleDateString('en-US', { dateStyle: 'medium' })
    : '—';

  return (
    <div className="section-body pro">
      {/* ---- Player card ------------------------------------------------ */}
      <header className="pro-hero">
        <div className="pro-hero-grid" aria-hidden="true" />
        <LevelEmblem level={p.level} progress={levelPct} />

        <div className="pro-id">
          <span className="pro-rank">
            <i />
            {rankForLevel(p.level)}
          </span>
          <h1 className="pro-name">{p.name}</h1>
          <span className="pro-meta">
            <b>{p.userId}</b>
            <span>{p.email}</span>
            <span>Pilot since {since}</span>
            {p.device && <span title="This profile can only be used on this computer">🔒 {p.device.name}</span>}
          </span>

          <div className="pro-xp">
            <div className="pro-xp-bar" role="progressbar" aria-valuenow={Math.round(levelPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next level">
              {Array.from({ length: segments }, (_, i) => (
                <span key={i} className={i < litSegments ? 'on' : ''} />
              ))}
            </div>
            <span className="pro-xp-text">
              <b>{formatNumber(p.levelPoints.current)}</b> / {formatNumber(p.levelPoints.next)} XP to level{' '}
              {p.level + 1}
            </span>
          </div>
        </div>

        <div className="pro-headline">
          <div className="pro-headline-main">
            <span>Career points</span>
            <b>{formatNumber(stats.totalPoints)}</b>
          </div>
          <div className="pro-actions">
            <button className="pro-btn" onClick={() => void load()} disabled={loading}>
              {loading ? 'Syncing…' : 'Refresh'}
            </button>
            <button className="pro-btn ghost" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      {(error || (sync && sync.pending > 0)) && (
        <p className="pro-sync">
          <i />
          {error ?? ''}
          {error && sync && sync.pending > 0 ? ' ' : ''}
          {sync && sync.pending > 0
            ? `${sync.pending} recorded ${sync.pending === 1 ? 'item' : 'items'} waiting to upload.`
            : ''}
        </p>
      )}

      {/* ---- Career stats ----------------------------------------------- */}
      <section className="pro-stats" aria-label="Career overview">
        <Stat label="Flights" value={formatNumber(stats.totalFlights)} />
        <Stat label="Flight time" value={formatDuration(stats.totalFlightTimeSec)} />
        <Stat
          label="Missions"
          value={formatNumber(stats.missionsCompleted)}
          sub={`${formatNumber(stats.missionFlights)} sorties`}
        />
        <Stat
          label="Training"
          value={dash ? `${dash.training.completed}/${dash.training.total}` : formatNumber(stats.trainingCompleted)}
          sub={`${formatNumber(stats.trainingFlights)} sessions`}
        />
        <Stat
          label="Free flight"
          value={formatDuration(stats.freeFlightTimeSec)}
          sub={`${formatNumber(stats.freeFlights)} flights`}
        />
        <Stat label="Avg score" value={`${Math.round(stats.averageScore)}%`} sub={`${formatNumber(stats.crashCount)} crashes`} />
      </section>

      {dash ? (
        <>
          <div className="pro-grid">
            <Panel title="Points" tag="Last 30 days">
              <DailyColumns
                data={dash.daily.map((d) => ({ date: d.date, value: d.points }))}
                format={formatNumber}
                label="Points"
              />
            </Panel>
            <Panel title="Flight time" tag="Last 30 days">
              <DailyColumns
                data={dash.daily.map((d) => ({ date: d.date, value: d.flightTimeSec }))}
                format={formatDuration}
                timeAxis
                label="Flight time"
              />
            </Panel>

            <Panel title="Field ops" tag="Missions">
              <div className="pro-figure">
                <b>{dash.missionCompletionRate}%</b>
                <span>Completion rate</span>
              </div>
              <BarList
                empty="No missions flown yet. Field Ops is waiting."
                data={dash.missions
                  .filter((m) => m.sessions > 0)
                  .map((m) => ({
                    id: m.missionId,
                    label: m.missionName,
                    value: m.completed,
                    display: `${m.completed} / ${m.sessions}`,
                    detail: `${m.attempts} attempts, best score ${m.bestScore}`,
                  }))}
              />
            </Panel>

            <Panel title="Flight school mastery" tag={`${dash.training.completed} / ${dash.training.total}`}>
              <ol className="pro-mastery">
                {dash.training.modules.map((m) => (
                  <li
                    key={m.trainingId}
                    className={m.completed ? 'done' : m.sessions > 0 ? 'tried' : ''}
                    title={`Module ${m.order}: ${m.trainingName}${
                      m.completed
                        ? `, ${m.bestStars} star${m.bestStars === 1 ? '' : 's'}`
                        : m.sessions > 0
                          ? ', attempted'
                          : ', not attempted'
                    }`}
                  >
                    <span className="pro-mastery-n">{String(m.order).padStart(2, '0')}</span>
                    <span className="pro-mastery-stars" aria-label={`${m.bestStars} of 3 stars`}>
                      {[1, 2, 3].map((i) => (
                        <i key={i} className={m.completed && i <= m.bestStars ? 'on' : ''} />
                      ))}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title="Hangar" tag="Flight time by drone">
              <BarList
                empty="No flights logged yet."
                data={dash.drones.map((d) => ({
                  id: d.droneId,
                  label: d.droneName,
                  value: d.flightTimeSec,
                  display: formatDuration(d.flightTimeSec),
                  detail: `${d.sessions} sessions`,
                }))}
              />
            </Panel>

            <Panel title="Incidents" tag="Crashes">
              <div className="pro-figure">
                <b>{formatNumber(stats.crashCount)}</b>
                <span>
                  {/* A rate over a few minutes of flying is noise, not a trend. */}
                  {stats.totalFlightTimeSec >= 600
                    ? `${(stats.crashCount / (stats.totalFlightTimeSec / 3600)).toFixed(1)} per flight hour`
                    : 'Total'}
                </span>
              </div>
              <BarList
                empty="Clean record. Keep it that way."
                data={dash.drones
                  .filter((d) => d.crashes > 0)
                  .map((d) => ({
                    id: d.droneId,
                    label: d.droneName,
                    value: d.crashes,
                    display: formatNumber(d.crashes),
                  }))}
              />
            </Panel>
          </div>

          <Panel title="Flight log" tag="Recent sessions" className="pro-log-panel">
            {dash.recentSessions.length === 0 ? (
              <p className="pempty">No sessions yet. Fly a mission, a lesson or a free flight and it lands here.</p>
            ) : (
              <table className="pro-log">
                <thead>
                  <tr>
                    <th>Result</th>
                    <th>Session</th>
                    <th>Drone</th>
                    <th className="num">Time</th>
                    <th className="num">Score</th>
                    <th className="num">Points</th>
                    <th className="num">When</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.recentSessions.map((s) => (
                    <tr key={s.sessionId} className={`r-${s.result.toLowerCase()}`}>
                      <td>
                        <span className="pro-result">{RESULT_LABEL[s.result]}</span>
                      </td>
                      <td>
                        <span className="pro-log-title">
                          <span className="pro-log-icon">{TYPE_ICON[s.flightType]}</span>
                          <span>
                            <b>{sessionTitle(s)}</b>
                            <i>{TYPE_LABEL[s.flightType]}</i>
                          </span>
                        </span>
                      </td>
                      <td>{s.droneName}</td>
                      <td className="num">{formatDuration(s.duration)}</td>
                      <td className="num">
                        {s.flightType === 'FREE_FLIGHT' ? '—' : (
                          <>
                            {s.score}
                            {s.stars > 0 && <span className="pro-log-stars"> {'★'.repeat(s.stars)}</span>}
                          </>
                        )}
                      </td>
                      <td className="num pro-log-points">{s.pointsEarned > 0 ? `+${formatNumber(s.pointsEarned)}` : '0'}</td>
                      <td className="num pro-log-when">
                        {new Date(s.startTime).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      ) : (
        !error && <p className="pempty">Loading your career…</p>
      )}
    </div>
  );
}
