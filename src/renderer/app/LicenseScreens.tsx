import { useState } from 'react';
import { noticeText } from '@shared/backend/license';
import { Modal } from '../ds';
import { useAccountStore } from '../state/accountStore';

// What the license puts in front of the pilot (manager's brief, 2026-10-26).
//
// LicenseLock closes the whole app while the license is expired, the clock has
// been set back, the offline budget is used up, or no license has been checked
// on this computer yet. It has no way past it but putting things right: renew
// the key (the same key, moved forward on the server) and press Check again,
// correct the date and time, connect to the internet, or sign out to use
// another profile. An expiry ends a flight in progress at once; otherwise the
// flight finishes first (App).
//
// LicenseNotice is the expiry warning at 30, 7, 3 and 1 days and on the day,
// each shown once, off a flight. Both work offline: the main process works the
// license out from its signed copy and the clock, not from the server.

const LOCK_TEXT = {
  expired: {
    title: 'License Expired',
    text: 'Your license has expired. Please activate a valid license to continue playing.',
    hint: 'Already renewed? Connect to the internet and press Check again.',
  },
  clock: {
    title: 'System Date and Time Incorrect',
    text: "Your system date or time appears to have changed. Please check and correct your computer's date and time before continuing.",
    hint: 'Once it is right, press Check again.',
  },
  verify: {
    title: 'Connect to the Internet',
    text: 'PlutoSim has been used offline for as long as your license allows. Please connect to the internet so your license can be verified.',
    hint: 'Once you are online, press Check again.',
  },
  unchecked: {
    title: 'Check Your License',
    text: 'PlutoSim needs to check your license on this computer once.',
    hint: 'Connect to the internet, then press Check again.',
  },
} as const;

const dateOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';

export function LicenseLock() {
  const license = useAccountStore((s) => s.license);
  const checkLicense = useAccountStore((s) => s.checkLicense);
  const signOut = useAccountStore((s) => s.signOut);
  const [checking, setChecking] = useState(false);
  const [stillLocked, setStillLocked] = useState(false);
  if (!license || license.state === 'active') return null;
  const words = LOCK_TEXT[license.state];

  const check = async () => {
    if (checking) return;
    setChecking(true);
    setStillLocked(false);
    try {
      await checkLicense();
    } finally {
      setChecking(false);
      // Still here after the answer means nothing changed.
      setStillLocked(true);
    }
  };

  return (
    <div className="license-lock">
      <Modal
        title={words.title}
        tone={license.state === 'unchecked' ? 'neutral' : 'fail'}
        safe={{ label: checking ? 'Checking…' : 'Check again', onClick: () => void check() }}
        danger={{ label: 'Sign out', onClick: () => void signOut() }}
      >
        <p>{words.text}</p>
        {license.state === 'expired' && license.expiresAt && (
          <p>Expired on {dateOf(license.expiresAt)}.</p>
        )}
        <p className="license-lock__hint">
          {stillLocked && !checking ? 'Still not resolved. ' : ''}
          {words.hint}
        </p>
      </Modal>
    </div>
  );
}

export function LicenseNotice() {
  const license = useAccountStore((s) => s.license);
  const ack = useAccountStore((s) => s.ackLicenseNotice);
  if (!license || license.state !== 'active' || license.notice === null) return null;
  const day = license.notice;
  const { title, text } = noticeText(license.daysLeft ?? day);
  return (
    <Modal title={title} tone="caution" safe={{ label: 'OK', onClick: () => void ack(day) }}>
      <p>{text}</p>
      {license.expiresAt && <p>It runs until {dateOf(license.expiresAt)}.</p>}
    </Modal>
  );
}
