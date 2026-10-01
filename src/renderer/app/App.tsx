import { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Home } from './Home';
import { TelemetryPanel } from './TelemetryPanel';
import { HudPanel } from '../hud/HudPanel';
import { escapeStep } from '../hud/cockpitFacts';
import { AboutScreen } from './AboutScreen';
import { SettingsPanel } from './SettingsPanel';
import { Placeholder } from './Placeholder';
import { StatusBar } from './StatusBar';
import { TrainingScreen } from './TrainingScreen';
import { Hangar } from './Hangar';
import { MissionScreen } from './MissionScreen';
import { ProfileScreen } from './ProfileScreen';
import { SignIn } from './SignIn';
import { LoadingScreen, LOADING_MIN_MS, useResourcesReady } from './LoadingScreen';
import { QualityNotice } from './QualityNotice';
import { BootSplash, SPLASH_MIN_MS } from './BootSplash';
import { allLoaded, useResourceStore } from '../assets/resourceTracker';
import { Viewport } from '../scene/Viewport';
import { useUiStore } from '../state/uiStore';
import { useFlightStore } from '../state/flightStore';
import { useSettingsStore } from '../state/settingsStore';
import { useTrainingStore } from '../state/trainingStore';
import { useMissionStore } from '../state/missionStore';
import { attachGamepad } from '../input/gamepad';
import { useAccountStore } from '../state/accountStore';
import { attachTelemetry } from '../analytics/telemetry';
import { attachCrashReporting } from '../analytics/crashReporting';
import { attachMenuNav, escapeToSidebar } from '../input/menuNav';
import { attachMenuGamepad } from '../input/menuGamepad';
import { navItems, openSection } from './Sidebar';

/** True while a menu page is up: no flight, lesson or mission, not paused.
 *  Read from the stores, for listeners that outlive a render. */
function menuShowing(): boolean {
  const { section } = useUiStore.getState();
  if (section === 'fly') return false;
  if (section === 'training' && useTrainingStore.getState().activeLessonId) return false;
  if (section === 'missions' && useMissionStore.getState().mission) return false;
  return !useFlightStore.getState().paused;
}

/** True while a flight card is up — the pause card, its exit question, the
 *  crash card — so a gamepad can work it (menuGamepad.ts). */
function flightCardShowing(): boolean {
  const { paused, crashed } = useFlightStore.getState();
  return paused || crashed;
}

function MainArea() {
  const section = useUiStore((s) => s.section);

  switch (section) {
    case 'home':
      return <Home />;
    case 'fly':
      return <Viewport />;
    case 'settings':
      return <SettingsPanel />;
    case 'about':
      return <AboutScreen />;
    case 'profile':
      return <ProfileScreen />;
    case 'training':
      return <TrainingScreen />;
    case 'missions':
      return <MissionScreen />;
    case 'hangar':
      return <Hangar />;
    case 'stem':
      return (
        <Placeholder
          title="Drone Training"
          phase="Phase 6"
          blurb="Interactive, animated explainers for lift, thrust, drag, PID, IMU and more."
        />
      );
    default:
      return null;
  }
}

// Root App Component
export function App() {
  const hydrate = useSettingsStore((s) => s.hydrate);
  const hydrated = useSettingsStore((s) => s.hydrated);
  const [splashHeld, setSplashHeld] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setSplashHeld(false), SPLASH_MIN_MS);
    return () => window.clearTimeout(t);
  }, []);
  const section = useUiStore((s) => s.section);
  const panelOpen = useUiStore((s) => s.panelOpen);
  const hudPanelOpen = useUiStore((s) => s.hudPanelOpen);
  const trainingLesson = useTrainingStore((s) => s.activeLessonId);
  const activeMission = useMissionStore((s) => s.mission);
  const accountStatus = useAccountStore((s) => s.status);
  const needsSignIn = useAccountStore((s) => s.needsSignIn);
  const verifying = useAccountStore((s) => s.verifying);
  const resourcesReady = useResourcesReady();
  const prepared = useSettingsStore((s) => s.settings.resourcesPrepared);
  const loadedClean = useResourceStore((s) => allLoaded(s.entries));

  // A running lesson or mission is a flight view: full-bleed, no nav rail.
  //
  // A mission is exactly as much a cockpit as a lesson is — it has its own HUD
  // across the top, its own way out, and a map the pilot cannot change from
  // here. Leaving the nav rail up beside it made it read as a page inside the
  // app rather than as a flight, and cost the mission a fifth of the city.
  const inLesson = section === 'training' && !!trainingLesson;
  const inMission = section === 'missions' && !!activeMission;
  const inBriefedFlight = inLesson || inMission;
  const flightLike = section === 'fly' || inBriefedFlight;
  // A lesson or mission runs to its end; Free Flight has none, so it counts as a
  // flight only while the drone is armed. Parked on the Fly screen, a computer
  // whose profile was taken over must still be signed out.
  const armed = useFlightStore((s) => s.armed);
  const midFlight = inBriefedFlight || (section === 'fly' && armed);
  // Free Flight's parked top bar comes down only on the pause menu (Esc).
  const paused = useFlightStore((s) => s.paused);
  const flyPaused = section === 'fly' && paused;

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Whether this start is a first launch, read once: `prepared` flips to true
  // the moment the models are in, which on a fast computer is before the boot
  // splash has gone. Declared above the effect that flips it.
  const [firstLaunch, setFirstLaunch] = useState<boolean | null>(null);
  useEffect(() => {
    if (hydrated && firstLaunch === null)
      setFirstLaunch(!useSettingsStore.getState().settings.resourcesPrepared);
  }, [hydrated, firstLaunch]);
  // On a first launch the loading screen stays for LOADING_MIN_MS once the
  // splash has gone, however fast the models arrived.
  const [loadingHeld, setLoadingHeld] = useState(true);
  useEffect(() => {
    if (splashHeld || !firstLaunch) return;
    const t = window.setTimeout(() => setLoadingHeld(false), LOADING_MIN_MS);
    return () => window.clearTimeout(t);
  }, [splashHeld, firstLaunch]);

  // The first launch that loads everything cleanly is the last to show the
  // loading screen. A launch with a failed model does not count, so the next
  // one tries again behind the screen rather than behind the menu.
  useEffect(() => {
    if (hydrated && loadedClean && !prepared)
      useSettingsStore.getState().set('resourcesPrepared', true);
  }, [hydrated, loadedClean, prepared]);

  // The sign-in form welcomes back the last pilot on this computer. Name and
  // email only; the sign-out dialog can forget them.
  const signedInPilot = useAccountStore((s) =>
    s.status === 'signedIn' && s.profile ? `${s.profile.name}\n${s.profile.email}` : null,
  );
  useEffect(() => {
    if (!hydrated || !signedInPilot) return;
    const [name, email] = signedInPilot.split('\n');
    const last = useSettingsStore.getState().settings.lastPilot;
    if (last?.name !== name || last?.email !== email)
      useSettingsStore.getState().set('lastPilot', { name, email });
  }, [hydrated, signedInPilot]);

  // Crash reports, from the first render: a failure on the sign-in screen counts.
  useEffect(() => attachCrashReporting(), []);

  // Who is flying. Resolved alongside settings; the simulator opens once both are.
  useEffect(() => useAccountStore.getState().init(), []);

  // Sessions and gameplay events. It records only while someone is signed in,
  // and after settings have hydrated, so the drone it reports is the real one.
  useEffect(() => {
    if (!hydrated) return;
    return attachTelemetry();
  }, [hydrated]);

  // App-wide, not flight-view-scoped: the settings screen needs live axis and
  // button readings to configure a controller before ever entering a flight.
  //
  // Deliberately gated on `hydrated`. Started earlier, the loop can adopt a
  // controller and write its profile against un-hydrated defaults, and the
  // async hydrate then replaces the whole settings object and pushes the
  // on-disk config over it — discarding the profile for the device that is
  // actually plugged in. Which side won came down to timing, so detection
  // appeared to work at random.
  useEffect(() => {
    if (!hydrated) return;
    return attachGamepad();
  }, [hydrated]);

  // Menu navigation: arrows / D-pad move the focus, 1–8 open a sidebar item.
  // Menus only — a flight, lesson or mission keeps every key and button, but
  // for the pad on a pause or crash card.
  useEffect(() => {
    const jump = (n: number) => {
      const profiles = useAccountStore.getState().status === 'signedIn';
      const item = navItems(profiles).find((i) => i.n === n);
      if (item) openSection(item.id, true);
    };
    const detachKeys = attachMenuNav({ isMenu: menuShowing, jump });
    const detachPad = attachMenuGamepad(menuShowing, flightCardShowing);
    return () => {
      detachKeys();
      detachPad();
    };
  }, []);

  // Esc is handled app-wide, not in the flight input layer: it has to work in
  // Settings and the other sections too, where those controls aren't mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      // On a menu page, Esc from the content or the top bar first goes to the
      // active sidebar item; from the sidebar it goes back as it always has.
      if (menuShowing() && escapeToSidebar()) return;
      const ui = useUiStore.getState();
      const flight = useFlightStore.getState();
      // Esc pauses a flight and never ends one (Phase 6); off a flight it
      // steps back. The rule itself is `escapeStep`.
      const training = useTrainingStore.getState();
      const missions = useMissionStore.getState();
      const step = escapeStep({
        section: ui.section,
        paused: flight.paused,
        lesson: training.activeLessonId
          ? { phase: training.phase, autoAdvance: training.autoAdvance }
          : null,
        mission: missions.mission ? { phase: missions.phase } : null,
      });
      if (step === 'pause') flight.togglePause();
      else if (step === 'cancelAdvance') training.cancelAutoAdvance();
      else if (step === 'exitLesson') training.exitLesson();
      else if (step === 'exitMission') missions.exit();
      else if (step === 'back') ui.goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (splashHeld || !hydrated || accountStatus === 'loading') {
    return <BootSplash />;
  }

  // First launch: the loading screen opens the app, before sign-in, so every
  // model is in by the time the pilot reaches the menu. After that launch it is
  // never shown again: the models still load on every start (they are decrypted
  // in memory, never kept on disk), but behind the menu, and a map opened before
  // its model has arrived waits behind its own veil.
  if ((firstLaunch && loadingHeld) || (!prepared && !resourcesReady)) {
    return <LoadingScreen />;
  }

  // With profiles on, the simulator is used through a profile: nothing past
  // this point until someone has activated or signed in. A token that expires
  // mid-flight waits for the flight to end (in Free Flight, for the drone to be
  // disarmed): the queue holds its data meanwhile.
  if (
    accountStatus === 'signedOut' ||
    (accountStatus === 'signedIn' && needsSignIn && !midFlight)
  ) {
    return <SignIn />;
  }

  // The launch check that this computer is still signed in holds the menu only
  // on the first launch. A returning pilot goes straight to the menu while it
  // runs; a computer whose profile was taken over is sent to sign-in when the
  // answer arrives (or, mid-flight, when the flight ends).
  if (!prepared && verifying) {
    return <LoadingScreen checkingSignIn />;
  }

  return (
    <div
      className={`app ${section === 'home' ? 'is-home' : ''} ${
        flightLike ? 'is-fly' : ''
      } ${section === 'fly' && panelOpen ? 'panel-open' : ''} ${
        section === 'fly' && hudPanelOpen ? 'hudpanel-open' : ''
      } ${inLesson ? 'in-lesson' : ''} ${inMission ? 'in-mission' : ''} ${
        flyPaused ? 'fly-paused' : ''
      }`}
    >
      <TopBar />
      {/* The sidebar and status bar frame every menu page, Home included. A
          flight view is full-bleed: its way out is the pause menu (Esc), which
          in Free Flight also brings the parked top bar down. */}
      {!flightLike && <Sidebar />}
      <main className="stage" data-nav-region="content">
        <MainArea />
      </main>
      {/* The cockpit's side columns (Phase 6): the HUD panel (H) on the left,
          the telemetry dock (T) on the right. One at a time; each pushes the
          flight view over instead of covering it. */}
      {section === 'fly' && hudPanelOpen && <HudPanel />}
      {section === 'fly' && panelOpen && <TelemetryPanel />}
      {!flightLike && <StatusBar />}
      <QualityNotice />
    </div>
  );
}
