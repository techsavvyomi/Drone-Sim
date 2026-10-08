import { useEffect, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import {
  DEFAULT_RATES,
  RATE_LIMITS,
  RATE_PRESETS,
  sameRateProfile,
  type AxisRate,
  type RateProfile,
  type RatesSettings,
} from '@shared/types';
import { useSettingsStore } from '../state/settingsStore';
import {
  Badge,
  Button,
  Checkbox,
  Icon,
  InfoButton,
  Select,
  Slider,
  TextInput,
  type SelectOption,
} from '../ds';
import { acroRateDps, actualRates } from '../sim/control/flightController';

// Settings → Rates, after the reference simulator the user supplied
// (2026-10-08): Betaflight Actual rates per axis, a live stick-response graph
// and the throttle curve, with presets. Acro only — Stabilize and Altitude
// Hold fly the angle loop. Saved as it is changed, like every other tab.

type Axis = 'roll' | 'pitch' | 'yaw';
type Field = keyof AxisRate;

export const RATE_AXES: readonly { key: Axis; label: string }[] = [
  { key: 'roll', label: 'Roll' },
  { key: 'pitch', label: 'Pitch' },
  { key: 'yaw', label: 'Yaw' },
];

const FIELDS: readonly { key: Field; label: string; info: string }[] = [
  {
    key: 'center',
    label: 'Center °/s',
    info: 'How fast the drone turns for a small stick movement near the centre. Lower is calmer for fine corrections; higher feels twitchy.',
  },
  {
    key: 'max',
    label: 'Max °/s',
    info: 'How fast the drone turns at full stick. 620 °/s is a full flip in a little over half a second.',
  },
  {
    key: 'expo',
    label: 'Expo',
    info: 'Bends the curve between centre and max. Higher expo keeps the middle of the stick soft and saves the speed for the ends. Max stays the same.',
  },
];

const ACTUAL_INFO =
  'Actual is the Betaflight rate system: you set the turn rate at the centre, the turn rate at full stick, and the expo between them. These rates apply in Acro mode only. A full key on the keyboard flies at 0.4 of them; a gamepad or radio flies them in full.';

const THROTTLE_INFO =
  'Midpoint is where the throttle curve bends, usually near the throttle you hover at. Expo flattens the throttle around the midpoint, so small stick movements there change the height less. Both at 0 % is a straight throttle. Acro mode only.';

const fmt = (field: Field, v: number) => (field === 'expo' ? v.toFixed(2) : String(Math.round(v)));
const clampField = (field: Field, v: number) => {
  const l = RATE_LIMITS[field];
  const stepped = Math.round(v / (field === 'expo' ? 0.01 : 1)) * (field === 'expo' ? 0.01 : 1);
  return Math.min(l.max, Math.max(l.min, field === 'expo' ? Number(stepped.toFixed(2)) : stepped));
};

/** Which dropdown entry the profile is: a built-in id, `saved:<name>`, or custom. */
export function presetValue(profile: RateProfile, saved: RatesSettings['saved']): string {
  const builtIn = RATE_PRESETS.find((p) => sameRateProfile(p.profile, profile));
  if (builtIn) return builtIn.id;
  const own = saved.find((p) => sameRateProfile(p.profile, profile));
  return own ? `saved:${own.name}` : 'custom';
}

export function RatesTab() {
  const rates = useSettingsStore((s) => s.settings.rates);
  const set = useSettingsStore((s) => s.set);
  const { profile, linkRollPitch, saved } = rates;
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);

  const save = (next: Partial<RatesSettings>) => set('rates', { ...rates, ...next });
  const setProfile = (p: RateProfile) => save({ profile: p });

  const setAxis = (axis: Axis, field: Field, value: number) => {
    const v = clampField(field, value);
    const next: RateProfile = { ...profile, [axis]: { ...profile[axis], [field]: v } };
    if (linkRollPitch && axis !== 'yaw') {
      const other = axis === 'roll' ? 'pitch' : 'roll';
      next[other] = { ...next[other], [field]: v };
    }
    setProfile(next);
  };

  const current = presetValue(profile, saved);
  const options: SelectOption<string>[] = [
    ...(current === 'custom' ? [{ value: 'custom', label: 'Custom' }] : []),
    ...RATE_PRESETS.map((p) => ({ value: p.id, label: p.name })),
    ...saved.map((p) => ({ value: `saved:${p.name}`, label: p.name, detail: 'Your preset' })),
  ];
  const pick = (value: string) => {
    const builtIn = RATE_PRESETS.find((p) => p.id === value);
    const own = saved.find((p) => `saved:${p.name}` === value);
    const chosen = builtIn?.profile ?? own?.profile;
    if (chosen) setProfile(chosen);
  };

  return (
    <div className="rates">
      <header className="rates__head">
        <div className="rates__title">
          <h2 className="ds-h4">Rates</h2>
          <Badge>Actual</Badge>
          <InfoButton title="Actual rates">{ACTUAL_INFO}</InfoButton>
        </div>
        <div className="rates__presets">
          <Select label="Preset" options={options} value={current} onChange={pick} />
          <Button
            aria-expanded={managing}
            onClick={() => {
              setManaging((m) => !m);
              setSaving(false);
            }}
          >
            Presets
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setSaving(true);
              setManaging(false);
            }}
          >
            Save as preset
          </Button>
        </div>
      </header>

      {saving && (
        <SavePreset
          taken={saved.map((p) => p.name)}
          onCancel={() => setSaving(false)}
          onSave={(name) => {
            const rest = saved.filter((p) => p.name.toLowerCase() !== name.toLowerCase());
            save({ saved: [...rest, { name, profile }] });
            setSaving(false);
          }}
        />
      )}

      {managing && (
        <ManagePresets
          saved={saved}
          onApply={(p) => setProfile(p)}
          onDelete={(name) => save({ saved: saved.filter((p) => p.name !== name) })}
        />
      )}

      <div className="rates__grid">
        <section className="settings__card rates__axes" aria-label="Axis rates">
          <h3 className="settings__card-title">Axis rates</h3>
          <div className="rates__table" role="table" aria-label="Axis rates">
            <div className="rates__row rates__row--head" role="row">
              <span role="columnheader" className="ds-label">
                Axis
              </span>
              {FIELDS.map((f) => (
                <span key={f.key} role="columnheader" className="ds-label rates__colhead">
                  {f.label}
                  <InfoButton title={f.label.replace(' °/s', '')}>{f.info}</InfoButton>
                </span>
              ))}
            </div>
            {RATE_AXES.map((a) => (
              <div key={a.key} className="rates__row" role="row">
                <span role="rowheader" className="rates__axis">
                  <span className={`rates__swatch rates__swatch--${a.key}`} aria-hidden="true" />
                  {a.label}
                </span>
                {FIELDS.map((f) => (
                  <span key={f.key} role="cell">
                    <NumberStepper
                      label={`${a.label} ${f.label}`}
                      value={profile[a.key][f.key]}
                      step={RATE_LIMITS[f.key].step}
                      format={(v) => fmt(f.key, v)}
                      onChange={(v) => setAxis(a.key, f.key, v)}
                    />
                  </span>
                ))}
              </div>
            ))}
          </div>
          <Checkbox
            checked={linkRollPitch}
            onChange={(on) =>
              save({
                linkRollPitch: on,
                // Linking makes pitch follow roll from here on, starting now.
                ...(on && { profile: { ...profile, pitch: { ...profile.roll } } }),
              })
            }
          >
            Link Roll &amp; Pitch
          </Checkbox>
        </section>

        <section className="rates__chart-card" aria-label="Stick response">
          <header className="rates__chart-head">
            <h3 className="settings__card-title">Stick response</h3>
            <ul className="rates__legend" aria-label="Legend">
              {RATE_AXES.map((a) => (
                <li key={a.key}>
                  <span className={`rates__swatch rates__swatch--${a.key}`} aria-hidden="true" />
                  {a.label}
                </li>
              ))}
            </ul>
          </header>
          <StickResponseChart profile={profile} />
        </section>
      </div>

      <section className="settings__card" aria-label="Throttle response">
        <header className="settings__card-head">
          <h3 className="settings__card-title">
            Throttle response
            <InfoButton title="Throttle response">{THROTTLE_INFO}</InfoButton>
          </h3>
        </header>
        <div className="rates__throttle">
          <Slider
            label="Midpoint"
            min={0}
            max={1}
            step={0.01}
            value={profile.throttleMid}
            onChange={(v) => setProfile({ ...profile, throttleMid: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            label="Expo"
            min={0}
            max={1}
            step={0.01}
            value={profile.throttleExpo}
            onChange={(v) => setProfile({ ...profile, throttleExpo: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>
      </section>

      <div className="settings__actions">
        <Button onClick={() => save({ profile: DEFAULT_RATES.profile, linkRollPitch: false })}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}

/** A number box with ▲ ▼ beside it. Typing commits on Enter or leaving the box;
 *  ↑ ↓ step it. The value is clamped by the caller. */
function NumberStepper({
  label,
  value,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(format(value));
  // Re-read on a new value only: `format` is a fresh closure every render, and
  // following it would wipe what the pilot is typing.
  useEffect(() => setDraft(format(value)), [value]);

  const commit = () => {
    const n = Number(draft.trim());
    if (draft.trim() === '' || !Number.isFinite(n)) setDraft(format(value));
    else onChange(n);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      onChange(value + (e.key === 'ArrowUp' ? step : -step));
    } else if (e.key === 'Escape') setDraft(format(value));
  };

  return (
    <span className="rates__stepper">
      <input
        className="ds-input rates__input"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
      />
      <span className="rates__steps">
        <button
          type="button"
          aria-label={`Increase ${label}`}
          tabIndex={-1}
          onClick={() => onChange(value + step)}
        >
          <Icon name="caret-up" />
        </button>
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          tabIndex={-1}
          onClick={() => onChange(value - step)}
        >
          <Icon name="caret-down" />
        </button>
      </span>
    </span>
  );
}

function SavePreset({
  taken,
  onSave,
  onCancel,
}: {
  taken: string[];
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const clean = name.trim();
  const reserved = RATE_PRESETS.some((p) => p.name.toLowerCase() === clean.toLowerCase());
  const replaces = taken.some((t) => t.toLowerCase() === clean.toLowerCase());
  const error = reserved
    ? `“${clean}” is a built-in preset. Pick another name, for example “My ${clean}”.`
    : undefined;
  const submit = () => {
    if (clean && !reserved) onSave(clean.slice(0, 32));
  };
  return (
    <section className="settings__card rates__save" aria-label="Save as preset">
      <TextInput
        label="Preset name"
        value={name}
        onChange={setName}
        maxLength={32}
        autoFocus
        placeholder="For example: Smooth cruising"
        error={error}
        hint={
          replaces ? 'A preset with this name is already saved. Saving replaces it.' : undefined
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="settings__actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          locked={clean ? undefined : 'Type a name to save'}
          onClick={submit}
        >
          Save preset
        </Button>
      </div>
    </section>
  );
}

function ManagePresets({
  saved,
  onApply,
  onDelete,
}: {
  saved: RatesSettings['saved'];
  onApply: (p: RateProfile) => void;
  onDelete: (name: string) => void;
}) {
  return (
    <section className="settings__card" aria-label="Your presets">
      <h3 className="settings__card-title">Your presets</h3>
      {saved.length === 0 ? (
        <p className="settings__note">
          No presets yet. Set the rates the way you like them, then press <b>Save as preset</b>.
        </p>
      ) : (
        <ul className="rates__saved">
          {saved.map((p) => (
            <li key={p.name}>
              <span className="rates__saved-name">{p.name}</span>
              <span className="rates__saved-meta">
                Roll {p.profile.roll.max} · Pitch {p.profile.pitch.max} · Yaw {p.profile.yaw.max}{' '}
                °/s
              </span>
              <Button onClick={() => onApply(p.profile)}>Apply</Button>
              <Button variant="danger" onClick={() => onDelete(p.name)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- Stick response graph --------------------------------------------------

const W = 560;
const H = 340;
const PAD = { l: 64, r: 16, t: 16, b: 56 };
const PW = W - PAD.l - PAD.r;
const PH = H - PAD.t - PAD.b;
const X_TICKS = [-100, -50, 0, 50, 100];

/** The y range: ±750 like the reference, widened in 250 steps for faster rates. */
export function chartRange(profile: RateProfile): number {
  const top = Math.max(
    profile.roll.max,
    profile.pitch.max,
    profile.yaw.max,
    profile.roll.center,
    profile.pitch.center,
    profile.yaw.center,
  );
  return Math.max(750, Math.ceil(top / 250) * 250);
}

function StickResponseChart({ profile }: { profile: RateProfile }) {
  const [hover, setHover] = useState<number | null>(null);
  const yMax = chartRange(profile);
  const x = (stick: number) => PAD.l + ((stick + 1) / 2) * PW;
  const y = (dps: number) => PAD.t + ((yMax - dps) / (2 * yMax)) * PH;
  const rate = (axis: Axis, stick: number) => acroRateDps(stick, actualRates(profile[axis]));
  const path = (axis: Axis) => {
    let d = '';
    for (let i = 0; i <= 100; i++) {
      const s = -1 + i / 50;
      d += `${i ? 'L' : 'M'}${x(s).toFixed(1)},${y(rate(axis, s)).toFixed(1)}`;
    }
    return d;
  };
  const yTicks = [yMax, yMax / 2, 0, -yMax / 2, -yMax];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const s = ((px - PAD.l) / PW) * 2 - 1;
    setHover(s < -1.02 || s > 1.02 ? null : Math.max(-1, Math.min(1, Math.round(s * 100) / 100)));
  };

  // Pitch is drawn dashed over roll: with the two linked they are the same
  // line, and the dashes keep both visible.
  const order: Axis[] = ['yaw', 'roll', 'pitch'];

  return (
    <div className="rates__chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Stick response: at full stick roll ${profile.roll.max}, pitch ${profile.pitch.max}, yaw ${profile.yaw.max} degrees per second`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line
              className={t === 0 ? 'rates__axisline' : 'rates__gridline'}
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(t)}
              y2={y(t)}
            />
            <text
              className="rates__tick"
              x={PAD.l - 10}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {t}
            </text>
          </g>
        ))}
        {X_TICKS.map((t) => (
          <g key={t}>
            <line
              className={t === 0 ? 'rates__axisline' : 'rates__gridline'}
              x1={x(t / 100)}
              x2={x(t / 100)}
              y1={PAD.t}
              y2={H - PAD.b}
            />
            <text className="rates__tick" x={x(t / 100)} y={H - PAD.b + 20} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        <text className="rates__axis-title" x={PAD.l + PW / 2} y={H - 8} textAnchor="middle">
          Stick (%)
        </text>
        <text
          className="rates__axis-title"
          transform={`translate(16 ${PAD.t + PH / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          °/s
        </text>
        {order.map((a) => (
          <path key={a} className={`rates__line rates__line--${a}`} d={path(a)} />
        ))}
        {order.map((a) => (
          <circle
            key={a}
            className={`rates__dot rates__dot--${a}`}
            cx={x(1)}
            cy={y(rate(a, 1))}
            r={5}
          />
        ))}
        {hover !== null && (
          <g className="rates__hover">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} />
            {order.map((a) => (
              <circle
                key={a}
                className={`rates__dot rates__dot--${a}`}
                cx={x(hover)}
                cy={y(rate(a, hover))}
                r={4}
              />
            ))}
          </g>
        )}
      </svg>
      <Readout stick={hover} rate={rate} />
    </div>
  );
}

/** The hovered stick position in numbers — text in text colours, the swatch
 *  carries the axis. Without a hover it reads full stick. */
function Readout({
  stick,
  rate,
}: {
  stick: number | null;
  rate: (a: Axis, s: number) => number;
}): ReactNode {
  const s = stick ?? 1;
  return (
    <p className="rates__readout" aria-live="polite">
      <span className="rates__readout-stick">Stick {Math.round(s * 100)}%</span>
      {RATE_AXES.map((a) => (
        <span key={a.key}>
          <span className={`rates__swatch rates__swatch--${a.key}`} aria-hidden="true" />
          {a.label} <b>{Math.round(rate(a.key, s))}</b> °/s
        </span>
      ))}
    </p>
  );
}
