import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsStore } from '../state/settingsStore';
import { useShellStore } from '../state/shellStore';
import { useTrainingStore } from '../state/trainingStore';
import { LESSONS } from '../training/lessons';
import { playClick } from '../audio/sfx';
import { Icon, Progress, StarRating } from '../ds';
import { LessonThumb } from '../hud/LessonThumb';
import {
  blockSummaries,
  formatSeconds,
  listSummary,
  moduleRows,
  openingBlock,
  rowStatusText,
  type ModuleRow,
} from './trainingFacts';

function RowStatus({ row }: { row: ModuleRow }) {
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

/**
 * Pluto Flight School, the module list (Phase 4). A rail of the four blocks on
 * the left, the chosen block's modules as rows on the right. The whole row is
 * the button; the next module is the one signal element and takes focus on
 * arrival. A locked block can still be opened and read.
 */
export function LessonSelect() {
  const progress = useSettingsStore((s) => s.settings.training.lessons);
  const start = useTrainingStore((s) => s.start);
  const setContext = useShellStore((s) => s.setContext);

  const rows = useMemo(() => moduleRows(LESSONS, progress), [progress]);
  const blocks = useMemo(() => blockSummaries(rows), [rows]);
  const summary = listSummary(rows);
  const [blockAt, setBlockAt] = useState(() => openingBlock(rows));
  const block = blocks[blockAt];
  const shown = rows.filter((r) => r.n >= block.from && r.n <= block.to);
  const tableRef = useRef<HTMLDivElement>(null);

  const describe = (row: ModuleRow | null) => {
    if (row) setContext(`Module ${row.n} of ${rows.length} · ${row.title}`);
    else setContext(summary.nextLine);
  };

  useEffect(() => {
    describe(summary.next);
    return () => setContext('');
  }, [summary.next?.id]);

  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    tableRef.current?.querySelector<HTMLElement>('[data-primary]')?.focus({ preventScroll: true });
  }, []);

  const open = (row: ModuleRow) => {
    if (row.status === 'locked') return;
    playClick();
    start(row.id);
  };

  return (
    <div className="tlist" data-register="classroom">
      <header className="tlist__head">
        <h1 className="tlist__title">Training</h1>
        <p className="tlist__lede">
          Pluto Flight School · {rows.length} modules in {blocks.length} blocks · {summary.maxStars}{' '}
          stars. Each module runs Learn, Demo, Fly, Done.
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
                  Modules {b.from}–{b.to}
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
              Modules {block.from}–{block.to}
              {block.locked ? ` · ${block.line}` : ''}
            </span>
          </header>
          <div className="tlist__cols" aria-hidden="true">
            <span>No.</span>
            <span>Map</span>
            <span>Module</span>
            <span>Best</span>
            <span>Stars</span>
            <span>Status</span>
          </div>
          <ul className="tlist__rows">
            {shown.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={`tlist__row is-${row.status}`}
                  data-primary={row.status === 'next' ? true : undefined}
                  data-lesson={row.id}
                  aria-disabled={row.status === 'locked' ? true : undefined}
                  onClick={() => open(row)}
                  onFocus={() => describe(row)}
                  onMouseEnter={() => describe(row)}
                >
                  <span className="tlist__n">{row.n}</span>
                  <span className="tlist__map">
                    <LessonThumb lesson={row.lesson} />
                  </span>
                  <span className="tlist__module">
                    <b>{row.title}</b>
                    <span>{row.goal}</span>
                  </span>
                  <span className="tlist__time">
                    {row.bestTimeSec !== null ? formatSeconds(row.bestTimeSec) : '—'}
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
