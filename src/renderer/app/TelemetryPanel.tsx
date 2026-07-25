import { useEffect, useState } from 'react';
import { useSimStore } from '../state/simStore';
import { useSettingsStore } from '../state/settingsStore';
import { useFlightStore } from '../state/flightStore';
import { usePhysicsStore } from '../state/physicsStore';
import { useWorldStore, TIME_PRESETS, type TimeOfDay } from '../state/worldStore';
import { getDrone } from '../plugins/registry';
import { RAD2DEG } from '../sim/mathx';
import { TelemetryChart } from '../ui/TelemetryChart';
import {
  attitudeBuffer,
  gyroBuffer,
  motorBuffer,
  powerBuffer,
  startTelemetryFeed,
} from '../state/telemetryFeed';

type Tab = 'data' | 'graphs' | 'physics';

export function TelemetryPanel() {
  const [tab, setTab] = useState<Tab>('data');

  // One subscription for the panel's lifetime keeps the ring buffers fed.
  useEffect(() => startTelemetryFeed(), []);

  return (
    <aside className="panel">
      <div className="panel-tabs">
        {(['data', 'graphs', 'physics'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'data' && <DataTab />}
      {tab === 'graphs' && <GraphsTab />}
      {tab === 'physics' && <PhysicsTab />}
    </aside>
  );
}

function DataTab() {
  const { settings } = useSettingsStore();
  const drone = getDrone(settings.selectedDroneId);

  const altitude = useSimStore((s) => s.altitude);
  const groundSpeed = useSimStore((s) => s.groundSpeed);
  const verticalSpeed = useSimStore((s) => s.verticalSpeed);
  const roll = useSimStore((s) => s.roll);
  const pitch = useSimStore((s) => s.pitch);
  const throttle = useSimStore((s) => s.throttle);
  const motors = useSimStore((s) => s.motors);
  const gyro = useSimStore((s) => s.gyro);
  const accel = useSimStore((s) => s.accel);
  const voltage = useSimStore((s) => s.batteryVoltage);
  const current = useSimStore((s) => s.batteryCurrent);
  const soc = useSimStore((s) => s.batterySoc);
  const armed = useFlightStore((s) => s.armed);
  const mode = useFlightStore((s) => s.mode);

  return (
    <>
      <section className="panel-section">
        <div className="kv">
          <span>Drone</span>
          <b>{drone?.name ?? '—'}</b>
        </div>
        <div className="kv">
          <span>Armed</span>
          <b style={{ color: armed ? 'var(--good)' : 'var(--text-dim)' }}>
            {armed ? 'ARMED' : 'DISARMED'}
          </b>
        </div>
        <div className="kv">
          <span>Mode</span>
          <b style={{ textTransform: 'capitalize' }}>{mode.replace('-', ' ')}</b>
        </div>
      </section>

      <section className="panel-section">
        <h3 className="panel-subtitle">Flight</h3>
        <Kv label="Altitude" value={`${altitude.toFixed(2)} m`} />
        <Kv label="Ground speed" value={`${groundSpeed.toFixed(2)} m/s`} />
        <Kv label="Vertical speed" value={`${verticalSpeed.toFixed(2)} m/s`} />
        <Kv label="Roll / Pitch" value={`${(roll * RAD2DEG).toFixed(0)}° / ${(pitch * RAD2DEG).toFixed(0)}°`} />
        <Kv label="Throttle" value={`${Math.round(throttle * 100)}%`} />
      </section>

      <section className="panel-section">
        <h3 className="panel-subtitle">IMU</h3>
        <Kv label="Gyro X/Y/Z" value={gyro.map((g) => g.toFixed(1)).join(' / ')} />
        <Kv label="Accel (body up)" value={`${accel[1].toFixed(2)} g`} />
      </section>

      <section className="panel-section">
        <h3 className="panel-subtitle">Power</h3>
        <Kv label="Voltage" value={`${voltage.toFixed(2)} V`} />
        <Kv label="Current" value={`${current.toFixed(2)} A`} />
        <Kv label="Charge" value={`${Math.round(soc * 100)} %`} />
      </section>

      <section className="panel-section">
        <h3 className="panel-subtitle">Motors</h3>
        <div className="motor-bars">
          {motors.map((m, i) => (
            <div className="motor-bar" key={i}>
              <div className="motor-fill" style={{ height: `${Math.round(m * 100)}%` }} />
              <span>{['FR', 'FL', 'BR', 'BL'][i]}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function GraphsTab() {
  return (
    <div className="charts">
      <TelemetryChart buffer={gyroBuffer} title="Gyro (rad/s)" />
      <TelemetryChart buffer={attitudeBuffer} title="Attitude (deg)" />
      <TelemetryChart buffer={motorBuffer} title="Motor output" range={[0, 1]} />
      <TelemetryChart buffer={powerBuffer} title="Battery V / A" />
    </div>
  );
}

function PhysicsTab() {
  const wind = usePhysicsStore((s) => s.wind);
  const setWind = usePhysicsStore((s) => s.setWind);
  const groundEffectEnabled = usePhysicsStore((s) => s.groundEffectEnabled);
  const setGroundEffect = usePhysicsStore((s) => s.setGroundEffect);
  const batteryEnabled = usePhysicsStore((s) => s.batteryEnabled);
  const setBattery = usePhysicsStore((s) => s.setBattery);
  const ambientDrift = usePhysicsStore((s) => s.ambientDriftEnabled);
  const setAmbientDrift = usePhysicsStore((s) => s.setAmbientDrift);

  const timeOfDay = useWorldStore((s) => s.timeOfDay);
  const setTimeOfDay = useWorldStore((s) => s.setTimeOfDay);
  const clouds = useWorldStore((s) => s.cloudsEnabled);
  const setClouds = useWorldStore((s) => s.setClouds);

  return (
    <>
      <section className="panel-section">
        <h3 className="panel-subtitle">Time of day</h3>
        <div className="tod-grid">
          {(Object.keys(TIME_PRESETS) as TimeOfDay[]).map((k) => (
            <button
              key={k}
              className={timeOfDay === k ? 'active' : ''}
              onClick={() => setTimeOfDay(k)}
            >
              {TIME_PRESETS[k].label}
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={clouds} onChange={(e) => setClouds(e.target.checked)} />
          <span>Clouds</span>
        </label>
      </section>

      <section className="panel-section">
        <h3 className="panel-subtitle">Wind</h3>
        <Slider
          label="Speed"
          value={wind.speed}
          min={0}
          max={12}
          step={0.1}
          unit="m/s"
          onChange={(v) => setWind('speed', v)}
        />
        <Slider
          label="Direction"
          value={wind.directionDeg}
          min={0}
          max={359}
          step={1}
          unit="°"
          onChange={(v) => setWind('directionDeg', v)}
        />
        <Slider
          label="Gustiness"
          value={wind.gustiness}
          min={0}
          max={1}
          step={0.05}
          unit=""
          onChange={(v) => setWind('gustiness', v)}
        />
      </section>

      <section className="panel-section">
        <h3 className="panel-subtitle">Effects</h3>
        <label className="toggle">
          <input
            type="checkbox"
            checked={groundEffectEnabled}
            onChange={(e) => setGroundEffect(e.target.checked)}
          />
          <span>Ground effect</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={batteryEnabled}
            onChange={(e) => setBattery(e.target.checked)}
          />
          <span>Battery sag</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={ambientDrift}
            onChange={(e) => setAmbientDrift(e.target.checked)}
          />
          <span>Ambient air drift</span>
        </label>
      </section>

      <section className="panel-section">
        <h3 className="panel-subtitle">Battery</h3>
        <button className="recharge-btn" onClick={() => useFlightStore.getState().recharge()}>
          Recharge pack
        </button>
      </section>

      <p className="panel-note">Changes take effect on the next physics step — no restart.</p>
    </>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="slider-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <b>
        {value.toFixed(step < 1 ? 1 : 0)}
        {unit}
      </b>
    </div>
  );
}
