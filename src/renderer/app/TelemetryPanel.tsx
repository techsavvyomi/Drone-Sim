import { useEffect, useState, type ReactNode } from 'react';
import { useSimStore } from '../state/simStore';
import { useSettingsStore } from '../state/settingsStore';
import { useFlightStore } from '../state/flightStore';
import { usePhysicsStore } from '../state/physicsStore';
import { useUiStore } from '../state/uiStore';
import { devFpsEnabled } from '../state/shellStore';
import { useWorldStore, TIME_PRESETS, type TimeOfDay } from '../state/worldStore';
import { getDrone } from '../plugins/registry';
import { RAD2DEG } from '../sim/mathx';
import { TelemetryChart } from '../ui/TelemetryChart';
import { SupportDebugWidget } from '../hud/SupportDebugWidget';
import { Icon, Keycap } from '../ds';
import {
  GUST_LEVELS,
  HUD_HZ,
  MOTOR_LABELS,
  clock,
  fixed,
  voltsText,
  compassPoint,
  gustLevel,
  headingDeg,
  headingText,
  usedMah,
  windFacts,
  type GustLevel,
} from '../hud/cockpitFacts';
import {
  attitudeBuffer,
  gyroBuffer,
  motorBuffer,
  powerBuffer,
  startTelemetryFeed,
} from '../state/telemetryFeed';

// The telemetry dock (T), Phase 6: a column on the right that pushes the
// cockpit over rather than covering it. DATA is the numbers, GRAPHS the last
// 6 s of four traces, PHYSICS the world's knobs — each change takes effect on
// the next physics step.

type Tab = 'data' | 'graphs' | 'physics';
const TABS: { id: Tab; label: string }[] = [
  { id: 'data', label: 'Data' },
  { id: 'graphs', label: 'Graphs' },
  { id: 'physics', label: 'Physics' },
];

const DEV = devFpsEnabled();

export function TelemetryPanel() {
  const [tab, setTab] = useState<Tab>('data');

  // One subscription for the dock's lifetime keeps the ring buffers fed.
  useEffect(() => startTelemetryFeed(), []);

  return (
    <aside className="tdock" data-register="cockpit" aria-label="Telemetry">
      <header className="tdock__head">
        <span className="ck-label">Telemetry · {HUD_HZ} Hz</span>
        <button
          type="button"
          className="tdock__close"
          onClick={() => useUiStore.getState().togglePanel()}
        >
          <Keycap>T</Keycap>
          <span className="ck-label">Close</span>
        </button>
      </header>
      <div className="tdock__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'is-on' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tdock__body">
        {tab === 'data' && <DataTab />}
        {tab === 'graphs' && <GraphsTab />}
        {tab === 'physics' && <PhysicsTab />}
        {DEV && (
          <section className="tdock__sec">
            <h3 className="ck-label">Dev · physical support</h3>
            <SupportDebugWidget />
          </section>
        )}
      </div>
    </aside>
  );
}

/** The sim store, re-read at the HUD's rate rather than every frame. */
function useTenHz<T>(pick: () => T): T {
  const [v, setV] = useState(pick);
  useEffect(() => {
    const id = window.setInterval(() => setV(pick()), 1000 / HUD_HZ);
    return () => window.clearInterval(id);
    // `pick` reads stores through getState, so the first one is the only one.
  }, []);
  return v;
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="tdock-cell">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tdock__sec">
      <h3 className="ck-label">{title}</h3>
      {children}
    </section>
  );
}

function DataTab() {
  const capacity = useSettingsStore(
    (s) => getDrone(s.settings.selectedDroneId)?.battery.capacityMah ?? 0,
  );
  const s = useTenHz(() => {
    const t = useSimStore.getState();
    return {
      altitude: t.altitude,
      yaw: t.yaw,
      speed: t.groundSpeed,
      flightTime: t.flightTime,
      roll: t.roll,
      pitch: t.pitch,
      yawRate: t.gyro[1] * RAD2DEG,
      accelZ: t.accel[1] * 9.81,
      soc: t.batterySoc,
      voltage: t.batteryVoltage,
      current: t.batteryCurrent,
      motors: t.motors,
    };
  });

  return (
    <>
      <Section title="Flight">
        <div className="tdock-grid">
          <Cell label="Altitude" value={`${s.altitude.toFixed(2)} m`} />
          <Cell label="Heading" value={`${headingText(headingDeg(s.yaw))}°`} />
          <Cell label="Speed" value={`${fixed(s.speed, 1)} m/s`} />
          <Cell label="Flight time" value={clock(s.flightTime)} />
        </div>
      </Section>
      <Section title="IMU">
        <div className="tdock-grid">
          <Cell label="Roll" value={`${fixed(s.roll * RAD2DEG, 1)}°`} />
          <Cell label="Pitch" value={`${fixed(s.pitch * RAD2DEG, 1)}°`} />
          <Cell label="Yaw rate" value={`${fixed(s.yawRate, 1)} °/s`} />
          <Cell label="Accel Z" value={`${fixed(s.accelZ, 2)} m/s²`} />
        </div>
      </Section>
      <Section title="Power">
        <div className="tdock-grid">
          <Cell label="Battery" value={`${Math.round(s.soc * 100)}%`} />
          <Cell label="Voltage" value={voltsText(s.voltage)} />
          <Cell label="Current" value={`${fixed(s.current, 1)} A`} />
          <Cell label="Used" value={`${usedMah(capacity, s.soc)} mAh`} />
        </div>
      </Section>
      <Section title="Motors">
        <ul className="tdock-motors">
          {MOTOR_LABELS.map((label, i) => {
            const pct = Math.round((s.motors[i] ?? 0) * 100);
            return (
              <li key={label}>
                <span>{label}</span>
                <div className="ck-bar" aria-hidden="true">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <b>{pct}%</b>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

function GraphsTab() {
  return (
    <div className="tdock-traces">
      <TelemetryChart buffer={gyroBuffer} seriesKey="z" title="Gyro · yaw rate" unit=" °/s" minSpan={40} />
      <TelemetryChart buffer={attitudeBuffer} seriesKey="roll" title="Attitude · roll" unit="°" minSpan={20} />
      <TelemetryChart
        buffer={motorBuffer}
        seriesKey="mean"
        title="Motor output · mean"
        unit=""
        digits={2}
        minSpan={1}
      />
      <TelemetryChart buffer={powerBuffer} seriesKey="v" title="Battery" unit=" V" digits={2} minSpan={0.2} />
    </div>
  );
}

/** A row of choices: the selected one filled, with ✓ and weight. */
function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { id: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="tdock-choice" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={value === o.id ? 'is-on' : ''}
          onClick={() => onChange(o.id)}
        >
          {value === o.id && <Icon name="check" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

const ON_OFF = [
  { id: 'on', label: 'On' },
  { id: 'off', label: 'Off' },
] as const;

function Row({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="tdock-row">
      <div className="tdock-row__head">
        <span className="ck-label">{label}</span>
        <b>{value}</b>
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (on: boolean) => void }) {
  return (
    <Row label={label} value={on ? 'On' : 'Off'}>
      <Choice options={ON_OFF} value={on ? 'on' : 'off'} onChange={(v) => set(v === 'on')} />
    </Row>
  );
}

function PhysicsTab() {
  const wind = usePhysicsStore((s) => s.wind);
  const setWind = usePhysicsStore((s) => s.setWind);
  const groundEffect = usePhysicsStore((s) => s.groundEffectEnabled);
  const setGroundEffect = usePhysicsStore((s) => s.setGroundEffect);
  const batterySag = usePhysicsStore((s) => s.batteryEnabled);
  const setBattery = usePhysicsStore((s) => s.setBattery);
  const drift = usePhysicsStore((s) => s.ambientDriftEnabled);
  const setDrift = usePhysicsStore((s) => s.setAmbientDrift);
  const timeOfDay = useWorldStore((s) => s.timeOfDay);
  const setTimeOfDay = useWorldStore((s) => s.setTimeOfDay);
  const clouds = useWorldStore((s) => s.cloudsEnabled);
  const setClouds = useWorldStore((s) => s.setClouds);
  const soc = useTenHz(() => useSimStore.getState().batterySoc);

  const w = windFacts(wind, 0);
  const times = (Object.keys(TIME_PRESETS) as TimeOfDay[]).map((k) => ({
    id: k,
    label: TIME_PRESETS[k].label,
  }));
  const gusts = (Object.keys(GUST_LEVELS) as GustLevel[]).map((g) => ({
    id: g,
    label: g[0].toUpperCase() + g.slice(1),
  }));
  const speed = Math.round(wind.speed * 10) / 10;
  // The sim stores where the wind blows TO; the buttons turn where it comes FROM.
  const turn = (by: number) => setWind('directionDeg', (((wind.directionDeg + by) % 360) + 360) % 360);

  return (
    <>
      <Row label="Time of day" value={TIME_PRESETS[timeOfDay].label}>
        <Choice options={times} value={timeOfDay} onChange={setTimeOfDay} />
      </Row>
      <Toggle label="Clouds" on={clouds} set={setClouds} />
      <Row label="Wind speed" value={`${speed} m/s`}>
        <div className="tdock-pair">
          <button type="button" onClick={() => setWind('speed', Math.max(0, Math.round(wind.speed - 1)))}>
            − 1
          </button>
          <button type="button" onClick={() => setWind('speed', Math.min(12, Math.round(wind.speed + 1)))}>
            + 1
          </button>
        </div>
      </Row>
      <Row label="Wind from" value={compassPoint(w.fromDeg)}>
        <div className="tdock-pair">
          <button type="button" onClick={() => turn(-45)}>
            ‹ Turn
          </button>
          <button type="button" onClick={() => turn(45)}>
            Turn ›
          </button>
        </div>
      </Row>
      <Row label="Gust" value={gusts.find((g) => g.id === gustLevel(wind.gustiness))?.label ?? ''}>
        <Choice
          options={gusts}
          value={gustLevel(wind.gustiness)}
          onChange={(g) => setWind('gustiness', GUST_LEVELS[g])}
        />
      </Row>
      <Toggle label="Ground effect" on={groundEffect} set={setGroundEffect} />
      <Toggle label="Battery sag" on={batterySag} set={setBattery} />
      <Toggle label="Ambient air drift" on={drift} set={setDrift} />
      <Row label="Recharge" value={`${Math.round(soc * 100)}%`}>
        <button
          type="button"
          className="tdock-wide"
          onClick={() => useFlightStore.getState().recharge()}
        >
          Recharge to 100%
        </button>
      </Row>
      <p className="tdock__note">Changes take effect on the next physics step, no restart.</p>
    </>
  );
}
