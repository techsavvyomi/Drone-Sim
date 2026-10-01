import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { useAccountStore } from '../state/accountStore';
import { useSettingsStore } from '../state/settingsStore';
import { listDrones } from '../plugins/registry';
import { Button, Icon, Keycap, SegmentedControl, TextInput } from '../ds';
import { HangarScene } from './HangarScene';
import {
  BANNER_TITLE,
  ERROR_TEXT,
  KEY_LENGTH,
  KEY_PREFIX,
  checkForm,
  errorPlace,
  firstName,
  fullKey,
  initials,
  keyNote,
  parseKeyInput,
  type FieldName,
} from './activationKey';
import logoMark from '../../assets/brand/plutosim-mark.svg';

// The door into the simulator: activate a key the first time, sign in after.
//
// Laid out as the brief's Phase 2 frames: the brand and a large picture of the
// drone on the left with the key-card note and the two keys that matter under
// it; on the right a card with the title, the Activate / Sign in switch, the
// fields, a help box and one full-width button. The brief's photo is the Hangar
// turntable of the Pluto X, whichever drone the pilot flies. The key field's rules live in
// activationKey.ts. Every error names what to do next and sits where the fix
// is: a wrong key under the key (focus goes back to it), a problem with the
// account or the connection as a banner above the button.
//
// A profile is signed in on one computer at a time. Signing in while another
// computer still is brings up "Sign out of all devices"; confirming signs in
// again with that flag, and the other computer is signed out.

type Mode = 'activate' | 'login';

const MODES = [
  { value: 'activate' as const, label: 'Activate' },
  { value: 'login' as const, label: 'Sign in' },
];

interface Banner {
  tone: 'caution' | 'fail';
  title: string;
  text: string;
}

/** The door always shows the Pluto X, not the pilot's selected drone (the user,
 *  2026-10-01). The game calls this drone "Pluto" everywhere else; its model is
 *  the Pluto X (the user, 2026-09-29: "Pluto X likh do"). */
const DOOR_DRONE_ID = 'pluto';
const CAPTION = 'Pluto X';

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function SignIn() {
  const profile = useAccountStore((s) => s.profile);
  const needsSignIn = useAccountStore((s) => s.needsSignIn);
  const signInReason = useAccountStore((s) => s.signInReason);
  const activate = useAccountStore((s) => s.activate);
  const login = useAccountStore((s) => s.login);
  const lastPilot = useSettingsStore((s) => s.settings.lastPilot);
  const drone = useMemo(() => {
    const all = listDrones();
    return all.find((d) => d.id === DOOR_DRONE_ID) ?? all[0];
  }, []);

  // The pilot to welcome back: the one whose sign-in expired, or the last one to
  // sign in on this computer (unless they asked to be forgotten).
  const remembered =
    needsSignIn && profile ? { name: profile.name, email: profile.email } : (lastPilot ?? null);

  const [mode, setMode] = useState<Mode>(remembered ? 'login' : 'activate');
  const [notYou, setNotYou] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [keyBody, setKeyBody] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);
  // The computer this profile is signed in on, while asking whether to sign it out there.
  const [elsewhere, setElsewhere] = useState<string | null>(null);

  const refs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    key: useRef<HTMLInputElement>(null),
  };
  const submitRef = useRef<HTMLButtonElement>(null);
  // The button is disabled while a request is out, and a disabled button cannot
  // take focus: a banner asks for it here and gets it once the button is back.
  const focusSubmit = useRef(false);
  useEffect(() => {
    if (busy || !focusSubmit.current) return;
    focusSubmit.current = false;
    submitRef.current?.focus();
  }, [busy]);

  const welcome = mode === 'login' && remembered && !notYou ? remembered : null;
  const sendEmail = welcome ? welcome.email : email;

  // Focus where the pilot starts typing: the key for a remembered pilot, the
  // first empty field otherwise. Not on a mode switch made from the switch
  // itself, which keeps the focus so ← → can flip it back.
  const firstFocus = useRef(true);
  useEffect(() => {
    if (!firstFocus.current) return;
    firstFocus.current = false;
    (welcome ? refs.key : mode === 'activate' ? refs.name : refs.email).current?.focus();
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setErrors({});
    setBanner(null);
    setElsewhere(null);
  };

  const onKeyChange = (raw: string) => {
    const parsed = parseKeyInput(raw);
    setKeyBody(parsed.body);
    setNote(keyNote(parsed));
    if (errors.key) setErrors((e) => ({ ...e, key: undefined }));
  };

  // A whole key pasted into a half-typed field replaces it rather than landing
  // in the middle of it.
  const onKeyPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (/PLUTO/i.test(text) || text.replace(/[^A-Za-z0-9]/g, '').length >= KEY_LENGTH) {
      e.preventDefault();
      onKeyChange(text);
    }
  };

  const send = async (signOutOtherDevices: boolean) => {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    try {
      const key = fullKey(keyBody);
      const res =
        mode === 'activate'
          ? await activate(name, sendEmail, key, signOutOtherDevices)
          : await login(sendEmail, key, signOutOtherDevices);
      // On success the main process pushes the new account and this screen
      // unmounts; nothing more to do here.
      if (res.success) return;
      if (res.code === 'SIGNED_IN_ELSEWHERE') {
        setElsewhere(res.deviceName ?? 'another computer');
        focusSubmit.current = true;
        return;
      }
      setElsewhere(null);
      const text = res.code === 'DEVICE_MISMATCH' ? res.message : (ERROR_TEXT[res.code] ?? res.message);
      const place = errorPlace(res.code);
      if (place === 'key' || place === 'email') {
        setErrors({ [place]: text });
        refs[place].current?.focus();
      } else {
        setBanner({
          tone: place === 'offline' ? 'caution' : 'fail',
          title: BANNER_TITLE[res.code] ?? 'That did not work',
          text,
        });
        focusSubmit.current = true;
      }
    } catch {
      // A failure inside the app, not the connection. The server may already
      // have the activation, and trying again signs in.
      setElsewhere(null);
      setBanner({ tone: 'fail', title: 'Something went wrong in PlutoSim', text: 'Press Try again.' });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (elsewhere) {
      void send(true);
      return;
    }
    const problems = checkForm({ mode, name, email: sendEmail, keyBody });
    if (problems.length > 0) {
      setErrors(Object.fromEntries(problems.map((p) => [p.field, p.message])));
      const first = problems[0].field;
      // A remembered pilot's email is not a field on screen.
      (first === 'email' && welcome ? refs.key : refs[first]).current?.focus();
      return;
    }
    setErrors({});
    void send(false);
  };

  const verb = mode === 'activate' ? 'Activate' : 'Sign in';
  const complete = keyBody.length === KEY_LENGTH;
  const keyHint =
    complete && !note ? (
      <span className="acct-hint acct-hint--ok">
        <Icon name="check" />
        Key complete. Press Enter to {verb.toLowerCase()}.
      </span>
    ) : note ? (
      <span className="acct-hint acct-hint--caution">
        <Icon name="warning" />
        {note}
      </span>
    ) : (
      `The ${KEY_LENGTH} characters after ${KEY_PREFIX} on your key card. Dashes are added for you.`
    );
  const keyMark = errors.key ? (
    <span className="acct-keymark acct-keymark--fail">
      <Icon name="cross" />
    </span>
  ) : complete && !note ? (
    <span className="acct-keymark acct-keymark--ok">
      <Icon name="check" />
    </span>
  ) : undefined;

  const buttonLabel = busy
    ? elsewhere
      ? 'Signing out the other computer…'
      : mode === 'activate'
        ? 'Activating…'
        : 'Signing in…'
    : elsewhere
      ? 'Sign out of all devices'
      : banner
        ? 'Try again'
        : verb;

  const expired = needsSignIn
    ? (signInReason ?? 'Your sign-in has expired. Enter your key to carry on.')
    : null;

  const help: [string, string][] =
    mode === 'activate'
      ? [
          [
            'Activation key',
            'Links PlutoSim to your email. You enter it once. After that you sign in with your email and key.',
          ],
          ['Name', 'Shown on your pilot profile. Use the name people know you by.'],
        ]
      : [
          ['Email and key', 'Use the ones you activated with. Your flights, stars and XP load from your profile.'],
          [
            'Shared computer',
            'PlutoSim remembers the last pilot on this computer. If that isn’t you, press Not you? first.',
          ],
        ];

  return (
    <div className="acct" data-register="classroom">
      <div className="acct__left">
        <div className="acct__brand">
          <img src={logoMark} alt="" />
          <span>
            <b>PlutoSim</b>
            <em>Flight Simulator by Drona Aviation</em>
          </span>
        </div>
        <div className="acct__visual">
          {drone && <HangarScene spec={drone} paused={reducedMotion()} />}
          {drone && <span className="acct__caption">{CAPTION}</span>}
        </div>
        <div className="acct__foot">
          <span>No key yet? Each student gets their own key with PlutoSim.</span>
          <span className="acct__keys">
            <Keycap>Tab</Keycap> Next field <Keycap>Enter</Keycap> {verb}
          </span>
        </div>
      </div>

      <main className="acct__right">
        <form className="acct-card" onSubmit={submit} noValidate>
          <h1 className="acct-card__title">
            {welcome ? `Welcome back, ${firstName(welcome.name)}` : mode === 'activate' ? 'Activate PlutoSim' : 'Sign in'}
          </h1>

          <SegmentedControl
            label="Activate or sign in"
            options={MODES}
            value={mode}
            onChange={switchMode}
            className="acct-card__mode"
          />

          {expired && (
            <div className="acct-banner acct-banner--caution" role="status">
              <Icon name="warning" />
              <span>{expired}</span>
            </div>
          )}

          {welcome && (
            <div className="acct-pilot">
              <span className="acct-avatar" aria-hidden="true">
                {initials(welcome.name)}
              </span>
              <span className="acct-pilot__text">
                <b>{welcome.name}</b>
                <span>{welcome.email} · last pilot on this computer</span>
              </span>
              <Button
                variant="secondary"
                className="acct-pilot__notyou"
                onClick={() => {
                  setNotYou(true);
                  setErrors({});
                  // The email field appears on the next render.
                  setTimeout(() => refs.email.current?.focus(), 0);
                }}
              >
                Not you?
              </Button>
            </div>
          )}

          {(mode === 'activate' || !welcome) && (
            <div className={mode === 'activate' ? 'acct-pair' : undefined}>
              {mode === 'activate' && (
                <TextInput
                  ref={refs.name}
                  label="Name"
                  placeholder="e.g. Asha Kulkarni"
                  value={name}
                  onChange={(v) => {
                    setName(v);
                    if (errors.name) setErrors((e) => ({ ...e, name: undefined }));
                  }}
                  error={errors.name}
                  autoComplete="name"
                  maxLength={80}
                />
              )}
              <TextInput
                ref={refs.email}
                label="Email"
                type="email"
                placeholder="e.g. asha@school.edu"
                value={email}
                onChange={(v) => {
                  setEmail(v);
                  if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
                }}
                error={errors.email}
                autoComplete="email"
                maxLength={254}
              />
            </div>
          )}

          <TextInput
            ref={refs.key}
            label="Activation key"
            labelAside={`${keyBody.length} / ${KEY_LENGTH}`}
            prefix={KEY_PREFIX}
            placeholder="XXXX-XXXX"
            mono
            className="acct-key"
            value={parseKeyInput(keyBody).display}
            onChange={onKeyChange}
            onPaste={onKeyPaste}
            error={errors.key}
            hint={keyHint}
            suffix={keyMark}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
          />

          <dl className="acct-help">
            {help.map(([term, text]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>

          {elsewhere && (
            <div className="acct-banner acct-banner--caution" role="alert">
              <Icon name="warning" />
              <span>
                <b>This profile is signed in on another computer</b>
                {sendEmail || 'This profile'} is signed in on {elsewhere}, and a profile works on one computer at a
                time. Press Sign out of all devices to use it here; its flights so far are kept.
              </span>
            </div>
          )}
          {banner && (
            <div className={`acct-banner acct-banner--${banner.tone}`} role="alert">
              <Icon name={banner.tone === 'caution' ? 'warning' : 'cross'} />
              <span>
                <b>{banner.title}</b>
                {banner.text}
              </span>
            </div>
          )}

          <div className="acct-card__actions">
            <Button ref={submitRef} variant="primary" type="submit" disabled={busy}>
              {buttonLabel}
            </Button>
            {elsewhere && (
              <Button variant="ghost" onClick={() => setElsewhere(null)} disabled={busy}>
                Cancel
              </Button>
            )}
          </div>
          {busy && <p className="acct-card__wait">This can take up to a minute. Keep this window open.</p>}
        </form>
      </main>
    </div>
  );
}
