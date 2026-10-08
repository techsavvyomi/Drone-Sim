import { useEffect, useRef, useState } from 'react';
import {
  axesForKind,
  axesForOrder,
  CAL_MIN_SPAN,
  CHANNEL_ORDERS,
  orderFromAxes,
  GAMEPAD_ACTION_LABELS,
  gamepadBindingLabel,
  GAMEPAD_CHANNEL_LABELS,
  GAMEPAD_KIND_LABELS,
  DEFAULT_BINDINGS,
  type GamepadAction,
  type GamepadChannel,
  type ChannelOrder,
  type GamepadKind,
} from '@shared/types';
import {
  beginBindAction,
  beginCalibration,
  beginDetectAxis,
  calibrationProgress,
  cancelCalibration,
  cancelCapture,
  captureState,
  finishCalibration,
  gamepadLive,
  isCalibrating,
  listGamepads,
  readChannel,
  selectGamepad,
  setBindHandlers,
} from '../input/gamepad';
import { useSettingsStore } from '../state/settingsStore';
import {
  Badge,
  Button,
  Icon,
  InfoButton,
  Keycap,
  SegmentedControl,
  Slider,
  type ChoiceOption,
} from '../ds';

const CHANNELS = Object.keys(GAMEPAD_CHANNEL_LABELS) as GamepadChannel[];
const ACTIONS = Object.keys(GAMEPAD_ACTION_LABELS) as GamepadAction[];
const ON_OFF: ChoiceOption<'on' | 'off'>[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];
const ORDERS: ChoiceOption<ChannelOrder>[] = CHANNEL_ORDERS.map((o) => ({ value: o, label: o }));

/**
 * Live gamepad monitor + mapping editor.
 *
 * The meters update from a requestAnimationFrame loop writing to DOM refs
 * rather than React state. At 60fps a setState per frame per bar would rerender
 * this whole panel ~60 times a second for purely cosmetic movement.
 */
export function GamepadSetup() {
  const gamepad = useSettingsStore((s) => s.settings.gamepad);
  const setGamepad = useSettingsStore((s) => s.setGamepad);

  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [kind, setKind] = useState<GamepadKind>('standard');
  const [others, setOthers] = useState<{ index: number; id: string; kind: GamepadKind }[]>([]);
  const [counts, setCounts] = useState({ axes: 0, buttons: 0 });
  const [capture, setCapture] = useState<{
    action: GamepadAction | null;
    channel: GamepadChannel | null;
  }>({ action: null, channel: null });
  const [calibrating, setCalibrating] = useState(false);
  /** Channels a save left uncalibrated, so a partial sweep is not silent. */
  const [saved, setSaved] = useState<string[] | null>(null);

  const fills = useRef<Partial<Record<GamepadChannel, HTMLDivElement | null>>>({});
  const values = useRef<Partial<Record<GamepadChannel, HTMLSpanElement | null>>>({});
  const sweeps = useRef<Partial<Record<GamepadChannel, HTMLSpanElement | null>>>({});
  const buttonRow = useRef<HTMLDivElement | null>(null);

  // Keep the latest config in a ref so the bind handler never closes over a
  // stale copy — bindings are applied one at a time and each must build on the
  // previous result, not on whatever was current when the effect first ran.
  const configRef = useRef(gamepad);
  configRef.current = gamepad;

  useEffect(() => {
    setBindHandlers(
      (r) => {
        const cfg = configRef.current;
        if (r.kind === 'action') {
          setGamepad({ bindings: { ...cfg.bindings, [r.action]: r.binding } });
        } else {
          // Calibration measures one physical axis, so pointing the channel at
          // a different one invalidates it — carrying it over would stretch the
          // new axis against the old axis's endpoints.
          const rebound = { ...cfg.axes[r.channel], axis: r.axis };
          delete rebound.cal;
          setGamepad({ axes: { ...cfg.axes, [r.channel]: rebound } });
        }
      },
      // Re-read rather than tracking it locally; the module is the authority
      // on whether a capture is still pending.
      () => {
        setCapture(captureState());
        setCalibrating(isCalibrating());
      },
    );
    return () => {
      cancelCapture();
      // Calibration suppresses stick output, and only this panel can end it.
      // Closing settings mid-sweep would otherwise leave the aircraft with no
      // gamepad input at all, with nothing on screen explaining why.
      cancelCalibration();
      setBindHandlers(
        () => {},
        () => {},
      );
    };
  }, [setGamepad]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const isConnected = gamepadLive.index !== null;
      setConnected((c) => (c === isConnected ? c : isConnected));
      setDeviceName((n) => (n === gamepadLive.id ? n : gamepadLive.id));
      setKind((k) => (k === gamepadLive.kind ? k : gamepadLive.kind));
      setCounts((c) =>
        c.axes === gamepadLive.axes.length && c.buttons === gamepadLive.buttons.length
          ? c
          : { axes: gamepadLive.axes.length, buttons: gamepadLive.buttons.length },
      );

      const cfg = configRef.current;
      const progress = isCalibrating() ? calibrationProgress(cfg) : null;
      for (const ch of CHANNELS) {
        if (progress) {
          const sweep = sweeps.current[ch];
          // While calibrating, show how much travel has been seen in each
          // direction. A centred stick is stretched half by half, so "moved a
          // bit" is not enough — both ends have to be reached, and saying which
          // one is still missing is the difference between this working first
          // try and having to guess.
          if (sweep) {
            const p = progress[ch];
            // Words, not ✓ / ·: this is plain text, and Geist has no ✓.
            sweep.textContent = p.done
              ? 'Done'
              : cfg.axes[ch].unipolar
                ? 'Full travel'
                : `Low ${p.below >= CAL_MIN_SPAN ? 'done' : 'to go'} · high ${
                    p.above >= CAL_MIN_SPAN ? 'done' : 'to go'
                  }`;
            sweep.classList.toggle('is-done', p.done);
          }
        }
        const raw = readChannel(ch, cfg, gamepadLive.axes);
        const fill = fills.current[ch];
        if (fill) {
          const pct = Math.min(50, Math.abs(raw) * 50);
          fill.style.width = `${pct}%`;
          fill.style.left = raw >= 0 ? '50%' : `${50 - pct}%`;
        }
        const v = values.current[ch];
        if (v) {
          // Throttle is reported the way the aircraft sees it: centre = 50%.
          v.textContent =
            ch === 'throttle' ? `${Math.round(((raw + 1) / 2) * 100)}%` : raw.toFixed(2);
        }
      }

      const row = buttonRow.current;
      if (row) {
        for (let i = 0; i < row.children.length; i++) {
          (row.children[i] as HTMLElement).classList.toggle(
            'is-pressed',
            gamepadLive.buttons[i] === true,
          );
        }
      }
    };
    raf = requestAnimationFrame(loop);
    // Enumerating all pads every frame is pointless; devices appear on a human
    // timescale.
    const scan = setInterval(() => setOthers(listGamepads()), 1000);
    setOthers(listGamepads());
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(scan);
    };
  }, []);

  const listening = (on: boolean) => (on ? 'is-listening' : undefined);
  const calibratedCount = CHANNELS.filter((ch) => gamepad.axes[ch].cal).length;

  return (
    <div className="gp">
      <SegmentedControl
        label="Gamepad input"
        options={ON_OFF}
        value={gamepad.enabled ? 'on' : 'off'}
        onChange={(v) => setGamepad({ enabled: v === 'on' })}
      />

      <div className="gp__device">
        <Badge tone={connected ? 'armed' : 'neutral'} icon={connected ? 'dot' : 'ring'}>
          {connected ? 'Connected' : 'Searching'}
        </Badge>
        <div className="gp__device-text">
          <b>{connected ? deviceName || 'Gamepad' : 'Searching for a controller…'}</b>
          <small>
            {connected
              ? `${GAMEPAD_KIND_LABELS[kind]} · ${counts.axes} axes · ${counts.buttons} buttons`
              : 'Connect over USB or Bluetooth, then move a stick or press a button.'}
          </small>
        </div>
        {connected && (
          <Button
            variant="ghost"
            title="Re-apply the detected layout for this device"
            onClick={() =>
              setGamepad({
                axes: axesForKind(kind),
                bindings: kind === 'standard' ? { ...DEFAULT_BINDINGS } : {},
              })
            }
          >
            Re-detect
          </Button>
        )}
      </div>

      {others.length > 1 && (
        <div className="gp__row gp__picker">
          <span className="gp__name">Device</span>
          {others.map((d) => {
            const on = d.index === gamepadLive.index;
            return (
              <Button
                key={d.index}
                aria-pressed={on}
                icon={on ? 'check' : undefined}
                onClick={() => selectGamepad(d.index)}
              >
                {d.id.slice(0, 26) || `Pad ${d.index}`}
              </Button>
            );
          })}
        </div>
      )}

      <h3 className="gp__title">
        Controller connection
        <InfoButton title="Controller connection">
          Controllers connect automatically over USB or Bluetooth. Each controller gets its own
          saved stick layout. You can use the keyboard and controller together. The one you touch
          last takes control.
        </InfoButton>
      </h3>

      <h3 className="gp__title">Stick channels</h3>
      <div className="gp__list">
        {CHANNELS.map((ch) => (
          <div className="gp__row gp__axis" key={ch}>
            <span className="gp__name">{GAMEPAD_CHANNEL_LABELS[ch]}</span>
            <div className="gp__meter" aria-hidden="true">
              <div className="gp__center" />
              <div
                className="gp__fill"
                ref={(el) => {
                  fills.current[ch] = el;
                }}
              />
            </div>
            <span
              className="gp__val"
              ref={(el) => {
                values.current[ch] = el;
              }}
            >
              0.00
            </span>
            {calibrating ? (
              <span
                className="gp__sweep"
                ref={(el) => {
                  sweeps.current[ch] = el;
                }}
              >
                Sweep it
              </span>
            ) : (
              <span className="gp__assigned">
                Axis {gamepad.axes[ch].axis}
                {gamepad.axes[ch].invert ? ' · inverted' : ''}
                {gamepad.axes[ch].cal && (
                  <>
                    {' · '}
                    <Icon name="check" /> calibrated
                  </>
                )}
              </span>
            )}
            <Button
              className={listening(capture.channel === ch)}
              onClick={() => (capture.channel === ch ? cancelCapture() : beginDetectAxis(ch))}
              disabled={!connected}
            >
              {capture.channel === ch ? 'Wiggle it…' : 'Detect'}
            </Button>
            <Button
              variant="ghost"
              aria-pressed={gamepad.axes[ch].invert}
              icon={gamepad.axes[ch].invert ? 'check' : undefined}
              title="Invert direction"
              onClick={() =>
                setGamepad({
                  axes: {
                    ...gamepad.axes,
                    [ch]: { ...gamepad.axes[ch], invert: !gamepad.axes[ch].invert },
                  },
                })
              }
            >
              Invert
            </Button>
          </div>
        ))}
      </div>

      {kind === 'rc' && (
        <div className="gp__order">
          <SegmentedControl
            label="Channel order"
            options={ORDERS}
            value={(orderFromAxes(gamepad.axes) ?? '') as ChannelOrder}
            onChange={(o) => setGamepad({ axes: axesForOrder(o) })}
          />
          <small className="settings__note">
            Aileron, elevator, throttle and rudder, in that order of axes. EdgeTX and OpenTX default
            to AETR. Move each stick and watch the meters above to confirm.
          </small>
        </div>
      )}

      <h3 className="gp__title">
        Stick calibration
        <InfoButton title="Stick calibration">
          <p>
            Some controllers report a smaller stick range or an off-centre resting position.
            Calibration measures the real endpoints so moving a stick all the way gives full output.
            Calibrate each controller once.
          </p>
          <p>
            Push <b>every stick to both ends</b> of each axis: left <i>and</i> right, up <i>and</i>{' '}
            down, then let them go. Each direction is measured separately, so a stick moved only one
            way cannot be calibrated. The markers above read <b>Done</b> once a channel has seen
            both. A radio&apos;s throttle is one travel instead: run it from the very bottom to the
            very top. Sticks are ignored by the aircraft until you save.
          </p>
        </InfoButton>
      </h3>
      {calibrating ? (
        <div className="gp__calibrate is-active">
          <div className="settings__actions">
            <Button
              variant="primary"
              onClick={() => {
                const measured = finishCalibration(gamepad);
                const axes = { ...gamepad.axes };
                for (const ch of CHANNELS) {
                  if (measured[ch]) axes[ch] = { ...axes[ch], cal: measured[ch] };
                }
                setGamepad({ axes });
                setSaved(
                  CHANNELS.filter((ch) => !measured[ch]).map((ch) => GAMEPAD_CHANNEL_LABELS[ch]),
                );
              }}
            >
              Save calibration
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                cancelCalibration();
                setSaved(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="gp__row gp__calibrate">
          <span className="gp__name">
            {calibratedCount === CHANNELS.length
              ? 'All four channels calibrated'
              : calibratedCount > 0
                ? `Partly calibrated · ${calibratedCount} of ${CHANNELS.length}`
                : 'Not calibrated, using the assumed ±1 range'}
          </span>
          <Button
            disabled={!connected}
            onClick={() => {
              setSaved(null);
              beginCalibration();
            }}
          >
            Calibrate
          </Button>
          <Button
            variant="ghost"
            disabled={calibratedCount === 0}
            onClick={() => {
              const axes = { ...gamepad.axes };
              for (const ch of CHANNELS) {
                const cleared = { ...axes[ch] };
                delete cleared.cal;
                axes[ch] = cleared;
              }
              setGamepad({ axes });
            }}
          >
            Clear
          </Button>
        </div>
      )}
      {!calibrating && saved && (
        <p className={saved.length === 0 ? 'gp__saved' : 'gp__saved is-partial'} role="status">
          <Icon name={saved.length === 0 ? 'check' : 'warning'} />
          <span>
            {saved.length === 0
              ? 'Calibrated. All four channels now reach their full range.'
              : `Saved, but ${saved.join(', ')} ${
                  saved.length === 1 ? 'was' : 'were'
                } not swept to both ends and stayed uncalibrated. Run it again and move ${
                  saved.length === 1 ? 'that stick' : 'those sticks'
                } fully in both directions.`}
          </span>
        </p>
      )}

      <h3 className="gp__title">
        Buttons
        {kind === 'rc' && counts.buttons > 0 && (
          <InfoButton title="Radio buttons">
            This radio enumerates {counts.buttons} buttons, but they stay dark until you map
            switches to them on the radio itself (EdgeTX: Model → USB Joystick, set a channel's mode
            to Button). You do not have to: hit <b>Bind</b> below and flick a switch, and it will be
            captured as an axis position instead.
          </InfoButton>
        )}
      </h3>
      {counts.buttons === 0 ? (
        <p className="settings__note">
          This device reports no buttons. Its switches and pots come through as extra <b>axes</b>{' '}
          instead. Use Bind below and flick a switch.
        </p>
      ) : (
        <div className="gp__buttons" ref={buttonRow} aria-label="Buttons, lit while pressed">
          {Array.from({ length: counts.buttons }, (_, i) => (
            <Keycap key={i} pad="face">
              {i}
            </Keycap>
          ))}
        </div>
      )}

      <h3 className="gp__title">
        Actions
        <InfoButton title="Action bindings">
          Click Bind, then press a controller button or move a switch. Two- and three-position
          switches can also be used for actions.
        </InfoButton>
      </h3>
      <div className="gp__list">
        {ACTIONS.map((a) => (
          <div className="gp__row gp__bind" key={a}>
            <span className="gp__name">{GAMEPAD_ACTION_LABELS[a]}</span>
            <span className="gp__binding">{gamepadBindingLabel(gamepad.bindings[a])}</span>
            <Button
              className={listening(capture.action === a)}
              onClick={() => (capture.action === a ? cancelCapture() : beginBindAction(a))}
              disabled={!connected}
            >
              {capture.action === a ? 'Press or flick…' : 'Bind'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const next = { ...gamepad.bindings };
                delete next[a];
                setGamepad({ bindings: next });
              }}
            >
              Clear
            </Button>
          </div>
        ))}
      </div>

      <h3 className="gp__title">
        Feel
        <InfoButton title="Stick feel">
          Deadzone, expo and sensitivity adjust the roll, pitch and yaw sticks. Full travel still
          gives full output. Throttle uses its calibrated range and separate flight response.
        </InfoButton>
      </h3>
      <div className="gp__feel">
        <Slider
          label="Deadzone"
          min={0}
          max={0.4}
          step={0.01}
          value={gamepad.deadzone}
          onChange={(v) => setGamepad({ deadzone: v })}
          format={(v) => `${Math.round(v * 100)} %`}
        />
        <Slider
          label="Expo"
          min={0}
          max={1}
          step={0.05}
          value={gamepad.expo}
          onChange={(v) => setGamepad({ expo: v })}
          format={(v) => (v === 0 ? 'Linear' : `${Math.round(v * 100)} %`)}
        />
        <Slider
          label="Sensitivity"
          min={0.2}
          max={1.5}
          step={0.05}
          value={gamepad.sensitivity}
          onChange={(v) => setGamepad({ sensitivity: v })}
          format={(v) => `${v.toFixed(2)}×`}
        />
      </div>

      <div className="settings__actions">
        <Button
          variant="ghost"
          onClick={() =>
            setGamepad({
              axes: axesForKind(kind),
              bindings: kind === 'standard' ? { ...DEFAULT_BINDINGS } : {},
            })
          }
        >
          Reset mapping to defaults
        </Button>
      </div>
    </div>
  );
}
