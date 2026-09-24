import { useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Home } from './Home';
import { TelemetryPanel } from './TelemetryPanel';
import { AboutScreen } from './AboutSection';
import { SettingsPanel } from './SettingsPanel';
import { Placeholder } from './Placeholder';
import { StatusBar } from './StatusBar';
import { TrainingScreen } from './TrainingScreen';
import { MissionScreen } from './MissionScreen';
import { ProfileScreen } from './ProfileScreen';
import { SignIn } from './SignIn';
import { LoadingScreen, useResourcesReady } from './LoadingScreen';
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
    case 'studio':
      return (
        <Placeholder
          title="Drone Studio"
          phase="Phase 6"
          blurb="Build custom drones and auto-calculate weight, thrust-to-weight and flight time."
        />
      );
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
  const section = useUiStore((s) => s.section);
  const panelOpen = useUiStore((s) => s.panelOpen);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const trainingLesson = useTrainingStore((s) => s.activeLessonId);
  const activeMission = useMissionStore((s) => s.mission);
  const accountStatus = useAccountStore((s) => s.status);
  const needsSignIn = useAccountStore((s) => s.needsSignIn);
  const verifying = useAccountStore((s) => s.verifying);
  const resourcesReady = useResourcesReady();

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

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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

  // Esc is handled app-wide, not in the flight input layer: it has to work in
  // Settings and the other sections too, where those controls aren't mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      const ui = useUiStore.getState();
      const flight = useFlightStore.getState();
      if (ui.section === 'fly') {
        flight.togglePause();
      } else if (flight.paused) {
        // A mission or a lesson paused with P: Esc takes the pause off, it does
        // not leave. Leaving is what Esc does to a RUNNING attempt, and a pilot
        // who stopped to think should not lose the attempt to the key they
        // reach for to get back to it.
        flight.togglePause();
      } else if (ui.section === 'training') {
        // Inside a lesson: back out to the lesson list; on the list: back home.
        const training = useTrainingStore.getState();
        if (training.activeLessonId) training.exitLesson();
        else ui.goBack();
      } else if (ui.section === 'missions') {
        // Same one step at a time: out of the flight to the mission path, then
        // out of the section. `exit` is the one teardown, so Esc cannot leave a
        // half-open attempt behind any more than the Leave button can.
        const missions = useMissionStore.getState();
        if (missions.mission) missions.exit();
        else ui.goBack();
      } else if (ui.section !== 'home') {
        ui.goBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!hydrated || accountStatus === 'loading') {
    return (
      <div className="boot">
        <b>PlutoSim</b>
        <span>By Drona Aviation</span>
      </div>
    );
  }

  // With profiles on, the simulator is used through a profile: nothing past
  // this point until someone has activated or signed in. A token that expires
  // mid-flight waits for the flight to end (in Free Flight, for the drone to be
  // disarmed): the queue holds its data meanwhile.
  if (accountStatus === 'signedOut' || (accountStatus === 'signedIn' && needsSignIn && !midFlight)) {
    return <SignIn />;
  }

  // Signed in (or profiles off): finish loading the models before the menu, so
  // no map opens onto files that are still arriving. Usually already done by
  // the time someone has signed in; a returning pilot sees it at startup, and
  // it also waits for the launch check that this computer is still signed in.
  if (!resourcesReady || verifying) {
    return <LoadingScreen checkingSignIn={verifying} />;
  }

  return (
    <div
      className={`app ${section === 'home' ? 'is-home' : ''} ${
        flightLike ? 'is-fly' : ''
      } ${section === 'fly' && !panelOpen ? 'no-panel' : ''} ${
        section === 'fly' && panelOpen ? 'panel-open' : ''
      } ${inLesson ? 'in-lesson' : ''} ${inMission ? 'in-mission' : ''}`}
    >
      {/* Hover strip along the very top edge. In flight the bar is parked out of
          frame, and reaching this strip is what brings it back — see the
          `.topbar-peek` rules. It must stay a sibling *before* `.topbar` for the
          CSS reveal to match. */}
      <div className="topbar-peek" aria-hidden="true" />
      <TopBar />
      {/* Menu and flight view are both full-bleed: the menu navigates via its
          mode cards, and the cockpit should not be crowded by a nav rail. The
          logo and gear in the top bar remain the way back out of both. */}
      {section !== 'home' && !flightLike && <Sidebar />}
      <main className="stage">
        <MainArea />
      </main>
      {/* Telemetry dock is hidden by default in flight so the viewport stays
          clear; the tab on the right edge slides it back in. */}
      {section === 'fly' && panelOpen && <TelemetryPanel />}
      {section === 'fly' && (
        <button
          className={`panel-tab ${panelOpen ? 'open' : ''}`}
          onClick={togglePanel}
          title={panelOpen ? 'Hide telemetry' : 'Show telemetry'}
        >
          {panelOpen ? '›' : '‹'}
        </button>
      )}
      {section !== 'home' && <StatusBar />}
    </div>
  );
}
