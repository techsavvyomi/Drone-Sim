import { useState } from 'react';
import {
  HUD_WIDGET_LABELS,
  type GraphicsPreset,
  type HudWidgets,
  type PhysicsPreset,
} from '@shared/types';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { GamepadSetup } from './GamepadSetup';

const GRAPHICS: GraphicsPreset[] = ['low', 'medium', 'high', 'ultra'];
const PHYSICS: PhysicsPreset[] = ['beginner', 'intermediate', 'advanced'];

const CATEGORIES = [
  { id: 'video', label: 'Video', icon: '🖥' },
  { id: 'audio', label: 'Audio', icon: '🔊' },
  { id: 'controls', label: 'Controls', icon: '🎮' },
  { id: 'interface', label: 'Interface', icon: '📊' },
  { id: 'about', label: 'About', icon: 'ℹ' },
] as const;

type Category = (typeof CATEGORIES)[number]['id'];

/** Mode-2 layout, matching the keyboard bindings in `input/controls.ts`. */
const KEYS: [string, string][] = [
  ['W / S', 'Throttle up / down'],
  ['A / D', 'Yaw left / right'],
  ['↑ / ↓', 'Pitch forward / back'],
  ['← / →', 'Roll left / right'],
  ['Enter', 'Arm / disarm'],
  ['Space', 'Take off / land'],
  ['M', 'Cycle flight mode'],
  ['C', 'Cycle camera'],
  ['R', 'Reset flight'],
  ['Esc', 'Back'],
];

export function SettingsPanel() {
  const { settings, set, setHud } = useSettingsStore();
  const [category, setCategory] = useState<Category>('video');

  return (
    <div className="section-body settings-shell">
      <button className="back-btn" onClick={() => useUiStore.getState().goBack()}>
        ‹ Back
      </button>
      <h1 className="section-title">Settings</h1>

      <div className="settings-tabs">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={`settings-tab ${category === c.id ? 'active' : ''}`}
            onClick={() => setCategory(c.id)}
          >
            <span className="settings-tab-icon">{c.icon}</span>
            {c.label}
          </button>
        ))}
      </div>

      <div className="settings-pane">
        {category === 'video' && (
          <>
            <div className="setting-row">
              <label>Graphics quality</label>
              <div className="segmented">
                {GRAPHICS.map((g) => (
                  <button
                    key={g}
                    className={settings.graphics === g ? 'active' : ''}
                    onClick={() => set('graphics', g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <p className="section-lede">
              Low: no post-processing (best for integrated GPUs). Medium: Bloom + Vignette.
              High: + SMAA anti-aliasing. Ultra: + Ambient Occlusion.
            </p>

            <div className="setting-row">
              <label>Camera zoom</label>
              <input
                type="range"
                min={0.5}
                max={2.5}
                step={0.05}
                value={settings.cameraZoom}
                onChange={(e) => set('cameraZoom', Number(e.target.value))}
              />
              <span className="setting-value">
                {settings.cameraZoom <= 0.85
                  ? 'Close'
                  : settings.cameraZoom <= 1.4
                    ? 'Medium'
                    : settings.cameraZoom <= 2
                      ? 'Far'
                      : 'Very far'}{' '}
                ({settings.cameraZoom.toFixed(2)}×)
              </span>
            </div>
          </>
        )}

        {category === 'audio' && (
          <>
            <div className="setting-row">
              <label>Master volume</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.volume}
                onChange={(e) => set('volume', Number(e.target.value))}
              />
              <span className="setting-value">{Math.round(settings.volume * 100)}%</span>
            </div>
            <div className="setting-row">
              <label>Motor volume</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.engineVolume}
                onChange={(e) => set('engineVolume', Number(e.target.value))}
              />
              <span className="setting-value">{Math.round(settings.engineVolume * 100)}%</span>
            </div>
            <p className="section-note">
              The rotor sound is synthesised from the selected drone's own motor and battery
              spec, so each airframe has its own pitch — the Pluto whines, the Guru growls.
              Motor volume is separate because it is the one sound that never stops.
            </p>
          </>
        )}

        {category === 'controls' && (
          <>
            <div className="setting-row">
              <label>Physics difficulty</label>
              <div className="segmented">
                {PHYSICS.map((p) => (
                  <button
                    key={p}
                    className={settings.physics === p ? 'active' : ''}
                    onClick={() => set('physics', p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <h3 className="settings-h3">Keyboard</h3>
            <div className="key-grid">
              {KEYS.map(([k, d]) => (
                <div className="key-row" key={k}>
                  <kbd>{k}</kbd>
                  <span>{d}</span>
                </div>
              ))}
            </div>

            <h3 className="settings-h3">Gamepad / transmitter</h3>
            <GamepadSetup />
          </>
        )}

        {category === 'interface' && (
          <>
            <h3 className="settings-h3">HUD widgets</h3>
            <p className="section-lede">
              Choose what appears in the flight view. Turn things off to declutter the screen.
            </p>
            <div className="hud-toggle-grid">
              {(Object.keys(HUD_WIDGET_LABELS) as (keyof HudWidgets)[]).map((key) => (
                <label className="hud-toggle" key={key}>
                  <input
                    type="checkbox"
                    checked={settings.hud[key]}
                    onChange={(e) => setHud(key, e.target.checked)}
                  />
                  <span>{HUD_WIDGET_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {category === 'about' && (
          <>
            <div className="about-card">
              <div className="about-row">
                <span>Product</span>
                <b>DroneSIM Flight Simulator</b>
              </div>
              <div className="about-row">
                <span>Version</span>
                <b>v0.1.0</b>
              </div>
            </div>
            <p className="section-note">
              Everything here persists — quit and relaunch and it comes back as you left it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
