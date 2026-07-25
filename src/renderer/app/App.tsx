import { useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Home } from './Home';
import { TelemetryPanel } from './TelemetryPanel';
import { SettingsPanel } from './SettingsPanel';
import { Placeholder } from './Placeholder';
import { StatusBar } from './StatusBar';
import { Viewport } from '../scene/Viewport';
import { useUiStore } from '../state/uiStore';
import { useFlightStore } from '../state/flightStore';
import { useSettingsStore } from '../state/settingsStore';
import { attachGamepad } from '../input/gamepad';

function MainArea() {
  const section = useUiStore((s) => s.section);

  switch (section) {
    case 'home':
      return <Home />;
    case 'fly':
      return <Viewport />;
    case 'settings':
      return <SettingsPanel />;
    case 'practice':
      return (
        <Placeholder
          title="Practice"
          phase="Phase 4"
          blurb="Free-form drills: hover, square, circle and figure-8 patterns with instant feedback."
        />
      );
    case 'training':
      return (
        <Placeholder
          title="Flight Training"
          phase="Phase 4"
          blurb="Guided lessons with objectives, live scoring and completion tracking."
        />
      );
    case 'missions':
      return (
        <Placeholder
          title="Missions"
          phase="Phase 4"
          blurb="Challenge modes: hoop runs, landing pads, races, delivery and time trials."
        />
      );
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

export function App() {
  const hydrate = useSettingsStore((s) => s.hydrate);
  const hydrated = useSettingsStore((s) => s.hydrated);
  const section = useUiStore((s) => s.section);
  const panelOpen = useUiStore((s) => s.panelOpen);
  const togglePanel = useUiStore((s) => s.togglePanel);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
      if (ui.section === 'fly') {
        useFlightStore.getState().togglePause();
      } else if (ui.section !== 'home') {
        ui.goBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!hydrated) {
    return (
      <div className="boot">
        <b>DroneSIM</b>
        <span>Drona Aviation · PlutoX</span>
      </div>
    );
  }

  return (
    <div
      className={`app ${section === 'home' ? 'is-home' : ''} ${
        section === 'fly' ? 'is-fly' : ''
      } ${section === 'fly' && !panelOpen ? 'no-panel' : ''}`}
    >
      <TopBar />
      {/* Menu and flight view are both full-bleed: the menu navigates via its
          mode cards, and the cockpit should not be crowded by a nav rail. The
          logo and gear in the top bar remain the way back out of both. */}
      {section !== 'home' && section !== 'fly' && <Sidebar />}
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
