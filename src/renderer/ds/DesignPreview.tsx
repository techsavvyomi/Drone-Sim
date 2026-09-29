import { useState } from 'react';
import { COLOR_TOKENS } from '../styles/tokens';
import {
  Badge,
  Button,
  ButtonLegend,
  Checkbox,
  Divider,
  Keycap,
  Modal,
  Panel,
  Progress,
  Register,
  SegmentedControl,
  Select,
  Slider,
  StarRating,
  StatTile,
  Tabs,
  TextInput,
  type LegendItem,
} from '.';

// ----------------------------------------------------------------------------
// Dev-only sheet of every token and component, in both registers — the
// Foundation v0.2 page, live. Opened with Ctrl+Shift+D in a dev build (App.tsx);
// never in a packaged build.
// ----------------------------------------------------------------------------

const TYPE_ROLES = [
  ['display', 'Hover & Hold'],
  ['h1', 'Hover & Hold'],
  ['h2', 'Lesson 3'],
  ['h3', 'Lesson 3 complete'],
  ['h4', 'Your drone'],
  ['title', 'Stick sensitivity'],
  ['body-lg', 'Hold the throttle low, then arm the drone.'],
  ['body', 'Hold the throttle low, then arm the drone.'],
  ['body-sm', 'Hold the throttle low, then arm the drone.'],
  ['link', 'Read the safety guide'],
  ['label', 'BATTERY'],
  ['caption', 'Updated 2 min ago'],
] as const;

const FLIGHT_LEGEND: LegendItem[] = [
  { keys: ['Space'], pad: { label: 'A', shape: 'face' }, action: 'Arm' },
  { keys: ['W', 'S'], pad: { label: 'L', shape: 'stick' }, action: 'Throttle' },
  { keys: ['←', '→'], pad: { label: 'R', shape: 'stick' }, action: 'Roll' },
  { keys: ['R'], pad: { label: 'Y', shape: 'face' }, action: 'Reset' },
  { keys: ['C'], pad: { label: 'RB', shape: 'shoulder' }, action: 'Camera' },
  { keys: ['H'], pad: { label: 'X', shape: 'face' }, action: 'HUD' },
  { keys: ['Esc'], pad: { label: '☰', shape: 'shoulder' }, action: 'Pause' },
];

const MENU_LEGEND: LegendItem[] = [
  { keys: ['Enter'], pad: { label: 'A', shape: 'face' }, action: 'Select' },
  { keys: ['Esc'], pad: { label: 'B', shape: 'face' }, action: 'Back' },
  { keys: ['Tab'], pad: { label: 'RB', shape: 'shoulder' }, action: 'Next tab' },
];

function Components({ kind }: { kind: 'cockpit' | 'classroom' }) {
  const cockpit = kind === 'cockpit';
  const [mode, setMode] = useState<'acro' | 'angle' | 'horizon'>('angle');
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a');
  const [slider, setSlider] = useState(cockpit ? 572 : 45);
  const [checked, setChecked] = useState(true);
  const [text, setText] = useState('');
  const [lang, setLang] = useState<'en' | 'hi' | 'mr'>('en');
  const [modal, setModal] = useState(false);

  return (
    <Register kind={kind} className="ds-preview__register">
      <h2 className="ds-h4">{cockpit ? 'Cockpit' : 'Classroom'}</h2>

      <section className="ds-preview__row">
        <Button variant="primary">{cockpit ? 'Arm' : 'Start lesson'}</Button>
        <Button>{cockpit ? 'Reset position' : 'Practice'}</Button>
        <Button variant="ghost">{cockpit ? 'Camera' : 'Back'}</Button>
        <Button variant="danger">{cockpit ? 'Kill motors' : 'Delete save'}</Button>
        <Button variant="primary" className="is-pressed">
          Pressed
        </Button>
        <Button locked={cockpit ? 'Locked' : 'Finish lesson 2 to unlock'}>Start lesson</Button>
      </section>

      <section className="ds-preview__row">
        <SegmentedControl
          label="Flight mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'acro', label: cockpit ? 'Acro' : 'Easy' },
            { value: 'angle', label: cockpit ? 'Angle' : 'Normal' },
            { value: 'horizon', label: cockpit ? 'Horizon' : 'Expert' },
          ]}
        />
        <Tabs
          label="Section"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'a', label: cockpit ? 'Telem' : 'Lessons' },
            { value: 'b', label: cockpit ? 'PID' : 'Free flight' },
            { value: 'c', label: cockpit ? 'Motors' : 'Challenges' },
          ]}
        />
      </section>

      <section className="ds-preview__row">
        <Slider
          label={cockpit ? 'Rate' : 'Stick sensitivity'}
          value={slider}
          onChange={setSlider}
          min={0}
          max={cockpit ? 1000 : 100}
          format={(v) => (cockpit ? `${v}°` : `${v}%`)}
          minLabel={cockpit ? undefined : 'Gentle'}
          maxLabel={cockpit ? undefined : 'Twitchy'}
        />
        <Checkbox
          checked={checked}
          onChange={setChecked}
          hint={cockpit ? undefined : 'Shown on the first try only'}
        >
          {cockpit ? 'Show trail' : 'Show hints during lessons'}
        </Checkbox>
      </section>

      <section className="ds-preview__row">
        <TextInput
          label={cockpit ? 'Target alt' : 'Pilot name'}
          value={text}
          onChange={setText}
          placeholder={cockpit ? '12.4' : 'e.g. Asha'}
          suffix={cockpit ? 'm' : undefined}
        />
        <TextInput
          label="Age"
          value="9"
          onChange={() => {}}
          error="PlutoSim is for ages 13 and up"
        />
        <TextInput
          label="Activation key"
          value="PLUTO-SIM-7KQ4-M2XP"
          onChange={() => {}}
          mono
          suffix="8 / 8"
        />
        <Select
          label="Language"
          value={lang}
          onChange={setLang}
          options={[
            { value: 'en', label: 'English' },
            { value: 'hi', label: 'Hindi' },
            { value: 'mr', label: 'Marathi' },
          ]}
        />
      </section>

      <section className="ds-preview__row">
        <StatTile label="Alt" value="12.4" unit="m" note="AGL" />
        <StatTile
          label="Battery"
          value="3.52"
          unit="V"
          status={{ tone: 'caution', icon: 'warning', text: 'Low' }}
        />
        <StatTile
          label="Link"
          value="-48"
          unit="dBm"
          status={{ tone: 'armed', icon: 'dot', text: 'OK' }}
        />
        <StatTile
          label="Best lap"
          value="0:41.2"
          status={{ tone: 'armed', icon: 'down', text: '2.1 s faster' }}
        />
        <div className="ds-preview__stack">
          <Progress value={2} max={3} label="Lesson progress" />
          <StarRating earned={2} />
        </div>
      </section>

      <section className="ds-preview__row">
        <Badge tone="armed" icon="dot">
          Armed
        </Badge>
        <Badge>Disarmed</Badge>
        <Badge tone="caution" icon="warning">
          Low batt
        </Badge>
        <Badge tone="fail" icon="cross">
          Failsafe
        </Badge>
        <Badge tone="armed" icon="check">
          Completed
        </Badge>
        <Badge tone="signal">New</Badge>
        <Keycap>Shift</Keycap>
        <Keycap>R</Keycap>
        <Keycap pressed>Space</Keycap>
      </section>

      <Panel
        title={cockpit ? 'Attitude' : 'Your drone'}
        meta={cockpit ? '100 Hz' : 'Pluto · 4 motors'}
      >
        <p className="ds-body-sm">Panels wear the ink-800 → ink-900 wash.</p>
        <Divider />
        <Button onClick={() => setModal(true)}>Open modal</Button>
      </Panel>

      <ButtonLegend items={cockpit ? FLIGHT_LEGEND : MENU_LEGEND} />

      {modal && (
        <Register kind={kind}>
          <Modal
            title={cockpit ? 'End flight?' : 'Sign out?'}
            tone="caution"
            safe={{
              label: cockpit ? 'Keep flying' : 'Stay signed in',
              onClick: () => setModal(false),
            }}
            danger={{ label: cockpit ? 'End' : 'Sign out', onClick: () => setModal(false) }}
          >
            {cockpit
              ? 'Motors stop and the run is not scored. Telemetry for this session is kept.'
              : 'Your flights, stars and XP are saved to your profile.'}
          </Modal>
        </Register>
      )}
    </Register>
  );
}

export function DesignPreview({ onClose }: { onClose: () => void }) {
  return (
    <div className="ds-preview" data-register="classroom">
      <header className="ds-preview__head">
        <div>
          <p className="ds-label">Foundation v0.2 · dev only</p>
          <h1 className="ds-h2">PlutoSim design system</h1>
        </div>
        <Button onClick={onClose} iconAfter="cross">
          Close
        </Button>
      </header>

      <h2 className="ds-h4">Colour</h2>
      <div className="ds-preview__swatches">
        {COLOR_TOKENS.map((t) => (
          <div key={t} className="ds-preview__swatch">
            <span className="ds-preview__chip" style={{ background: `var(--${t})` }} />
            <span className="ds-label">{t}</span>
          </div>
        ))}
      </div>

      <h2 className="ds-h4">Type</h2>
      <div className="ds-preview__type">
        {TYPE_ROLES.map(([role, sample]) => (
          <div key={role} className="ds-preview__typerow">
            <span className="ds-caption">{role}</span>
            <span className={`ds-${role}`}>{sample}</span>
          </div>
        ))}
      </div>

      <Components kind="cockpit" />
      <Components kind="classroom" />
    </div>
  );
}
