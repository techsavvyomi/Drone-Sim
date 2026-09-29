import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsStore } from '../state/settingsStore';
import { useMissionStore } from '../state/missionStore';
import { useShellStore } from '../state/shellStore';
import { MissionViewport } from '../missions/MissionViewport';
import { MISSIONS } from '../missions';
import { playClick } from '../audio/sfx';
import { Icon, Progress, StarRating } from '../ds';
import { MissionPicture, mapNameOf } from '../hud/MissionPicture';
import {
  clock,
  missionBlockSummaries,
  missionListSummary,
  missionRows,
  openingMissionBlock,
  rowMeta,
  rowStatusText,
  type MissionRow,
} from './missionFacts';

// Top-level Missions section (Phase 5): Pluto Field Ops. The mission list when
// nothing is active — the Flight School's grouped layout, a rail of four blocks
// and the chosen block's missions as rows — otherwise the live mission (flight
// view, runtime and mission HUD, which opens on the briefing).

function RowStatus({ row }: { row: MissionRow }) {
  if (row.status === 'done') {
    return (
      <span className="tlist__status is-done">
        <Icon name="check" />
        {rowStatusText(row)}
      </span>
    );
  }
  if (row.status === 'next') {
    return (
      <span className="tlist__status is-next">
        {rowStatusText(row)}
        <Icon name="chevron" />
      </span>
    );
  }
  return (
    <span className="tlist__status is-locked">
      <span>Locked</span>
      <span>{rowStatusText(row)}</span>
    </span>
  );
}

function MissionList() {
  const progress = useSettingsStore((s) => s.settings.missions.missions);
  const start = useMissionStore((s) => s.start);
  const setContext = useShellStore((s) => s.setContext);

  const rows = useMemo(() => missionRows(MISSIONS, progress), [progress]);
  const blocks = useMemo(() => missionBlockSummaries(rows), [rows]);
  const summary = missionListSummary(rows);
  const [blockAt, setBlockAt] = useState(() => openingMissionBlock(rows));
  const block = blocks[blockAt];
  const shown = rows.filter((r) => r.n >= block.from && r.n <= block.to);
  const tableRef = useRef<HTMLDivElement>(null);

  const describe = (row: MissionRow | null) => {
    if (row) setContext(`Mission ${row.n} of ${rows.length} · ${row.mission.name}`);
    else setContext(summary.nextLine);
  };

  useEffect(() => {
    describe(summary.next);
    return () => setContext('');
  }, [summary.next?.mission.id]);

  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    tableRef.current?.querySelector<HTMLElement>('[data-primary]')?.focus({ preventScroll: true });
  }, []);

  const open = (row: MissionRow) => {
    if (row.status === 'locked') return;
    playClick();
    start(row.mission);
  };

  return (
    <div className="tlist mlist" data-register="classroom">
      <header className="tlist__head">
        <h1 className="tlist__title">Missions</h1>
        <p className="tlist__lede">
          Pluto Field Ops · {rows.length} story missions over the city, the forest, a building site
          and a supermarket · {rows.length * 3} stars. Each has one time limit.
        </p>
      </header>

      <div className="tlist__body">
        <nav className="tlist__rail" aria-label="Blocks">
          {blocks.map((b) => (
            <button
              key={b.name}
              type="button"
              className={`tlist__block${b.index === blockAt ? ' is-open' : ''}${
                b.locked ? ' is-locked' : ''
              }`}
              aria-pressed={b.index === blockAt}
              onClick={() => setBlockAt(b.index)}
            >
              <span className="tlist__block-top">
                <b>{b.name}</b>
                <span>
                  Missions {b.from}–{b.to}
                </span>
              </span>
              <span className="tlist__block-line">
                <Icon name={b.locked ? 'ring' : 'dot'} />
                {b.line}
              </span>
              <Progress
                value={b.done}
                max={b.total}
                label={`${b.name}: ${b.done} of ${b.total} done`}
                tone="neutral"
              />
            </button>
          ))}
          <div className="tlist__sum">
            <b>{summary.line}</b>
            <span>{summary.nextLine}</span>
          </div>
        </nav>

        <section className="tlist__table" ref={tableRef} aria-label={block.name}>
          <header className="tlist__table-head">
            <h2>{block.name}</h2>
            <span>
              Missions {block.from}–{block.to}
              {block.locked ? ` · ${block.line}` : ''}
            </span>
          </header>
          <div className="tlist__cols" aria-hidden="true">
            <span>No.</span>
            <span>Image</span>
            <span>Mission</span>
            <span>Limit</span>
            <span>Stars</span>
            <span>Status</span>
          </div>
          <ul className="tlist__rows">
            {shown.map((row) => (
              <li key={row.mission.id}>
                <button
                  type="button"
                  className={`tlist__row is-${row.status}`}
                  data-primary={row.status === 'next' ? true : undefined}
                  data-mission={row.mission.id}
                  aria-disabled={row.status === 'locked' ? true : undefined}
                  onClick={() => open(row)}
                  onFocus={() => describe(row)}
                  onMouseEnter={() => describe(row)}
                >
                  <span className="tlist__n">{row.n}</span>
                  <span className="tlist__map mlist__pic">
                    <MissionPicture mission={row.mission} />
                  </span>
                  <span className="tlist__module">
                    <b>{row.mission.name}</b>
                    <span>{rowMeta(row.mission, mapNameOf(row.mission))}</span>
                  </span>
                  <span className="tlist__time mlist__limit">
                    {clock(row.mission.timeLimitSec)}
                    {row.bestTimeSec !== null && <i>Best {clock(row.bestTimeSec)}</i>}
                  </span>
                  <span className="tlist__stars">
                    <StarRating earned={row.stars} showText={false} />
                    <span>{row.stars} of 3</span>
                  </span>
                  <RowStatus row={row} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function MissionScreen() {
  const mission = useMissionStore((s) => s.mission);
  // Keyed on the mission, so moving from one to the next is a genuine remount:
  // the Director's setup, the scene's environment and the aircraft's spawn all
  // run mount-only.
  if (mission) return <MissionViewport key={mission.id} mission={mission} />;
  return <MissionList />;
}
