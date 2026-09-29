import { useEffect, useMemo, useRef } from 'react';
import { useUiStore } from '../state/uiStore';
import { useSettingsStore } from '../state/settingsStore';
import { useShellStore } from '../state/shellStore';
import { useAccountStore } from '../state/accountStore';
import { usePilotStore } from '../state/pilotStore';
import { useTrainingStore } from '../state/trainingStore';
import { useMissionStore } from '../state/missionStore';
import { getDrone, getEnvironment, listDrones } from '../plugins/registry';
import { LESSONS } from '../training/lessons';
import { MISSIONS, getMission } from '../missions';
import { Icon, Progress } from '../ds';
import { HangarScene } from './HangarScene';
import { LoadoutChip, type LoadoutOption } from './LoadoutChip';
import { IconDrone } from './icons';
import { ceilingFor, droneBuild, formatMass, formatMetres } from './loadout';
import { handlingLine, homeDroneFacts, homePlan, type ModeRow } from './homeFacts';
import { rankStanding } from './pilotRank';
import { formatNumber } from './profileFacts';
import { initials } from './activationKey';

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Where the pilot stands, for the badge: the profile's rank when signed in,
 *  else the local Flight School rank. */
function useBadge() {
  const profile = useAccountStore((s) => (s.status === 'signedIn' ? s.profile : null));
  const local = usePilotStore();
  if (profile?.levelPoints) {
    const st = rankStanding(profile);
    return {
      signedIn: true,
      name: profile.name,
      line: `${st.rank} · Rank ${st.position} of ${st.of}`,
      xp: st.totalXp,
      into: st.intoRank,
      span: st.rankSpan,
      toGo: st.next ? `${formatNumber(st.next.xpToGo)} XP to ${st.next.name}` : 'Top rank reached',
    };
  }
  return {
    signedIn: false,
    name: local.callsign,
    line: local.rank,
    xp: local.totalXp,
    into: local.xp,
    span: local.xpNext,
    toGo: `${formatNumber(Math.max(0, local.xpNext - local.xp))} XP to the next rank`,
  };
}

function PilotBadge() {
  const b = useBadge();
  const setSection = useUiStore((s) => s.setSection);
  const body = (
    <>
      <span className="home__avatar" aria-hidden="true">
        {initials(b.name)}
      </span>
      <span className="home__who">
        <b>{b.name}</b>
        <span>{b.line}</span>
      </span>
      <span className="home__xp">
        <span className="home__xp-row">
          <b>{formatNumber(b.xp)} XP</b>
          <span>{b.toGo}</span>
        </span>
        <Progress value={b.into} max={b.span} label="XP to the next rank" tone="neutral" />
      </span>
    </>
  );
  // Signed in, the badge is the way to the profile.
  return b.signedIn ? (
    <button type="button" className="home__badge is-link" onClick={() => setSection('profile')}>
      {body}
    </button>
  ) : (
    <div className="home__badge">{body}</div>
  );
}

function ModeButton({ row, onPick }: { row: ModeRow; onPick: (row: ModeRow) => void }) {
  return (
    <button
      type="button"
      className={row.primary ? 'home__mode is-primary' : 'home__mode'}
      data-primary={row.primary ? true : undefined}
      data-mode={row.id}
      onClick={() => onPick(row)}
    >
      <span className="home__mode-text">
        <span className="home__mode-top">
          <span className="home__mode-title">{row.title}</span>
          {row.count && (
            <span className="home__mode-count">
              {row.count}
              {row.countStars && <Icon name="star" />}
            </span>
          )}
        </span>
        <span className="home__mode-line">{row.line}</span>
      </span>
      <span className="home__mode-go" aria-hidden="true">
        <Icon name="chevron" />
      </span>
    </button>
  );
}

/**
 * Home, "the hangar": the loadout drone on the stage with its specs, one list
 * of modes with a single primary action, and the pilot badge. No setup strip:
 * the top bar's NEXT FLIGHT chips already name the drone, arena and ceiling.
 * Everything on it is a fact from the game's own data (homeFacts.ts).
 */
export function Home() {
  const settings = useSettingsStore((s) => s.settings);
  const setSetting = useSettingsStore((s) => s.set);
  const setSection = useUiStore((s) => s.setSection);
  const setContext = useShellStore((s) => s.setContext);
  const pilotName = useAccountStore((s) => (s.status === 'signedIn' ? s.profile?.name : null));
  const listRef = useRef<HTMLUListElement>(null);
  const paused = useMemo(reducedMotion, []);

  const drones = useMemo(() => listDrones(), []);
  const drone = getDrone(settings.selectedDroneId) ?? drones[0];
  const env = getEnvironment(settings.selectedEnvironmentId);
  const ceiling = ceilingFor(drone, env);
  const droneAt = Math.max(
    0,
    drones.findIndex((d) => d.id === drone?.id),
  );

  const plan = homePlan({
    lessons: LESSONS,
    missions: MISSIONS,
    training: settings.training,
    missionProgress: settings.missions,
    pilotName,
    envName: (id) => getEnvironment(id)?.name,
  });

  useEffect(() => {
    setContext(plan.statusContext, plan.statusTag);
    return () => setContext('');
  }, [plan.statusContext, plan.statusTag, setContext]);

  // Focus starts on the primary row, so Enter starts it — unless the pilot
  // arrived by pointer on another control (a sidebar click keeps its focus).
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    listRef.current?.querySelector<HTMLElement>('[data-primary]')?.focus({ preventScroll: true });
  }, []);

  const pick = (row: ModeRow) => {
    const t = row.target;
    if (t.kind === 'lesson') {
      useTrainingStore.getState().start(t.id);
      setSection('training');
    } else if (t.kind === 'mission') {
      const m = getMission(t.id);
      if (m) useMissionStore.getState().start(m);
      setSection('missions');
    } else {
      setSection(t.section);
    }
  };

  const droneOptions: LoadoutOption[] = drones.map((d) => ({
    id: d.id,
    name: d.name,
    meta: formatMass(d.mass),
    detail: droneBuild(d),
    thumb: <IconDrone size={22} />,
  }));

  if (!drone) return null;
  const tag = `${env?.name ?? 'No arena'} · ceiling ${formatMetres(ceiling.metres)}`;

  return (
    <div className="home" data-register="classroom">
      <section className="home__hero" aria-label={`${drone.name}, selected for the next flight`}>
        <div className="home__stage">
          <HangarScene spec={drone} paused={paused} />
          <span className="home__tag">{tag}</span>
        </div>

        <div className="home__spec">
          <p className="home__count">
            Selected drone · {droneAt + 1} of {drones.length}
          </p>
          <h1 className="home__name">{drone.name}</h1>
          <LoadoutChip
            variant="button"
            buttonText="Change drone"
            icon={<IconDrone size={20} />}
            label="Drone"
            value={drone.id}
            options={droneOptions}
            onSelect={(id) => setSetting('selectedDroneId', id)}
            blurb="Changes mass, thrust and handling. Sets the next flight."
          />
          <dl className="home__facts">
            {homeDroneFacts(drone).map((f) => (
              <div key={f.label} className="home__fact">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          <div className="home__handling">
            <span>Handling</span>
            <p>{handlingLine(drone)}</p>
          </div>
        </div>
      </section>

      <section className="home__modes" aria-labelledby="home-heading">
        <h2 id="home-heading" className="home__heading">
          {plan.heading}
        </h2>
        <p className="home__lede">
          Flight controller ported from the Pluto firmware. Physics runs at 250 Hz.
        </p>
        <ul ref={listRef} className="home__list" aria-label="Modes">
          {plan.rows.map((row) => (
            <li key={row.id}>
              <ModeButton row={row} onPick={pick} />
            </li>
          ))}
        </ul>
      </section>

      <div className="home__foot">
        <PilotBadge />
      </div>
    </div>
  );
}
