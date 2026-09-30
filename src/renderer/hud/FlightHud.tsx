import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { useUiStore, type CameraMode } from '../state/uiStore';
import { useSettingsStore } from '../state/settingsStore';
import { usePhysicsStore } from '../state/physicsStore';
import { devFpsEnabled } from '../state/shellStore';
import { getDrone, getEnvironment } from '../plugins/registry';
import { ceilingFor } from '../app/loadout';
import { resetFlight } from '../input/controls';
import { chaseReport, PULL_IN_NOTICE } from '../scene/cameraReport';
import { RAD2DEG } from '../sim/mathx';
import { Icon, Keycap } from '../ds';
import { CrashCard, PauseCard } from './FlightCards';
import {
  HUD_HZ,
  WAKE_CODES,
  batteryFacts,
  clock,
  flightModeLine,
  headingDeg,
  headingText,
  isQuiet,
  minutesLeft,
  motorsFacts,
  nearCeiling,
  ribbonTicks,
  windFacts,
  type Tone,
} from './cockpitFacts';

// ----------------------------------------------------------------------------
// The Free Flight cockpit (Phase 6, cockpit register). One instrument cluster
// over the live canvas: every readout on an opaque ink-950 plate with a
// hairline, never bare text over the world, so it reads the same over a bright
// sky and a night city. Readouts are sampled at 10 Hz — the brief's rate, and
// one React render a tenth of a second instead of one per frame.
//
// After 3 s of steady flight it goes quiet: one bar on the bottom edge. A
// warning brings its own instrument back in its own place; the mouse, H, T, C
// and Esc bring everything back. Flying keys do not.
// ----------------------------------------------------------------------------

interface Sample {
  altitude: number;
  verticalSpeed: number;
  roll: number;
  pitch: number;
  yaw: number;
  soc: number;
  voltage: number;
  flightTime: number;
  fps: number;
  sticks: { roll: number; pitch: number; yaw: number; throttle: number };
  pulledIn: number;
  pullDistance: number;
}

function read(): Sample {
  const s = useSimStore.getState();
  return {
    altitude: s.altitude,
    verticalSpeed: s.verticalSpeed,
    roll: s.roll,
    pitch: s.pitch,
    yaw: s.yaw,
    soc: s.batterySoc,
    voltage: s.batteryVoltage,
    flightTime: s.flightTime,
    fps: s.fps,
    sticks: s.sticks,
    pulledIn: chaseReport.pulledIn,
    pullDistance: chaseReport.distance,
  };
}

/** The sim's numbers, re-read `HUD_HZ` times a second. */
function useSample(): Sample {
  const [sample, setSample] = useState(read);
  useEffect(() => {
    const id = window.setInterval(() => setSample(read()), 1000 / HUD_HZ);
    return () => window.clearInterval(id);
  }, []);
  return sample;
}

const DEV_FPS = devFpsEnabled();

const CAMERAS: { mode: CameraMode; name: string; note: string }[] = [
  { mode: 'fpv', name: 'FPV', note: 'Nose camera. Crosshair on.' },
  {
    mode: 'chase',
    name: 'Chase',
    note: 'Behind and above. Pulls in when something comes between it and the drone.',
  },
  { mode: 'orbit', name: 'Orbit', note: 'Circles the drone. Drag to turn it.' },
];

/** "+4°", "−2°" — a real minus sign, and no "−0°". */
function signedDeg(rad: number): string {
  const d = Math.round(rad * RAD2DEG);
  return d > 0 ? `+${d}°` : d < 0 ? `−${-d}°` : '0°';
}

function signed(v: number): string {
  const r = Math.round(v * 10) / 10;
  return r > 0 ? `+${r.toFixed(1)}` : r < 0 ? `−${(-r).toFixed(1)}` : '0.0';
}

export function FlightHud() {
  const s = useSample();

  const armed = useFlightStore((f) => f.armed);
  const crashed = useFlightStore((f) => f.crashed);
  const paused = useFlightStore((f) => f.paused);
  const auto = useFlightStore((f) => f.auto);
  const mode = useFlightStore((f) => f.mode);
  const onGround = useFlightStore((f) => f.onGround);
  const batteryWarning = useFlightStore((f) => f.batteryWarning);
  const lowBattery = useFlightStore((f) => f.lowBattery);
  const batteryLocked = useFlightStore((f) => f.batteryLocked);

  const cameraMode = useUiStore((u) => u.cameraMode);
  const dockOpen = useUiStore((u) => u.panelOpen);
  const hudPanelOpen = useUiStore((u) => u.hudPanelOpen);
  const wind = usePhysicsStore((p) => p.wind);

  const hud = useSettingsStore((st) => st.settings.hud);
  const droneId = useSettingsStore((st) => st.settings.selectedDroneId);
  const envId = useSettingsStore((st) => st.settings.selectedEnvironmentId);
  const drone = getDrone(droneId);
  const env = getEnvironment(envId);
  const ceiling = ceilingFor(drone, env).metres;

  const [camMenu, setCamMenu] = useState(false);

  // ---- Quiet in flight: seconds since the last wake, or since lift-off.
  const lastWake = useRef(performance.now());
  useEffect(() => {
    const wake = () => {
      lastWake.current = performance.now();
    };
    const onKey = (e: KeyboardEvent) => {
      if (WAKE_CODES.has(e.code)) wake();
    };
    window.addEventListener('mousemove', wake);
    window.addEventListener('mousedown', wake);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('mousedown', wake);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);
  const airborne = armed && !onGround;
  // Anything open over the cockpit holds the count too, so closing the dock or
  // resuming from pause shows the full HUD for 3 s before it folds again.
  const covered = dockOpen || hudPanelOpen || camMenu || paused || crashed;
  if (!airborne || covered) lastWake.current = performance.now();

  // ---- Minutes left: the average drain since the pack was last full. A reset
  // (the clock goes back) or a recharge (the charge goes up) starts it again.
  const base = useRef({ soc: s.soc, t: s.flightTime });
  if (s.flightTime < base.current.t || s.soc > base.current.soc + 0.005) {
    base.current = { soc: s.soc, t: s.flightTime };
  }
  const mins = minutesLeft(base.current.soc, s.soc, s.flightTime - base.current.t);

  const heading = headingDeg(s.yaw);
  const battery = batteryFacts({
    soc: s.soc,
    voltage: s.voltage,
    minutesLeft: mins,
    warning: batteryWarning,
    critical: lowBattery,
    empty: batteryLocked,
  });
  const motors = motorsFacts({ armed, crashed, auto });
  const ceilingNear = nearCeiling(s.altitude, ceiling);
  const quiet = isQuiet({
    enabled: hud.quiet,
    armed,
    airborne,
    covered,
    sinceWake: (performance.now() - lastWake.current) / 1000,
  });

  const arenaName = env?.name ?? 'Arena';
  const pauseContext = {
    kind: 'free' as const,
    arena: arenaName,
    drone: drone?.name ?? 'Drone',
    flownSec: s.flightTime,
  };

  // Exit Menu ends the flight: back on the pad, disarmed, unpaused (all of R).
  // Left armed, the motors' last output stayed in the stores.
  const exit = () => {
    const ui = useUiStore.getState();
    resetFlight();
    ui.closePanels();
    ui.setSection('home');
  };

  return (
    <div className="cockpit" data-register="cockpit" data-quiet={quiet || undefined}>
      {!quiet && (
        <>
          {/* ---- Top row ---- */}
          <div className="ck-top-left">
            {hud.cameraInfo && (
              <CameraChip mode={cameraMode} open={camMenu} setOpen={setCamMenu} />
            )}
            {cameraMode === 'chase' && s.pulledIn > PULL_IN_NOTICE && (
              <div className="ck-plate ck-pulled" role="status">
                <Icon name="warning" />
                <span>
                  Chase pulled in to {s.pullDistance.toFixed(1)} m · something behind
                </span>
              </div>
            )}
          </div>

          {(hud.compass || hud.wind) && (
            <div className="ck-top-centre">
              {hud.compass && <HeadingRibbon heading={heading} />}
              {hud.wind && <WindLine wind={wind} heading={heading} />}
            </div>
          )}

          <div className="ck-plate ck-context">
            <span className="ck-label">Free Flight · {arenaName}</span>
            <b>{clock(s.flightTime)}</b>
          </div>
        </>
      )}

      {/* ---- Left: altitude + attitude. In quiet flight the tape comes back
          on its own within 0.5 m of the ceiling. ---- */}
      {(quiet ? ceilingNear && hud.altitudeTape : hud.altitudeTape || hud.horizon) && (
        <div className="ck-plate ck-left">
          {hud.altitudeTape && (
            <AltitudeTape
              altitude={s.altitude}
              verticalSpeed={s.verticalSpeed}
              ceiling={ceiling}
              near={ceilingNear}
            />
          )}
          {!quiet && hud.horizon && <Attitude roll={s.roll} pitch={s.pitch} />}
        </div>
      )}

      {/* ---- Right: motors, mode, battery. Quiet brings the battery back
          under 20 %. ---- */}
      {(quiet ? battery.warn && hud.battery : hud.status || hud.flightMode || hud.battery) && (
        <div className="ck-plate ck-right">
          {!quiet && hud.status && (
            <section className="ck-sec">
              <span className="ck-label">Motors</span>
              <MotorsBadge tone={motors.tone} word={motors.word} />
            </section>
          )}
          {!quiet && hud.flightMode && (
            <section className="ck-sec">
              <span className="ck-label">Flight mode</span>
              <b className="ck-mode">{flightModeLine(mode)}</b>
            </section>
          )}
          {hud.battery && (
            <section className="ck-sec ck-batt" data-tone={battery.tone}>
              <div className="ck-batt__head">
                <span className="ck-label">Battery</span>
                {battery.note && (
                  <span className="ck-label ck-batt__note">
                    {battery.tone === 'neutral' ? (
                      <Icon name="dot" />
                    ) : battery.tone === 'fail' ? (
                      <Icon name="cross" />
                    ) : (
                      <Icon name="warning" />
                    )}
                    {battery.note}
                  </span>
                )}
              </div>
              <div className="ck-batt__nums">
                <b>{battery.pct}%</b>
                <span>{battery.volts}</span>
              </div>
              <div className="ck-bar" aria-hidden="true">
                <i style={{ width: `${battery.pct}%` }} />
              </div>
            </section>
          )}
        </div>
      )}

      {hud.crosshair && cameraMode === 'fpv' && <div className="ck-crosshair" aria-hidden="true" />}

      {quiet ? (
        <QuietBar
          armedWord={motors.word}
          altitude={ceilingNear && hud.altitudeTape ? null : s.altitude}
          heading={heading}
          battery={battery.warn && hud.battery ? null : battery.pct}
        />
      ) : (
        <>
          {hud.sticks && <Sticks sticks={s.sticks} />}
          {(hud.keyBar || DEV_FPS) && (
            <KeyBar dockOpen={dockOpen} hudOpen={hudPanelOpen} fps={DEV_FPS ? s.fps : null} showKeys={hud.keyBar} />
          )}
        </>
      )}

      <CrashCard
        context={`Free Flight · ${arenaName} · ${drone?.name ?? 'Drone'}`}
        when={clock(useFlightStore.getState().crashAt?.flightTime ?? s.flightTime)}
        onReset={resetFlight}
      />
      <PauseCard
        context={pauseContext}
        onRestart={resetFlight}
        onSettings={() => {
          useFlightStore.getState().togglePause();
          useUiStore.getState().closePanels();
          useUiStore.getState().setSection('settings');
        }}
        onExit={exit}
      />
    </div>
  );
}

// ---- Parts -------------------------------------------------------------------

function CameraChip({
  mode,
  open,
  setOpen,
}: {
  mode: CameraMode;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const current = CAMERAS.find((c) => c.mode === mode) ?? CAMERAS[1];
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const items = listRef.current?.querySelectorAll<HTMLButtonElement>('button');
    const i = CAMERAS.findIndex((c) => c.mode === mode);
    items?.[Math.max(i, 0)]?.focus({ preventScroll: true });
    // A click anywhere else closes it.
    const close = (e: MouseEvent) => {
      if (!listRef.current?.parentElement?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
    // Focus the current row once, when the menu opens.
  }, [open]);

  const pick = (m: CameraMode) => {
    useUiStore.getState().setCameraMode(m);
    setOpen(false);
  };

  // The menu's own keys; stopped here so they neither fly the drone (the
  // arrows) nor pause it (Esc).
  const onKey = (e: ReactKeyboardEvent) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      items[(at + d + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation();
    }
  };

  return (
    <div className="ck-cam">
      <button
        type="button"
        className="ck-plate ck-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Keycap>C</Keycap>
        <span className="ck-label">Cam</span>
        <b>{current.name}</b>
        <Icon name={open ? 'caret-up' : 'caret-down'} />
      </button>
      {open && (
        <ul ref={listRef} className="ck-plate ck-menu" role="menu" onKeyDown={onKey}>
          {CAMERAS.map((c) => (
            <li key={c.mode}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={c.mode === mode}
                className={c.mode === mode ? 'is-on' : ''}
                onClick={() => pick(c.mode)}
              >
                <span className="ck-menu__mark">{c.mode === mode && <Icon name="check" />}</span>
                <span>
                  <b>{c.name}</b>
                  <small>{c.note}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HeadingRibbon({ heading }: { heading: number }) {
  const ticks = ribbonTicks(heading);
  return (
    <div className="ck-plate ck-ribbon" role="img" aria-label={`Heading ${headingText(heading)}`}>
      <div className="ck-ribbon__scale">
        {ticks.map((t) => (
          <span
            key={t.deg}
            className={`ck-tick${t.label ? ' ck-tick--major' : ''}`}
            style={{ left: `${50 + t.at * 50}%` }}
          >
            {t.label && Math.abs(t.at) > 0.18 && Math.abs(t.at) < 0.85 && <em>{t.label}</em>}
          </span>
        ))}
      </div>
      <b className="ck-ribbon__value">{headingText(heading)}</b>
    </div>
  );
}

function WindLine({
  wind,
  heading,
}: {
  wind: { speed: number; directionDeg: number; gustiness: number };
  heading: number;
}) {
  const w = windFacts(wind, heading);
  return (
    <div className="ck-plate ck-wind">
      <span className="ck-label">Wind</span>
      {!w.calm && (
        <svg viewBox="0 0 12 12" className="ck-wind__arrow" aria-hidden="true">
          <g transform={`rotate(${w.arrowDeg} 6 6)`}>
            <path d="M6 10.5V2M3 5l3-3 3 3" />
          </g>
        </svg>
      )}
      <b>{w.line}</b>
    </div>
  );
}

const TAPE_H = 196;
const TAPE_W = 64;
const PX_PER_M = 44;

function AltitudeTape({
  altitude,
  verticalSpeed,
  ceiling,
  near,
}: {
  altitude: number;
  verticalSpeed: number;
  ceiling: number;
  near: boolean;
}) {
  const mid = TAPE_H / 2;
  const y = (m: number) => mid - (m - altitude) * PX_PER_M;
  const span = TAPE_H / PX_PER_M / 2;
  const ticks: number[] = [];
  for (let m = Math.ceil((altitude - span) * 2) / 2; m <= altitude + span; m += 0.5) {
    if (m >= 0) ticks.push(m);
  }
  const cy = y(ceiling);
  return (
    <div className="ck-alt" data-near={near || undefined}>
      <span className="ck-label">Alt</span>
      <svg viewBox={`0 0 ${TAPE_W} ${TAPE_H}`} width={TAPE_W} height={TAPE_H} className="ck-tape">
        {ticks.map((m) => {
          const major = Number.isInteger(m);
          return (
            <g key={m} className={major ? 'ck-tape__major' : 'ck-tape__minor'}>
              <line x1={4} x2={major ? 16 : 10} y1={y(m)} y2={y(m)} />
              {major && (
                <text x={20} y={y(m) + 4}>
                  {m}
                </text>
              )}
            </g>
          );
        })}
        {cy > -8 && cy < TAPE_H + 8 && (
          <g className="ck-tape__ceiling">
            <line x1={2} x2={TAPE_W - 2} y1={cy} y2={cy} />
            <path d={`M${TAPE_W - 14} ${cy - 3} l4 -7 l4 7 z`} />
            <text x={TAPE_W - 17} y={cy - 4} textAnchor="end">
              {Math.round(ceiling * 10) / 10}
            </text>
          </g>
        )}
        <rect className="ck-tape__box" x={2} y={mid - 11} width={TAPE_W - 4} height={22} rx={5} />
        <text className="ck-tape__value" x={TAPE_W / 2} y={mid + 4.5} textAnchor="middle">
          {altitude.toFixed(2)} m
        </text>
      </svg>
      <span className="ck-caption">
        {near && <Icon name="warning" />}
        {near ? 'Ceiling · ' : ''}VS {signed(verticalSpeed)} m/s
      </span>
    </div>
  );
}

function Attitude({ roll, pitch }: { roll: number; pitch: number }) {
  const r = -roll * RAD2DEG;
  const p = Math.max(-40, Math.min(40, pitch * RAD2DEG)) * 1.4;
  return (
    <div className="ck-att">
      <span className="ck-label">Attitude</span>
      <svg viewBox="0 0 120 120" width={120} height={120} className="ck-adi" aria-hidden="true">
        <defs>
          <clipPath id="ck-adi-clip">
            <circle cx="60" cy="60" r="56" />
          </clipPath>
        </defs>
        <g clipPath="url(#ck-adi-clip)">
          <g transform={`rotate(${r} 60 60) translate(0 ${p})`}>
            <rect className="ck-adi__sky" x="-60" y="-120" width="240" height="180" />
            <rect className="ck-adi__ground" x="-60" y="60" width="240" height="180" />
            <line className="ck-adi__horizon" x1="-60" x2="180" y1="60" y2="60" />
            {[-20, -10, 10, 20].map((d) => (
              <line
                key={d}
                className="ck-adi__ladder"
                x1={Math.abs(d) === 10 ? 48 : 42}
                x2={Math.abs(d) === 10 ? 72 : 78}
                y1={60 - d * 1.4}
                y2={60 - d * 1.4}
              />
            ))}
          </g>
        </g>
        <circle className="ck-adi__rim" cx="60" cy="60" r="56" />
        <g className="ck-adi__plane">
          <path d="M28 60h20l4 4M92 60H72l-4 4" />
          <circle cx="60" cy="60" r="2.5" />
        </g>
      </svg>
      <span className="ck-caption">
        R {signedDeg(roll)} · P {signedDeg(pitch)}
      </span>
    </div>
  );
}

function MotorsBadge({ tone, word }: { tone: Tone; word: string }) {
  return (
    <span className="ck-motors" data-tone={tone}>
      {tone === 'fail' ? <Icon name="cross" /> : tone === 'armed' ? <Icon name="dot" /> : <Icon name="ring" />}
      <span>{word}</span>
    </span>
  );
}

function Sticks({ sticks }: { sticks: Sample['sticks'] }) {
  return (
    <>
      <Gimbal side="left" label="Throttle · Yaw" x={sticks.yaw} y={sticks.throttle * 2 - 1} />
      <Gimbal side="right" label="Pitch · Roll" x={sticks.roll} y={sticks.pitch} />
    </>
  );
}

function Gimbal({ side, label, x, y }: { side: 'left' | 'right'; label: string; x: number; y: number }) {
  const cx = 40 + Math.max(-1, Math.min(1, x)) * 26;
  const cy = 40 - Math.max(-1, Math.min(1, y)) * 26;
  return (
    <div className={`ck-plate ck-stick ck-stick--${side}`}>
      <svg viewBox="0 0 80 80" width={80} height={80} aria-hidden="true">
        <circle className="ck-stick__well" cx="40" cy="40" r="36" />
        <path className="ck-stick__cross" d="M40 12v56M12 40h56" />
        <circle className="ck-stick__knob" cx={cx} cy={cy} r="7" />
      </svg>
      <span className="ck-label">{label}</span>
    </div>
  );
}

function KeyBar({
  dockOpen,
  hudOpen,
  fps,
  showKeys,
}: {
  dockOpen: boolean;
  hudOpen: boolean;
  fps: number | null;
  showKeys: boolean;
}) {
  const ui = useUiStore.getState;
  return (
    <div className="ck-plate ck-keybar">
      {showKeys && (
        <>
          <button type="button" className={dockOpen ? 'is-on' : ''} onClick={() => ui().togglePanel()}>
            <Keycap>T</Keycap>
            <span className="ck-label">Telemetry</span>
          </button>
          <button type="button" className={hudOpen ? 'is-on' : ''} onClick={() => ui().toggleHudPanel()}>
            <Keycap>H</Keycap>
            <span className="ck-label">HUD</span>
          </button>
          <button type="button" onClick={() => useFlightStore.getState().togglePause()}>
            <Keycap>Esc</Keycap>
            <span className="ck-label">Pause</span>
          </button>
        </>
      )}
      {fps !== null && <span className="ck-label ck-dev">Dev · {fps} FPS</span>}
    </div>
  );
}

function QuietBar({
  armedWord,
  altitude,
  heading,
  battery,
}: {
  armedWord: string;
  altitude: number | null;
  heading: number;
  battery: number | null;
}) {
  return (
    <div className="ck-quiet" role="status">
      <span>
        <span className="ck-label">Motors</span>
        <Icon name="dot" />
        <b>{armedWord}</b>
      </span>
      {altitude !== null && (
        <span>
          <span className="ck-label">Alt</span>
          <b>{altitude.toFixed(1)} m</b>
        </span>
      )}
      <span>
        <span className="ck-label">Hdg</span>
        <b>{headingText(heading)}</b>
      </span>
      {battery !== null && (
        <span>
          <span className="ck-label">Batt</span>
          <b>{battery}%</b>
        </span>
      )}
      <button type="button" onClick={() => useUiStore.getState().toggleHudPanel()}>
        <Keycap>H</Keycap>
        <span className="ck-label">Full HUD</span>
      </button>
    </div>
  );
}
