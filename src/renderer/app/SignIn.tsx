import { useState, type FormEvent } from 'react';
import type { ApiErrorCode } from '@shared/backend/contract';
import { useAccountStore } from '../state/accountStore';
import logoMark from '../../assets/brand/plutosim-mark.svg';

// The door into the simulator: activate a key the first time, sign in after.
//
// A key is typed off a card or an email, so the field forgives case, spaces and
// missing dashes (see normaliseActivationKey). Errors say what to do next rather
// than naming the failure.
//
// A profile is signed in on one computer at a time. Signing in while another
// computer still is brings up "Sign out of all devices"; confirming signs in
// again with that flag, and the other computer is signed out.

type Mode = 'activate' | 'login';

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  KEY_NOT_FOUND: 'That activation key was not recognised. Check it against the one you were given.',
  KEY_ALREADY_USED: 'That key is already linked to a different email. Each key works for one email only.',
  KEY_DISABLED: 'That activation key has been disabled. Ask your administrator for a new one.',
  EMAIL_ALREADY_REGISTERED: 'This email already has a profile. Use "I already have a profile" to sign in.',
  INVALID_CREDENTIALS: 'That email and activation key do not match.',
  // DEVICE_MISMATCH (an older backend) uses the server's message, which names the computer.
  USER_INACTIVE: 'This profile has been deactivated. Ask your administrator.',
  NETWORK: 'Could not reach the server. Check your internet connection and try again.',
  SERVER_ERROR: 'The server had a problem. Try again in a moment.',
  NOT_CONFIGURED: 'Profiles are not set up in this build.',
};

export function SignIn() {
  const profile = useAccountStore((s) => s.profile);
  const needsSignIn = useAccountStore((s) => s.needsSignIn);
  const signInReason = useAccountStore((s) => s.signInReason);
  const activate = useAccountStore((s) => s.activate);
  const login = useAccountStore((s) => s.login);

  // Someone whose device was signed out comes back to the sign-in form, with
  // their email already filled in.
  const [mode, setMode] = useState<Mode>(needsSignIn ? 'login' : 'activate');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The computer this profile is signed in on, while asking whether to sign it out there.
  const [elsewhere, setElsewhere] = useState<string | null>(null);

  const send = async (signOutOtherDevices: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'activate'
          ? await activate(name, email, key, signOutOtherDevices)
          : await login(email, key, signOutOtherDevices);
      // On success the main process pushes the new account and this screen
      // unmounts; nothing more to do here.
      if (!res.success) {
        if (res.code === 'SIGNED_IN_ELSEWHERE') {
          setElsewhere(res.deviceName ?? 'another computer');
        } else {
          setElsewhere(null);
          setError(res.code === 'DEVICE_MISMATCH' ? res.message : (MESSAGES[res.code] ?? res.message));
        }
      }
    } catch {
      // A failure inside the app, not the connection. The server may already
      // have the activation, and trying again signs in.
      setElsewhere(null);
      setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(false);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const brand = (
    <div className="signin-brand">
      <span className="logo-mark">
        <img src={logoMark} alt="" />
      </span>
      <span>
        <b>
          Pluto<i>Sim</i>
        </b>
        <em>Pilot profile</em>
      </span>
    </div>
  );

  // "Signed in on another device" takes the card's place rather than floating
  // over it: the form showed through behind a modal. The fields keep their
  // values, so Cancel returns to them as they were.
  if (elsewhere) {
    return (
      <div className="signin">
        <div
          className="signin-card signin-elsewhere"
          role="alertdialog"
          aria-labelledby="signin-elsewhere-title"
          aria-describedby="signin-elsewhere-text"
        >
          {brand}
          <h1 id="signin-elsewhere-title">Signed in on another device</h1>
          <div className="signin-device">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="12" rx="1.5" />
              <path d="M1.5 19.5h21" />
            </svg>
            <span>
              <em>Currently signed in on</em>
              <b>{elsewhere}</b>
            </span>
          </div>
          <p id="signin-elsewhere-text" className="signin-note">
            A profile can be used on one device at a time. Continuing here signs{' '}
            {email ? <b>{email}</b> : 'this profile'} out of that device.
          </p>
          {error && (
            <p className="signin-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="signin-submit"
            type="button"
            onClick={() => void send(true)}
            disabled={busy}
            autoFocus
          >
            {busy ? 'Signing out…' : 'Sign out of all devices'}
          </button>
          {busy && <p className="signin-note">This can take up to a minute. Keep this window open.</p>}
          <div className="signin-switch">
            <button type="button" onClick={() => setElsewhere(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="signin">
      <form className="signin-card" onSubmit={submit}>
        {brand}

        <h1>{mode === 'activate' ? 'Activate your simulator' : 'Welcome back'}</h1>

        {mode === 'activate' && (
          <label className="signin-field">
            <span>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={80}
              required
              autoFocus
            />
          </label>
        )}
        <label className="signin-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            maxLength={254}
            required
            autoFocus={mode === 'login'}
          />
        </label>
        <label className="signin-field">
          <span>Activation key</span>
          <input
            className="signin-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="PLUTO-SIM-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            required
          />
        </label>

        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}

        <button className="signin-submit" type="submit" disabled={busy}>
          {busy ? (mode === 'activate' ? 'Activating…' : 'Signing in…') : mode === 'activate' ? 'Activate' : 'Sign in'}
        </button>
        {busy && <p className="signin-note">This can take up to a minute. Keep this window open.</p>}

        <p className="signin-note">
          {needsSignIn
            ? (signInReason ?? 'Your sign-in has expired. Enter your email and activation key to continue.')
            : mode === 'activate'
              ? 'Enter the activation key you were given. It will be linked to your email, and your flights and points will be saved to your profile.'
              : 'Sign in with the email and activation key you activated with.'}
        </p>

        <div className="signin-switch">
          {mode === 'activate' ? (
            <button type="button" onClick={() => switchMode('login')}>
              I already have a profile
            </button>
          ) : (
            <button type="button" onClick={() => switchMode('activate')}>
              I have a new activation key
            </button>
          )}
        </div>
      </form>

    </div>
  );
}
