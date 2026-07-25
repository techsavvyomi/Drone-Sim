import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { useUiStore } from '../state/uiStore';
import { useSettingsStore } from '../state/settingsStore';
import { ArtificialHorizon } from './ArtificialHorizon';
import { Compass } from './Compass';
import { AltitudeTape } from './AltitudeTape';
import { StickIndicator } from './StickIndicator';
import { ControlsPanel } from './ControlsPanel';
import { CrashOverlay } from './CrashOverlay';
import { PauseOverlay } from './PauseOverlay';
import { getDrone } from '../plugins/registry';
import { RAD2DEG } from '../sim/mathx';

function heading(yaw: number): number {
  const h = (-yaw * RAD2DEG) % 360;
  return Math.round((h + 360) % 360);
}

function clockTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const MODE_LABEL: Record<string, string> = {
  stabilize: 'Stabilize',
  'altitude-hold': 'Alt Hold',
  acro: 'Acro',
};

export function FlightHud() {
  const altitude = useSimStore((s) => s.altitude);
  const groundSpeed = useSimStore((s) => s.groundSpeed);
  const verticalSpeed = useSimStore((s) => s.verticalSpeed);
  const roll = useSimStore((s) => s.roll);
  const pitch = useSimStore((s) => s.pitch);
  const yaw = useSimStore((s) => s.yaw);
  const throttle = useSimStore((s) => s.throttle);
  const fps = useSimStore((s) => s.fps);
  const voltage = useSimStore((s) => s.batteryVoltage);
  const soc = useSimStore((s) => s.batterySoc);
  const flightTime = useSimStore((s) => s.flightTime);

  const armed = useFlightStore((s) => s.armed);
  const mode = useFlightStore((s) => s.mode);
  const auto = useFlightStore((s) => s.auto);
  const lowBattery = useFlightStore((s) => s.lowBattery);
  const batteryWarning = useFlightStore((s) => s.batteryWarning);
  const batteryLocked = useFlightStore((s) => s.batteryLocked);
  const cameraMode = useUiStore((s) => s.cameraMode);

  const settings = useSettingsStore((s) => s.settings);
  const hud = settings.hud;
  const ceiling = getDrone(settings.selectedDroneId)?.maxAltitude ?? 20;
  const nearCeiling = altitude >= ceiling - 2;

  const socPct = Math.round(soc * 100);
  // Voltage-driven, matching the 3.5 V warning / 3.3 V critical thresholds.
  const battClass = lowBattery || batteryLocked ? 'crit flash' : batteryWarning ? 'warn flash' : '';

  return (
    <div className="hud">
      <div className="hud-left">
        {hud.altitudeTape && (
          <AltitudeTape altitude={altitude} verticalSpeed={verticalSpeed} ceiling={ceiling} />
        )}
        {hud.horizon && <ArtificialHorizon roll={roll} pitch={pitch} />}
        {hud.instruments && (
          <div className="hud-instruments">
            <Inst label="SPD" value={groundSpeed.toFixed(1)} unit="m/s" />
            <Inst
              label="VSI"
              value={(verticalSpeed >= 0 ? '+' : '') + verticalSpeed.toFixed(1)}
              unit="m/s"
            />
            <Inst label="HDG" value={heading(yaw).toString().padStart(3, '0')} unit="°" />
          </div>
        )}
      </div>

      {hud.compass && (
        <div className="hud-compass">
          <Compass yaw={yaw} />
        </div>
      )}

      <div className="hud-right">
        {hud.status && (
          <>
            <div className={`status-badge ${armed ? 'armed' : ''}`}>
              {armed ? (auto !== 'manual' ? auto.toUpperCase() : 'ARMED') : 'DISARMED'}
            </div>
            <div className="mode-badge">{MODE_LABEL[mode] ?? mode}</div>
          </>
        )}

        {hud.battery && (
          <div className={`batt ${battClass}`}>
            <div className="batt-bar">
              <div className="batt-fill" style={{ width: `${socPct}%` }} />
            </div>
            <span>
              {socPct}% · {voltage.toFixed(2)}V
            </span>
          </div>
        )}

        {hud.throttle && (
          <div className="throttle">
            <div className="throttle-track">
              <div className="throttle-fill" style={{ height: `${Math.round(throttle * 100)}%` }} />
            </div>
            <span>{Math.round(throttle * 100)}%</span>
          </div>
        )}

        {hud.cameraInfo && (
          <>
            <div className="cam-badge">CAM · {cameraMode.toUpperCase()}</div>
            <div className="fps-badge">{fps} fps</div>
          </>
        )}
      </div>

      {hud.tiles && (
        <div className="hud-bottom-left">
          <Inst label="TIME" value={clockTime(flightTime)} unit="" small />
        </div>
      )}

      {lowBattery && <div className="warn-banner">CRITICAL BATTERY — AUTO LANDING</div>}
      {batteryLocked && !lowBattery && (
        <div className="warn-banner">BATTERY DEPLETED — RECHARGE OR PRESS R</div>
      )}
      {batteryWarning && !lowBattery && !batteryLocked && armed && (
        <div className="warn-banner warn-amber">LOW BATTERY</div>
      )}
      {nearCeiling && armed && !lowBattery && !batteryLocked && !batteryWarning && (
        <div className="warn-banner">ALTITUDE LIMIT {ceiling}m</div>
      )}

      {hud.sticks && <StickIndicator />}
      <ControlsPanel />
      <CrashOverlay />
      <PauseOverlay />
    </div>
  );
}

function Inst({
  label,
  value,
  unit,
  small,
}: {
  label: string;
  value: string;
  unit: string;
  small?: boolean;
}) {
  return (
    <div className={`inst ${small ? 'inst-sm' : ''}`}>
      <span className="inst-label">{label}</span>
      <span className="inst-value">
        {value}
        {unit && <em>{unit}</em>}
      </span>
    </div>
  );
}
