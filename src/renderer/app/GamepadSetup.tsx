import { useEffect, useRef, useState } from 'react';
import {
  axesForKind,
  axesForOrder,
  CHANNEL_ORDERS,
  orderFromAxes,
  GAMEPAD_ACTION_LABELS,
  GAMEPAD_CHANNEL_LABELS,
  GAMEPAD_KIND_LABELS,
  DEFAULT_BINDINGS,
  type GamepadAction,
  type GamepadBinding,
  type GamepadChannel,
  type GamepadKind,
} from '@shared/types';
import {
  beginBindAction,
  beginDetectAxis,
  cancelCapture,
  captureState,
  gamepadLive,
  listGamepads,
  readChannel,
  selectGamepad,
  setBindHandlers,
} from '../input/gamepad';
import { useSettingsStore } from '../state/settingsStore';

const CHANNELS = Object.keys(GAMEPAD_CHANNEL_LABELS) as GamepadChannel[];
const ACTIONS = Object.keys(GAMEPAD_ACTION_LABELS) as GamepadAction[];

function bindLabel(b: GamepadBinding | undefined): string {
  if (!b) return '—';
  if (b.t === 'b') return `Button ${b.i}`;
  return `Axis ${b.a} ${b.p === 'hi' ? 'high' : 'low'}`;
}

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

  const fills = useRef<Partial<Record<GamepadChannel, HTMLDivElement | null>>>({});
  const values = useRef<Partial<Record<GamepadChannel, HTMLSpanElement | null>>>({});
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
          setGamepad({
            axes: { ...cfg.axes, [r.channel]: { ...cfg.axes[r.channel], axis: r.axis } },
          });
        }
      },
      // Re-read rather than tracking it locally; the module is the authority
      // on whether a capture is still pending.
      () => setCapture(captureState()),
    );
    return () => {
      cancelCapture();
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
      for (const ch of CHANNELS) {
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
            'pressed',
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

  return (
    <div className="gp-setup">
      <div className="setting-row">
        <label>Gamepad input</label>
        <div className="segmented">
          <button
            className={gamepad.enabled ? 'active' : ''}
            onClick={() => setGamepad({ enabled: true })}
          >
            on
          </button>
          <button
            className={!gamepad.enabled ? 'active' : ''}
            onClick={() => setGamepad({ enabled: false })}
          >
            off
          </button>
        </div>
      </div>

      <div className={`gp-device ${connected ? 'ok' : ''}`}>
        <span className="gp-dot" />
        <div className="gp-device-text">
          <b>{connected ? deviceName || 'Gamepad' : 'Searching for a controller…'}</b>
          <small>
            {connected
              ? `${GAMEPAD_KIND_LABELS[kind]} · ${counts.axes} axes · ${counts.buttons} buttons`
              : 'Connect over USB or Bluetooth, then move a stick or press a button.'}
          </small>
        </div>
        {connected && (
          <button
            className="btn-sm ghost"
            title="Re-apply the detected layout for this device"
            onClick={() =>
              setGamepad({ axes: axesForKind(kind), bindings: { ...DEFAULT_BINDINGS } })
            }
          >
            Re-detect
          </button>
        )}
      </div>

      {others.length > 1 && (
        <div className="gp-picker">
          <span className="gp-name">Device</span>
          {others.map((d) => (
            <button
              key={d.index}
              className={`btn-sm ${d.index === gamepadLive.index ? 'listening' : ''}`}
              onClick={() => selectGamepad(d.index)}
            >
              {d.id.slice(0, 26) || `Pad ${d.index}`}
            </button>
          ))}
        </div>
      )}

      <p className="section-lede">
        Controllers are detected automatically over USB or Bluetooth — game pads and RC
        transmitters use different stick axes, so the right layout is applied on first
        connect and remembered per device. Keyboard and gamepad stay live together;
        whichever you touch last takes over.
      </p>

      <h3 className="settings-h3">Stick channels</h3>
      {CHANNELS.map((ch) => (
        <div className="gp-axis-row" key={ch}>
          <span className="gp-name">{GAMEPAD_CHANNEL_LABELS[ch]}</span>
          <div className="gp-bar">
            <div className="gp-center" />
            <div
              className="gp-fill"
              ref={(el) => {
                fills.current[ch] = el;
              }}
            />
          </div>
          <span
            className="gp-val"
            ref={(el) => {
              values.current[ch] = el;
            }}
          >
            0.00
          </span>
          <span className="gp-assigned">
            axis {gamepad.axes[ch].axis}
            {gamepad.axes[ch].invert ? ' (inv)' : ''}
          </span>
          <button
            className={`btn-sm ${capture.channel === ch ? 'listening' : ''}`}
            onClick={() => (capture.channel === ch ? cancelCapture() : beginDetectAxis(ch))}
            disabled={!connected}
          >
            {capture.channel === ch ? 'wiggle…' : 'Detect'}
          </button>
          <button
            className="btn-sm ghost"
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
            ⇅
          </button>
        </div>
      ))}

      {kind === 'rc' && (
        <div className="gp-order">
          <span className="gp-name">Channel order</span>
          {CHANNEL_ORDERS.map((o) => (
            <button
              key={o}
              className={`btn-sm ${orderFromAxes(gamepad.axes) === o ? 'listening' : ''}`}
              title={`Aileron/Elevator/Throttle/Rudder in ${o} order`}
              onClick={() => setGamepad({ axes: axesForOrder(o) })}
            >
              {o}
            </button>
          ))}
          <small className="gp-hint">
            EdgeTX and OpenTX default to AETR. Move each stick and watch the meters above to
            confirm.
          </small>
        </div>
      )}

      <h3 className="settings-h3">Buttons</h3>
      {kind === 'rc' && counts.buttons > 0 && (
        <p className="section-note">
          This radio enumerates {counts.buttons} buttons, but they stay dark until you map
          switches to them on the radio itself (EdgeTX: Model → USB Joystick, set a channel's
          mode to Button). You do not have to: hit <b>Bind</b> below and flick a switch, and
          it will be captured as an axis position instead.
        </p>
      )}
      {counts.buttons === 0 ? (
        <p className="section-note">
          This device reports no buttons. Its switches and pots come through as extra{' '}
          <b>axes</b> instead — use Bind below and flick a switch.
        </p>
      ) : (
        <div className="gp-buttons" ref={buttonRow}>
          {Array.from({ length: counts.buttons }, (_, i) => (
            <span className="gp-btn" key={i}>
              {i}
            </span>
          ))}
        </div>
      )}

      <h3 className="settings-h3">Actions</h3>
      <p className="section-lede">
        Bind to a button, or flick a switch — transmitters expose their 2- and 3-position
        switches as axes, so those bind too.
      </p>
      <div className="gp-bind-list">
        {ACTIONS.map((a) => (
          <div className="gp-bind-row" key={a}>
            <span className="gp-name">{GAMEPAD_ACTION_LABELS[a]}</span>
            <span className="gp-binding">{bindLabel(gamepad.bindings[a])}</span>
            <button
              className={`btn-sm ${capture.action === a ? 'listening' : ''}`}
              onClick={() => (capture.action === a ? cancelCapture() : beginBindAction(a))}
              disabled={!connected}
            >
              {capture.action === a ? 'press / flick…' : 'Bind'}
            </button>
            <button
              className="btn-sm ghost"
              onClick={() => {
                const next = { ...gamepad.bindings };
                delete next[a];
                setGamepad({ bindings: next });
              }}
            >
              Clear
            </button>
          </div>
        ))}
      </div>

      <h3 className="settings-h3">Feel</h3>
      <div className="setting-row">
        <label>Deadzone</label>
        <input
          type="range"
          min={0}
          max={0.4}
          step={0.01}
          value={gamepad.deadzone}
          onChange={(e) => setGamepad({ deadzone: Number(e.target.value) })}
        />
        <span className="setting-value">{Math.round(gamepad.deadzone * 100)}%</span>
      </div>
      <div className="setting-row">
        <label>Expo</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={gamepad.expo}
          onChange={(e) => setGamepad({ expo: Number(e.target.value) })}
        />
        <span className="setting-value">
          {gamepad.expo === 0 ? 'linear' : `${Math.round(gamepad.expo * 100)}%`}
        </span>
      </div>
      <div className="setting-row">
        <label>Sensitivity</label>
        <input
          type="range"
          min={0.2}
          max={1.5}
          step={0.05}
          value={gamepad.sensitivity}
          onChange={(e) => setGamepad({ sensitivity: Number(e.target.value) })}
        />
        <span className="setting-value">{gamepad.sensitivity.toFixed(2)}×</span>
      </div>

      <button
        className="btn-sm ghost gp-reset"
        onClick={() => setGamepad({ axes: axesForKind(kind), bindings: { ...DEFAULT_BINDINGS } })}
      >
        Reset mapping to defaults
      </button>
    </div>
  );
}
