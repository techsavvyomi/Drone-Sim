import { useState, type FormEvent } from 'react';
import type { ApiErrorCode } from '@shared/backend/contract';
import { useAccountStore } from '../state/accountStore';
import logoMark from '../../assets/brand/plutosim-logo-mark.webp';

// The door into the simulator: activate a key the first time, sign in after.
//
// A key is typed off a card or an email, so the field forgives case, spaces and
// missing dashes (see normaliseActivationKey). Errors say what to do next rather
// than naming the failure.

type Mode = 'activate' | 'login';

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  KEY_NOT_FOUND: 'That activation key was not recognised. Check it against the one you were given.',
  KEY_ALREADY_USED: 'That key is already linked to a different email. Each key works for one email only.',
  KEY_DISABLED: 'That activation key has been disabled. Ask your administrator for a new one.',
  EMAIL_ALREADY_REGISTERED: 'This email already has a profile. Use "I already have a profile" to sign in.',
  INVALID_CREDENTIALS: 'That email and activation key do not match.',
  // DEVICE_MISMATCH uses the server's message, which names the computer.
  USER_INACTIVE: 'This profile has been deactivated. Ask your administrator.',
  NETWORK: 'Could not reach the server. Check your internet connection and try again.',
  SERVER_ERROR: 'The server had a problem. Try again in a moment.',
  NOT_CONFIGURED: 'Profiles are not set up in this build.',
};

export function SignIn() {
  const profile = useAccountStore((s) => s.profile);
  const needsSignIn = useAccountStore((s) => s.needsSignIn);
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = mode === 'activate' ? await activate(name, email, key) : await login(email, key);
      // On success the main process pushes the new account and this screen
      // unmounts; nothing more to do here.
      if (!res.success) {
        setError(res.code === 'DEVICE_MISMATCH' ? res.message : (MESSAGES[res.code] ?? res.message));
      }
    } catch {
      setError(MESSAGES.NETWORK!);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <div className="signin">
      <form className="signin-card" onSubmit={submit}>
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
          {busy ? 'Checking…' : mode === 'activate' ? 'Activate' : 'Sign in'}
        </button>

        <p className="signin-note">
          {needsSignIn
            ? 'Your sign-in has expired. Enter your email and activation key to continue.'
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
