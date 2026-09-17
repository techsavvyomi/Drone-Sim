import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/types';
import { useAccountStore } from '../state/accountStore';
import { useUiStore } from '../state/uiStore';
import { listDrones, listEnvironments } from '../plugins/registry';
import { MISSIONS } from '../missions';
import { LESSONS } from '../training/lessons';
import { COMING_NEXT, DRONA_AVIATION_URL } from './aboutContent';
import logoMark from '../../assets/brand/plutosim-logo-mark.webp';
import plutoWordmark from '../../assets/brand/pluto-wordmark.webp';

// About: what this build of PlutoSim is. Counts and names come from the live
// registries and the main process, so the page never drifts from what ships.
// Only the "Coming next" list is hand-written (see aboutContent.ts).

const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

/** The About page reached from the sidebar. */
export function AboutScreen() {
  return (
    <div className="section-body settings-shell">
      <button className="back-btn" onClick={() => useUiStore.getState().goBack()}>
        ‹ Back
      </button>
      <h1 className="section-title">About</h1>
      <div className="settings-pane">
        <AboutSection />
      </div>
    </div>
  );
}

export function AboutSection() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const account = useAccountStore((s) => s.status);
  const profile = useAccountStore((s) => s.profile);

  useEffect(() => {
    void window.api.appInfo().then(setInfo);
  }, []);

  const drones = listDrones();
  const arenas = listEnvironments();

  const accountStatus =
    account === 'signedIn' && profile
      ? `Signed in: ${profile.name} (Level ${profile.level})`
      : account === 'signedOut'
        ? 'Signed out'
        : account === 'loading'
          ? 'Checking…'
          : 'Profiles off: no sign-in in this build';

  return (
    <>
      {/* The top bar's own wordmark markup and classes, not a restyled copy. */}
      <div className="logo about-logo">
        <span className="logo-mark">
          <img src={logoMark} alt="" />
        </span>
        <span className="logo-text">
          <b>
            Pluto<i>Sim</i>
          </b>
          <em>
            Flight Simulator <span className="logo-by">by Drona Aviation</span>
          </em>
        </span>
      </div>

      <h4 className="about-heading">App info</h4>
      <div className="about-card">
        <div className="about-row">
          <span>Version</span>
          <b>{info ? `v${info.version}` : '-'}</b>
        </div>
        <div className="about-row">
          <span>Build</span>
          <b>{import.meta.env.DEV ? 'Development build' : 'Release build'}</b>
        </div>
        <div className="about-row">
          <span>Platform</span>
          <b>{info ? (PLATFORM_NAMES[info.platform] ?? info.platform) : '-'}</b>
        </div>
      </div>

      <h4 className="about-heading">What&apos;s in PlutoSim</h4>
      <div className="about-card">
        <div className="about-row">
          <span>Free Flight</span>
          <b>Fly any drone in any arena, no objectives</b>
        </div>
        <div className="about-row">
          <span>Training</span>
          <b>{LESSONS.length} lessons, unlocked in order, with star ratings</b>
        </div>
        <div className="about-row">
          <span>Missions</span>
          <b>{MISSIONS.length} scored missions, unlocked in order</b>
        </div>
        <div className="about-row">
          <span>Drones</span>
          <b>{drones.map((d) => d.name).join(', ')}</b>
        </div>
        <div className="about-row">
          <span>Arenas</span>
          <b>{arenas.map((e) => e.name).join(', ')}</b>
        </div>
        <div className="about-row">
          <span>Camera views</span>
          <b>Chase, FPV and orbit</b>
        </div>
        <div className="about-row">
          <span>Controls</span>
          <b>Keyboard, or a gamepad set up in Settings</b>
        </div>
        <div className="about-row">
          <span>Settings</span>
          <b>Graphics quality, flight physics level and HUD widgets</b>
        </div>
        <div className="about-row">
          <span>Pilot profile</span>
          <b>Level, points and flight history, when signed in</b>
        </div>
        <div className="about-row">
          <span>Telemetry</span>
          <b>Flight sessions and crash reports sent to the profile backend</b>
        </div>
      </div>

      <h4 className="about-heading">Login &amp; access</h4>
      <div className="about-card">
        <div className="about-row">
          <span>Current status</span>
          <b>{accountStatus}</b>
        </div>
        <div className="about-row">
          <span>Activation key</span>
          <b>First time: name, email and key create your pilot profile</b>
        </div>
        <div className="about-row">
          <span>Email sign-in</span>
          <b>Returning pilots: email and the same key open your profile</b>
        </div>
        <div className="about-row">
          <span>Profiles off</span>
          <b>A build without a backend: full simulator, no sign-in or profile</b>
        </div>
      </div>

      <h4 className="about-heading">Coming next</h4>
      <div className="about-card">
        {COMING_NEXT.length > 0 ? (
          COMING_NEXT.map((c) => (
            <div className="about-row" key={c.title}>
              <span>{c.title}</span>
              <b>{c.note}</b>
            </div>
          ))
        ) : (
          <div className="about-row">
            <span>To be announced</span>
            <b>Upcoming updates will be listed here</b>
          </div>
        )}
      </div>

      <div className="about-drona">
        <img src={plutoWordmark} alt="Pluto" />
        <p>PlutoSim is developed by Drona Aviation, makers of the Pluto drone series.</p>
        <button
          type="button"
          className="about-explore"
          onClick={() => void window.api.openExternal(DRONA_AVIATION_URL)}
        >
          Explore Pluto Drones
        </button>
      </div>
    </>
  );
}
