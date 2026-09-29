import { useCallback, useEffect, useState } from 'react';
import type { UserDashboard } from '@shared/backend/contract';
import type { TelemetryStatus } from '@shared/backend/ipc';
import { useAccountStore } from '../state/accountStore';
import { useSettingsStore } from '../state/settingsStore';
import { UserService } from '../services/userService';
import { AnalyticsService } from '../services/analyticsService';
import { Button, Checkbox, Icon, Modal, Progress, StatTile } from '../ds';
import { rankStanding } from './pilotRank';
import { LESSONS } from '../training/lessons';
import { MISSIONS } from '../missions';
import { firstName, initials } from './activationKey';
import {
  TYPE_LABEL,
  clock,
  dayMonth,
  formatDuration,
  formatNumber,
  longestFreeFlight,
  progressCounts,
  sessionResult,
  sessionTitle,
  whenText,
} from './profileFacts';

// The pilot's page: who they are, where they stand on the rank ladder, what
// they have done, and their last flights. Every figure is a number or a word.
//
// Everything comes from one `getUserDashboard` call; until it arrives (or when
// offline) the page shows the profile's own totals and says so.

/** "Sign out, Asha?" with the choice to forget this pilot on this computer.
 *  Focus starts on Stay signed in, and Esc stays. */
export function SignOutDialog({
  name,
  email,
  onStay,
  onSignOut,
}: {
  name: string;
  email: string;
  onStay: () => void;
  onSignOut: (forget: boolean) => void;
}) {
  const [forget, setForget] = useState(false);
  return (
    <div data-register="classroom" className="profile-signout">
      <Modal
        title={`Sign out, ${firstName(name)}?`}
        safe={{ label: 'Stay signed in', onClick: onStay }}
        danger={{ label: 'Sign out', onClick: () => onSignOut(forget) }}
      >
        <p>
          Your flights, stars and XP are saved to your profile. Sign back in any time with your email and
          activation key.
        </p>
        <div className="profile-signout__forget">
          <Checkbox checked={forget} onChange={setForget} hint="Choose this on a shared classroom computer.">
            Forget {email} on this computer
          </Checkbox>
        </div>
      </Modal>
    </div>
  );
}

/** Rows in the flight history table. */
const HISTORY_ROWS = 10;

export function ProfileScreen() {
  const profile = useAccountStore((s) => s.profile);
  const signOut = useAccountStore((s) => s.signOut);
  const [dash, setDash] = useState<UserDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<TelemetryStatus | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    // 50 is the backend's most: the longest free flight is found among them.
    const res = await UserService.dashboard({ recentLimit: 50, days: 30 });
    if (res.success) {
      setDash(res.data);
      setError(null);
    } else {
      setError(
        res.code === 'NETWORK'
          ? 'Offline. These are your totals from the last time PlutoSim was online.'
          : res.message,
      );
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
  const standing = rankStanding(p);
  const history = dash ? dash.recentSessions.slice(0, HISTORY_ROWS) : [];
  const longest = dash ? longestFreeFlight(dash.recentSessions) : null;
  const counts = dash ? progressCounts(dash, { lessons: LESSONS.length, missions: MISSIONS.length }) : null;
  const sinceDay = p.registeredAt ? dayMonth(new Date(p.registeredAt)) : null;
  const pending = sync?.pending ?? 0;

  const doSignOut = (forget: boolean) => {
    setConfirming(false);
    if (forget) useSettingsStore.getState().set('lastPilot', null);
    void signOut();
  };

  return (
    <div className="profile" data-register="classroom">
      <h1 className="profile__title">Profile</h1>

      <section className="profile__card" aria-label="Pilot">
        <header className="profile__head">
          <span className="profile__avatar" aria-hidden="true">
            {initials(p.name)}
          </span>
          <div className="profile__who">
            <h2 className="profile__name">{p.name}</h2>
            <p className="profile__meta">
              {standing.rank} · Rank {standing.position} of {standing.of} · Level {p.level}
              {p.device ? ` · on ${p.device.name}` : ''}
            </p>
          </div>
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Sign out
          </Button>
        </header>

        <div className="profile__xp-row">
          <b>{formatNumber(standing.totalXp)} XP</b>
          <span>
            {standing.next
              ? `${formatNumber(standing.next.xpToGo)} XP to ${standing.next.name}`
              : 'Top rank reached'}
          </span>
        </div>

        <ol className="profile__ladder" aria-label="Rank ladder">
          {standing.ladder.map((r, i) => (
            <li
              key={r.name}
              className={`profile__rung is-${r.state}`}
              aria-current={r.state === 'current' ? 'step' : undefined}
            >
              <span className="profile__node" aria-hidden="true">
                {r.state === 'reached' ? <Icon name="check" /> : r.state === 'current' ? <Icon name="dot" /> : i + 1}
              </span>
              <span className="profile__rung-name">{r.name}</span>
              <span className="profile__rung-xp">
                {r.state === 'current' ? 'Current rank' : `${formatNumber(r.xp)} XP`}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {(error || pending > 0) && (
        <p className="profile__note" role="status">
          <Icon name="warning" />
          <span>
            {error ?? ''}
            {error && pending > 0 ? ' ' : ''}
            {pending > 0
              ? `${pending} recorded ${pending === 1 ? 'flight is' : 'flights are'} waiting to upload.`
              : ''}
          </span>
        </p>
      )}

      <section className="profile__tiles" aria-label="Totals">
        <StatTile
          label="Total flights"
          value={formatNumber(stats.totalFlights)}
          note={sinceDay ? `Since ${sinceDay}` : undefined}
        />
        <StatTile
          label="Air time"
          value={formatDuration(stats.totalFlightTimeSec)}
          note={
            !dash
              ? undefined
              : longest === null
                ? 'No free flight yet'
                : `Longest flight ${clock(longest)}`
          }
        />
        <StatTile
          label="Stars earned"
          value={
            <span className="profile__stars">
              <Icon name="star" />
              {counts ? counts.stars : '…'}
              <small>of {counts ? counts.starsOf : LESSONS.length * 3}</small>
            </span>
          }
          note="Up to 3 per lesson"
        />
        <div className="profile__done ds-stat">
          {[
            ['Lessons', counts?.lessons ?? stats.trainingCompleted, LESSONS.length],
            ['Missions', counts?.missions ?? stats.missionsCompleted, MISSIONS.length],
          ].map(([label, n, of]) => (
            <div key={label as string} className="profile__done-row">
              <span className="profile__done-head">
                <b>{label}</b>
                <span>
                  {n} of {of} complete
                </span>
              </span>
              <Progress value={Number(n)} max={Number(of)} label={`${label} complete`} tone="neutral" />
            </div>
          ))}
        </div>
      </section>

      <section className="profile__card profile__history" aria-labelledby="history-title">
        <header className="profile__card-head">
          <h2 id="history-title" className="profile__card-title">
            Flight history
          </h2>
          {history.length > 0 && (
            <span className="profile__card-meta">
              Last {history.length} {history.length === 1 ? 'flight' : 'flights'}
            </span>
          )}
        </header>
        {!dash ? (
          <p className="profile__empty">{error ? 'Flight history needs a connection.' : 'Loading your flights…'}</p>
        ) : history.length === 0 ? (
          <p className="profile__empty">No flights yet. A lesson, a mission or a free flight will show up here.</p>
        ) : (
          <table className="profile__table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Flight</th>
                <th scope="col">Drone</th>
                <th scope="col" className="num">
                  Time
                </th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {history.map((s) => {
                const r = sessionResult(s);
                return (
                  <tr key={s.sessionId}>
                    <td className="profile__when">{whenText(s.startTime)}</td>
                    <td>
                      <b>{sessionTitle(s)}</b>
                      {sessionTitle(s) !== TYPE_LABEL[s.flightType] && (
                        <span className="profile__type">{TYPE_LABEL[s.flightType]}</span>
                      )}
                    </td>
                    <td>{s.droneName}</td>
                    <td className="num">{clock(s.duration)}</td>
                    <td>
                      <span className={`profile__result ds-tone--${r.tone}`}>
                        <Icon name={r.icon} />
                        {r.word}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {confirming && (
        <SignOutDialog name={p.name} email={p.email} onStay={() => setConfirming(false)} onSignOut={doSignOut} />
      )}
    </div>
  );
}
