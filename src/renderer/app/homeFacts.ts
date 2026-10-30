import type { DroneSpec, MissionProgress, TrainingProgress } from '@shared/types';
import type { Lesson } from '../training/lessons/types';
import type { Mission } from '../missions/types';
import { formatMass } from './loadout';
import { formatNumber } from './profileFacts';
import { BEGINNER_CONFIG } from '../sim/control/flightController';

// What Home says, worked out from the game's own records. Pure, so the copy
// rules are testable without a DOM. Every line is a fact about the product or
// the pilot — the brief's names and figures are placeholders and are not used.

/** Where a mode row sends the pilot. */
export type ModeTarget =
  | { kind: 'lesson'; id: string }
  | { kind: 'mission'; id: string }
  | { kind: 'section'; section: 'training' | 'fly' | 'missions' };

export interface ModeRow {
  id: 'continue' | 'training' | 'fly' | 'missions';
  title: string;
  /** The figure on the right of the title ("0 of 15", "8 of 45"). */
  count?: string;
  /** The count is a star total: draw ★ after it. */
  countStars?: boolean;
  line: string;
  target: ModeTarget;
  /** The one signal-filled row in the content area. */
  primary: boolean;
}

export interface HomePlan {
  firstRun: boolean;
  heading: string;
  rows: ModeRow[];
  /** Status bar: bold tag beside the page name, and the context after it. */
  statusTag: string;
  statusContext: string;
}

export interface HomeInput {
  lessons: readonly Lesson[];
  missions: readonly Mission[];
  training: TrainingProgress;
  missionProgress: MissionProgress;
  /** Signed-in pilot's name, when there is one. */
  pilotName?: string | null;
  /** Arena name by id, for the mission lines. */
  envName: (id: string) => string | undefined;
}

/** "New York City, Forest and Supermarket". */
function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The maps the missions are flown on, in mission order, each once. */
export function missionMaps(missions: readonly Mission[], envName: HomeInput['envName']): string[] {
  const seen: string[] = [];
  for (const m of missions) {
    const name = envName(m.envId) ?? m.envId;
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

export function homePlan(input: HomeInput): HomePlan {
  const { lessons, missions, training, missionProgress, envName } = input;
  const lessonDone = (l: Lesson) => !!training.lessons[l.id]?.completed;
  const missionDone = (m: Mission) => !!missionProgress.missions[m.id]?.completed;

  const lessonsDone = lessons.filter(lessonDone).length;
  const missionsDone = missions.filter(missionDone).length;
  const stars = lessons.reduce((sum, l) => sum + (training.lessons[l.id]?.stars ?? 0), 0);
  // The list unlocks in order, so the first unfinished one is the one that is open.
  const nextLessonAt = lessons.findIndex((l) => !lessonDone(l));
  const nextLesson = nextLessonAt >= 0 ? lessons[nextLessonAt] : undefined;
  const nextMissionAt = missions.findIndex((m) => !missionDone(m));
  const nextMission = nextMissionAt >= 0 ? missions[nextMissionAt] : undefined;

  const firstRun = lessonsDone === 0 && missionsDone === 0;
  const maps = missionMaps(missions, envName);
  const missionsLine = `${missions.length} story missions on ${listWords(maps)}.`;
  const first = input.pilotName?.trim().split(/\s+/)[0];

  const flyRow: ModeRow = {
    id: 'fly',
    title: 'Free Flight',
    line: 'No scoring. Any arena, at your own pace.',
    target: { kind: 'section', section: 'fly' },
    primary: false,
  };
  const missionsRow: ModeRow = {
    id: 'missions',
    title: 'Missions',
    count: `${missionsDone} of ${missions.length}`,
    line:
      missionsDone > 0 && nextMission
        ? `Next: Mission ${nextMissionAt + 1}, ${nextMission.name}.`
        : missionsLine,
    target: { kind: 'section', section: 'missions' },
    primary: false,
  };

  if (firstRun) {
    const one = lessons[0];
    const rows: ModeRow[] = [
      {
        id: 'training',
        title: 'Training',
        count: `0 of ${lessons.length}`,
        line: one ? `Start here · Module 1, ${one.title}.` : 'Start here.',
        target: one ? { kind: 'lesson', id: one.id } : { kind: 'section', section: 'training' },
        primary: true,
      },
      flyRow,
      missionsRow,
    ];
    return {
      firstRun,
      heading: 'New pilot? Start with Training.',
      rows,
      statusTag: 'New pilot',
      statusContext: `Start with Module 1 of ${lessons.length}`,
    };
  }

  const trainingRow: ModeRow = {
    id: 'training',
    title: 'Training',
    count: `${stars} of ${lessons.length * 3}`,
    countStars: true,
    line: `All ${lessons.length} lessons. Replay any to earn more stars.`,
    target: { kind: 'section', section: 'training' },
    primary: false,
  };

  // The name goes on the line, not the title: beside the count, "Continue:
  // Module 10 — Square Circuit using Yaw" took three lines of the 290–380 px
  // column and clipped the row at 1280 × 720. A no-break space keeps the
  // number with its word when the title wraps beside the count.
  let cont: ModeRow | null = null;
  let statusContext: string;
  if (nextLesson) {
    cont = {
      id: 'continue',
      title: `Continue: Module\u00a0${nextLessonAt + 1}`,
      count: `${lessonsDone} of ${lessons.length}`,
      line: `${nextLesson.title} · ${nextLesson.subtitle}.`,
      target: { kind: 'lesson', id: nextLesson.id },
      primary: true,
    };
    statusContext = `Next: Module ${nextLessonAt + 1} of ${lessons.length} · ${nextLesson.title}`;
  } else if (nextMission) {
    cont = {
      id: 'continue',
      title: `Continue: Mission\u00a0${nextMissionAt + 1}`,
      count: `${missionsDone} of ${missions.length}`,
      line: `${nextMission.name} · ${envName(nextMission.envId) ?? nextMission.envId}.`,
      target: { kind: 'mission', id: nextMission.id },
      primary: true,
    };
    statusContext = `Next: Mission ${nextMissionAt + 1} of ${missions.length} · ${nextMission.name}`;
  } else {
    statusContext = `Every module and mission flown`;
  }

  const rows = cont
    ? [cont, trainingRow, flyRow, missionsRow]
    : [trainingRow, { ...flyRow, primary: true }, missionsRow];

  return {
    firstRun,
    heading: first ? `Welcome back, ${first}` : 'Welcome back',
    rows,
    statusTag: '',
    statusContext,
  };
}

/** The spec column: four facts, all from the plugin. There is no flight-time
 *  figure in the game, so the brief's "Flight time" row is Battery instead. */
export function homeDroneFacts(d: DroneSpec): { label: string; value: string }[] {
  const props = Math.round(d.propDiameterIn * 25.4);
  const kv = d.motors[0]?.kv;
  return [
    { label: 'Mass', value: formatMass(d.mass) },
    { label: 'Motors', value: kv ? `${d.motors.length} × ${formatNumber(kv)} kv` : `${d.motors.length}` },
    { label: 'Props', value: `${props} mm, ${d.propBlades ?? 2}-blade` },
    { label: 'Battery', value: `${d.battery.cells}S · ${formatNumber(d.battery.capacityMah)} mAh` },
  ];
}

/** One honest handling line, starting with the mass:
 *  "54 g. Tilts 22° at full stick, tops out at 8 m/s." */
export function handlingLine(d: DroneSpec): string {
  const tilt = d.handling?.maxTiltDeg ?? BEGINNER_CONFIG.maxTiltDeg;
  return `${formatMass(d.mass)}. Tilts ${tilt}° at full stick, tops out at ${d.maxSpeed} m/s.`;
}
