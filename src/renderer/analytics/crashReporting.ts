import type { RendererCrashInput } from '@shared/ipc-contract';
import { useFlightStore } from '../state/flightStore';
import { useMissionStore } from '../state/missionStore';
import { useSettingsStore } from '../state/settingsStore';
import { useSimStore } from '../state/simStore';
import { useTrainingStore } from '../state/trainingStore';
import { useUiStore } from '../state/uiStore';

// Crash reporting from the game window.
//
// Errors are handed to the main process, which adds device and app details and
// queues them. The window also keeps the main process told what the pilot is
// doing, so that if the window's own process dies (and can report nothing) the
// report main writes still says which mission, map and drone it died in.

/** Identical errors inside this window are one report; a per-frame throw is not 3,600. */
const REPEAT_MS = 5000;
const CONTEXT_MS = 3000;

let lastSent = new Map<string, number>();

/** What the pilot is doing right now. Small, and never throws. */
export function crashContext(): Record<string, unknown> {
  try {
    const ui = useUiStore.getState();
    const settings = useSettingsStore.getState().settings;
    const mission = useMissionStore.getState();
    const training = useTrainingStore.getState();
    const flight = useFlightStore.getState();
    const sim = useSimStore.getState();
    return {
      section: ui.section,
      mission: mission.mission?.id ?? null,
      missionPhase: mission.mission ? mission.phase : null,
      lesson: training.activeLessonId,
      lessonPhase: training.activeLessonId ? training.phase : null,
      drone: settings.selectedDroneId,
      environment: settings.selectedEnvironmentId,
      graphics: settings.graphics,
      camera: ui.cameraMode,
      armed: flight.armed,
      fps: sim.fps,
      drawCalls: sim.perf.calls,
      screen: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
    };
  } catch {
    return {};
  }
}

export function reportCrash(input: RendererCrashInput): void {
  const key = `${input.kind}|${input.message.slice(0, 200)}`;
  const now = Date.now();
  const previous = lastSent.get(key);
  if (previous !== undefined && now - previous < REPEAT_MS) return;
  lastSent.set(key, now);
  try {
    window.api.crash.report({ ...input, context: { ...crashContext(), ...(input.context ?? {}) } });
  } catch {
    // Reporting must never be the thing that crashes.
  }
}

function describe(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: value.message || value.name, stack: value.stack };
  if (typeof value === 'string') return { message: value };
  try {
    return { message: JSON.stringify(value) ?? String(value) };
  } catch {
    return { message: String(value) };
  }
}

/** A React tree failed to render. */
export function reportRenderError(error: unknown, componentStack: string | undefined, fatal: boolean): void {
  const { message, stack } = describe(error);
  reportCrash({
    kind: 'RENDER_ERROR',
    message,
    stack: [stack, componentStack ? `Component stack:${componentStack}` : ''].filter(Boolean).join('\n'),
    fatal,
  });
}

/** Start listening. Returns a function that stops. */
export function attachCrashReporting(): () => void {
  lastSent = new Map();

  const onError = (e: ErrorEvent) => {
    // Resource load failures (a missing image) arrive here with no error object.
    if (!e.error && !e.message) return;
    const { message, stack } = describe(e.error ?? e.message);
    reportCrash({
      kind: 'RENDERER_EXCEPTION',
      message,
      stack: stack ?? (e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : undefined),
      fatal: false,
    });
  };

  const onRejection = (e: PromiseRejectionEvent) => {
    const { message, stack } = describe(e.reason);
    reportCrash({ kind: 'RENDERER_REJECTION', message, stack, fatal: false });
  };

  // `webglcontextlost` does not bubble; a capturing listener on the window
  // still sees it on its way down to the canvas.
  const onContextLost = (e: Event) => {
    const canvas = e.target as HTMLCanvasElement | null;
    reportCrash({
      kind: 'WEBGL_CONTEXT_LOST',
      message: 'WebGL context lost',
      fatal: false,
      context: canvas && 'width' in canvas ? { canvas: `${canvas.width}x${canvas.height}` } : undefined,
    });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('webglcontextlost', onContextLost, true);

  let lastContext = '';
  const pushContext = () => {
    const json = JSON.stringify(crashContext());
    if (json === lastContext) return;
    lastContext = json;
    try {
      window.api.crash.setContext(JSON.parse(json));
    } catch {
      // ignore
    }
  };
  pushContext();
  const timer = setInterval(pushContext, CONTEXT_MS);

  return () => {
    clearInterval(timer);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('webglcontextlost', onContextLost, true);
  };
}
