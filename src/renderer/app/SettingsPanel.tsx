import { useEffect, useState, type ReactNode } from 'react';
import { HUD_WIDGETS, type GraphicsPreset } from '@shared/types';
import { useSettingsStore } from '../state/settingsStore';
import { useShellStore } from '../state/shellStore';
import {
  Button,
  Checkbox,
  InfoButton,
  Keycap,
  SegmentedControl,
  Slider,
  Tabs,
  type ChoiceOption,
} from '../ds';
import { isTextField } from '../input/menuNav';
import { captureState, isCalibrating } from '../input/gamepad';
import { GamepadSetup } from './GamepadSetup';
import { RatesTab } from './RatesTab';
import { KEY_GROUPS, hudCount } from '../hud/cockpitFacts';

// Settings, in the shell like the Hangar and Profile. No PDF draws this page;
// it is built from the Phase 0 parts in the classroom register. Five tabs —
// ← → on the tab row, Q / E (LB / RB on a pad) step them from anywhere on the
// page. About is its own sidebar page, not a tab here.

export const SETTINGS_TABS = [
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'controls', label: 'Controls' },
  { value: 'rates', label: 'Rates' },
  { value: 'interface', label: 'Interface' },
] as const satisfies readonly ChoiceOption<string>[];

type Tab = (typeof SETTINGS_TABS)[number]['value'];

const GRAPHICS: ChoiceOption<GraphicsPreset>[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const GRAPHICS_NOTE: Record<GraphicsPreset, string> = {
  low: 'No post-processing. Best for integrated graphics.',
  medium: 'Bloom and vignette.',
  high: 'Bloom, vignette, SMAA anti-aliasing and sharper shadows.',
};

/** "Medium · 1.00×" — the chase camera's distance, in words and as a factor. */
export function zoomText(zoom: number): string {
  const word = zoom <= 0.85 ? 'Close' : zoom <= 1.4 ? 'Medium' : zoom <= 2 ? 'Far' : 'Very far';
  return `${word} · ${zoom.toFixed(2)}×`;
}

const percent = (v: number) => `${Math.round(v * 100)} %`;

export function SettingsPanel() {
  const [tab, setTab] = useState<Tab>('video');
  const setContext = useShellStore((s) => s.setContext);
  const label = SETTINGS_TABS.find((t) => t.value === tab)!.label;

  useEffect(() => {
    setContext(`Settings · ${label}`);
    return () => setContext('');
  }, [label, setContext]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTextField(document.activeElement)) return;
      // A bind or a calibration listens to the pad; switching tabs would end it.
      if (isCalibrating() || captureState().action || captureState().channel) return;
      const step = e.code === 'KeyQ' ? -1 : e.code === 'KeyE' ? 1 : 0;
      if (!step) return;
      e.preventDefault();
      setTab((t) => {
        const at = SETTINGS_TABS.findIndex((o) => o.value === t);
        const n = SETTINGS_TABS.length;
        return SETTINGS_TABS[(at + step + n) % n].value;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="settings" data-register="classroom">
      <header className="settings__head">
        <h1 className="ds-h3">Settings</h1>
        <p className="ds-caption">Saved as you change them · Q E or LB RB to change tab</p>
      </header>
      <Tabs label="Settings" options={SETTINGS_TABS} value={tab} onChange={setTab} />
      <div className="settings__pane" role="tabpanel" aria-label={label}>
        {tab === 'video' && <VideoTab />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'controls' && <ControlsTab />}
        {tab === 'rates' && <RatesTab />}
        {tab === 'interface' && <InterfaceTab />}
      </div>
    </div>
  );
}

/** One titled group of rows on a settings tab. */
function Section({
  title,
  meta,
  info,
  children,
}: {
  title: string;
  meta?: string;
  info?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings__card" aria-label={title}>
      <header className="settings__card-head">
        <h2 className="settings__card-title">
          {title}
          {info && <InfoButton title={title}>{info}</InfoButton>}
        </h2>
        {meta && <span className="settings__card-meta">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

function VideoTab() {
  const { settings, set } = useSettingsStore();
  return (
    <>
      <Section title="Graphics quality">
        <SegmentedControl
          label="Graphics quality"
          options={GRAPHICS}
          value={settings.graphics}
          onChange={(g) => set('graphics', g)}
        />
        <p className="settings__note">{GRAPHICS_NOTE[settings.graphics]}</p>
        <Checkbox
          checked={settings.autoGraphics}
          onChange={(v) => set('autoGraphics', v)}
          hint="Steps down one level at a time. It never raises the quality on its own."
        >
          Lower the quality automatically when the frame rate drops
        </Checkbox>
      </Section>
      <Section title="Camera">
        <Slider
          label="Chase camera distance"
          min={0.5}
          max={2.5}
          step={0.05}
          value={settings.cameraZoom}
          onChange={(v) => set('cameraZoom', v)}
          format={zoomText}
          minLabel="Close"
          maxLabel="Very far"
        />
      </Section>
    </>
  );
}

function AudioTab() {
  const { settings, set } = useSettingsStore();
  return (
    <Section
      title="Volume"
      info="Each drone has its own motor sound. Master volume changes all sounds. Motor volume adjusts only the drone motors."
    >
      <Slider
        label="Master volume"
        min={0}
        max={1}
        step={0.05}
        value={settings.volume}
        onChange={(v) => set('volume', v)}
        format={percent}
      />
      <Slider
        label="Motor volume"
        min={0}
        max={1}
        step={0.05}
        value={settings.engineVolume}
        onChange={(v) => set('engineVolume', v)}
        format={percent}
      />
    </Section>
  );
}

function ControlsTab() {
  return (
    <>
      <Section title="Keyboard" meta="Mode 2 · the same list as the HUD panel (H)">
        <div className="settings__keys">
          {KEY_GROUPS.map((g) => (
            <div key={g.title} className="settings__keygroup">
              <h3 className="ds-label">{g.title}</h3>
              <ul>
                {g.rows.map(([k, what]) => (
                  <li key={k} className="settings__key">
                    <Keycap>{k}</Keycap>
                    <span>{what}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Gamepad or transmitter">
        <GamepadSetup />
      </Section>
    </>
  );
}

function InterfaceTab() {
  const hud = useSettingsStore((s) => s.settings.hud);
  const setHud = useSettingsStore((s) => s.setHud);
  const resetHud = useSettingsStore((s) => s.resetHud);
  const { on, total } = hudCount(hud);
  return (
    <Section title="HUD widgets" meta={`${on} of ${total} on`}>
      <p className="settings__note">
        What the flight view shows. The same switches are in the HUD panel (H) during a flight.
      </p>
      <div className="settings__widgets">
        {HUD_WIDGETS.map((w) => (
          <Checkbox
            key={w.key}
            checked={hud[w.key]}
            onChange={(v) => setHud(w.key, v)}
            hint={w.where}
          >
            {w.label}
          </Checkbox>
        ))}
      </div>
      <div className="settings__actions">
        <Button onClick={resetHud}>Reset to default</Button>
      </div>
    </Section>
  );
}
