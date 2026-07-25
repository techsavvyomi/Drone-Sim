Enterto armSpaceto take offnopthe like in zig zag

also 

# Drone Flight Simulator — Implementation Plan

**Status:** Phases 0–1 complete · Phase 2 in progress · **Updated:** 2026-07-24
(See §10 "Progress & amendments" for what actually shipped and where reality diverged from this plan.)
**Decisions locked:** Electron desktop from day one · Pure game sim (clean control/telemetry model, no real-Pluto protocol constraint) · Plan-first before any app code.

This document is the build contract. It defines the tech stack, the architecture, the plugin system (deliverable #6), and a phased roadmap where **each phase ends with something that runs**. We never build 20 shallow stubs; we build a drone that flies, then widen.

---

## 1. Guiding principles

1. **Flyable first.** The very first milestone is one drone that genuinely flies in one environment with real physics. Everything else hangs off a proven core loop.
2. **Data-driven content.** Drones, environments, missions, lessons, and obstacles are *registered data + typed contracts*, not hard-coded scenes. This is the plugin system. Adding the 5th drone or 13th map is a data file, not a refactor.
3. **Deterministic, fixed-timestep simulation.** Physics runs at a fixed rate (250–500 Hz sub-stepped) decoupled from render (60–120 fps). Determinism is what makes replay, scoring, and training reproducible.
4. **One source of truth per concern.** Sim state, UI state, and persisted settings are separated and flow one direction.
5. **Thin Electron main, fat renderer.** Physics + rendering + game logic live in the renderer. The main process owns only what a browser can't: window lifecycle, filesystem, SQLite persistence, native device access (serial), and packaging.

---

## 2. Tech stack (locked)

| Layer                        | Choice                                                                              | Rationale                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell                        | **Electron** (Forge + Vite plugin)                                            | Cross-platform desktop, native FS/serial/SQLite, one-command packaging for Win/mac/Linux. Forge+Vite is the current standard and gives HMR in the renderer. |
| Language                     | **TypeScript** (strict)                                                       | Contracts across sim/UI/plugins depend on strong types.                                                                                                     |
| UI                           | **React 18**                                                                  | Dashboard, panels, HUD overlays.                                                                                                                            |
| Bundler/dev                  | **Vite**                                                                      | Fast HMR, first-class R3F/Three support.                                                                                                                    |
| 3D                           | **Three.js + React Three Fiber + @react-three/drei**                          | Declarative scene graph; drei gives cameras, controls, loaders, helpers.                                                                                    |
| Physics                      | **Rapier** via **@react-three/rapier** (`@dimforge/rapier3d-compat`)  | WASM, deterministic, fast, great R3F integration. (Ammo.js rejected: heavier, less ergonomic, less deterministic.)                                          |
| Sim state                    | **Zustand**                                                                   | Minimal, fast, works outside React (the sim loop writes to it without re-rendering the world every tick).                                                   |
| Charts                       | **uPlot** (telemetry graphs)                                                  | Handles high-frequency streaming data at 60fps far better than Recharts/Chart.js.                                                                           |
| Persistence                  | **better-sqlite3** in the **Electron main process**, exposed over IPC   | Synchronous, embedded, zero-config for desktop. Stores profiles, settings, mission scores, replays index.                                                   |
| Backend (optional, deferred) | Node/Express                                                                        | Only if cloud leaderboards/sync are wanted later. Desktop needs none of it — the main process*is* Node. Not built until a phase requires it.             |
| Input                        | Gamepad API, WebHID/WebSerial (renderer) +`serialport` (main, for RC/ELRS)        | Covers keyboard, Xbox/PS pads, and USB radios.                                                                                                              |
| Packaging                    | Electron Forge makers (Squirrel/`.exe`, `.dmg`/zip, `.deb`/`.rpm`/AppImage) | Deliverable: installers for all three OSes.                                                                                                                 |
| Lint/format                  | ESLint + Prettier +`tsc --noEmit` in CI                                           | Keeps the growing codebase consistent.                                                                                                                      |

**Explicitly deferred by the "pure game sim" decision:** MSP protocol, real RC channel PWM semantics, hardware-in-the-loop. We keep a *clean* internal control model (normalized stick axes + a flight-mode controller) that could later be adapted to a real bridge, but we do not constrain the design to plutocontrol.

---

## 3. Repository structure

```
drone-sim-game/
├─ package.json                 # Electron Forge + Vite scripts
├─ forge.config.ts              # makers, packaging targets
├─ vite.main.config.ts / vite.preload.config.ts / vite.renderer.config.ts
├─ docs/
│  ├─ PLAN.md                   # this file
│  └─ ARCHITECTURE.md           # kept current as we build
├─ src/
│  ├─ main/                     # Electron main process (Node)
│  │  ├─ index.ts               # app/window lifecycle
│  │  ├─ ipc/                   # typed IPC handlers
│  │  ├─ db/                    # better-sqlite3 schema + repositories
│  │  └─ devices/               # serialport (RC/ELRS) — later phase
│  ├─ preload/
│  │  └─ index.ts               # contextBridge: typed, whitelisted API surface
│  ├─ shared/                   # imported by BOTH main and renderer
│  │  ├─ ipc-contract.ts        # channel names + request/response types
│  │  └─ types/                 # domain types shared across processes
│  └─ renderer/
│     ├─ app/                   # React app shell, routing, dashboard layout
│     ├─ sim/                   # the simulation core (framework-agnostic TS)
│     │  ├─ loop.ts             # fixed-timestep accumulator
│     │  ├─ dynamics/           # multirotor forces, motors, drag, wind, battery
│     │  ├─ control/            # PID, flight-mode controllers, mixer
│     │  └─ telemetry.ts        # derived sensor signals (imu/gps/rpm/esc)
│     ├─ scene/                 # R3F: world, drone rig, cameras, obstacles
│     ├─ hud/                   # HUD widgets (attitude, compass, gauges)
│     ├─ ui/                    # dashboard panels, settings, studio, STEM
│     ├─ input/                 # device layer: keyboard/gamepad/hid mappers
│     ├─ state/                 # zustand stores (sim, ui, settings)
│     └─ plugins/               # the registries + built-in content
│        ├─ registry.ts
│        ├─ drones/             # one file per drone model
│        ├─ environments/       # one file per map
│        ├─ missions/
│        └─ lessons/
└─ assets/                      # models (glb), textures, hdris, sounds
```

---

## 4. Plugin architecture (Deliverable #6)

The extensibility requirement is satisfied by four typed registries populated at startup. A contributor adds content by writing one object that satisfies a contract and registering it — no engine changes.

```ts
// shared/types — sketch, finalized in Phase 0
interface DroneSpec {
  id: string; name: string;
  frame: 'quad' | 'hex';
  mass: number;                 // kg (base, before payload)
  armLength: number;            // m, motor distance from CoG
  motors: MotorSpec[];          // KV, max thrust, response time
  propDiameter: number;         // inches
  battery: BatterySpec;         // cells, capacity mAh, internal resistance
  maxSpeed: number; maxAltitude: number;
  cameraMount: { position: Vec3; tiltDeg: number };
  model?: string;               // glb asset path (fallback: procedural mesh)
  pidDefaults: PidSet;
}

interface EnvironmentSpec {
  id: string; name: string; kind: 'indoor' | 'outdoor';
  build(ctx: SceneContext): EnvHandle;   // spawns ground, props, lighting rig
  weatherDefaults?: WeatherSpec;
  spawn: { position: Vec3; heading: number };
  bounds: Box3;
}

interface MissionSpec {
  id: string; name: string; type: 'takeoff'|'hover'|'hoops'|'landing'|'search'|'race'|'timetrial'|'delivery';
  setup(ctx: GameContext): MissionRuntime;   // objectives, triggers, scoring hooks
  medalThresholds: { bronze: number; silver: number; gold: number };
}

interface LessonSpec {
  id: string; name: string;
  objectives: Objective[];      // each has a live-evaluated predicate + weight
  instructions: Step[];
  scoreModel: ScoreModel;       // smoothness/accuracy/time weighting
}

registerDrone(spec); registerEnvironment(spec); registerMission(spec); registerLesson(spec);
```

Scoring, HUD, telemetry, and camera systems are engine services that read the active `DroneSpec`/`MissionRuntime` — they never hard-code a specific drone or map.

---

## 5. Simulation & control architecture

**Loop (`sim/loop.ts`):** accumulator pattern. Render calls `step(dt)`; the loop advances physics in fixed `1/250 s` slices, interpolating render state between the last two physics states. Guarantees stable PID and reproducible replays regardless of framerate.

**Dynamics (`sim/dynamics/`):**

- Rigid body (Rapier) with inertia tensor from mass + arm geometry.
- Per-motor thrust applied at rotor positions → produces torque naturally (roll/pitch/yaw from differential thrust). This is what makes it *fly like a quad*, not a hovering box.
- Motor model: RPM lag (first-order), thrust ∝ RPM², battery-voltage-dependent max thrust.
- Aerodynamics: quadratic air drag, angular damping, optional ground effect (thrust boost near ground), configurable wind (steady + gust noise) as an external force.
- Battery: capacity integrator; voltage sags under current draw and toward empty → less thrust → realistic end-of-flight behavior.

**Control (`sim/control/`):**

- Normalized stick inputs `{roll, pitch, yaw, throttle} ∈ [-1,1]` (throttle `[0,1]`) from the input layer — device-agnostic.
- Flight-mode controllers map sticks → desired attitude/rate/velocity:
  - **Acro/Rate** — sticks command angular rates (rate PID only).
  - **Stabilize** — sticks command angle; auto-levels (angle PID → rate PID cascade).
  - **Altitude Hold** — throttle holds vertical speed/altitude.
  - **Position Hold** — GPS/velocity hold, level when sticks centered.
  - **Head Free** — yaw-independent control frame.
  - **Manual** — direct throttle/attitude, no assistance.
  - **Guided / Waypoint** — external setpoints drive the position controller.
  - **Return to Home** — guided navigation back to spawn + auto-land.
- **Mixer:** controller outputs (roll/pitch/yaw/thrust demands) → per-motor commands for quad/hex geometry.
- PID controllers are the same reusable class throughout; gains come from `DroneSpec.pidDefaults` and are live-editable (Physics Parameters panel).

**Telemetry (`sim/telemetry.ts`):** derives IMU (accel/gyro/mag with noise), GPS (position + fix quality), motor RPM, ESC output, current/voltage from the physics state each tick, and pushes to a ring buffer the graphs and HUD consume.

---

## 6. State & IPC

- **`state/simStore`** — hot sim state (pose, velocity, motor state, telemetry frame). Written by the loop, read by scene/HUD. Not React-reactive per-tick; components subscribe selectively.
- **`state/uiStore`** — active panel, selected drone/env/mission, camera mode, menu state.
- **`state/settingsStore`** — graphics/physics presets, keybindings, profile. Hydrated from SQLite on boot, persisted on change via IPC.
- **IPC contract (`shared/ipc-contract.ts`)** — every channel is a typed request/response pair. Preload exposes a narrow, whitelisted `window.api` (no `nodeIntegration`, `contextIsolation` on). Main-process handlers: settings load/save, profile CRUD, score records, replay save/load/export, device enumeration.
- **DB schema (better-sqlite3):** `profiles`, `settings`, `mission_scores`, `lesson_progress`, `replays` (metadata + file path; replay payloads stored as files in userData).

---

## 7. Phased roadmap

Each phase is independently demoable and ends with acceptance criteria. Estimates are relative effort, not calendar promises.

### Phase 0 — Foundation & contracts

- Electron Forge + Vite + React + TS scaffold; strict tsconfig; ESLint/Prettier.
- Secure main/preload/renderer split; typed IPC skeleton; better-sqlite3 wired with a `settings` table round-trip.
- Zustand stores; app shell with the dark dashboard layout (sidebar / 3D viewport placeholder / panel dock).
- Plugin registry + all four contract types stubbed; one placeholder drone/env registered.
- Fixed-timestep loop harness (no drone yet) proven against a falling test cube in Rapier.
- **Done when:** app launches on macOS, shows the dashboard, a Rapier cube falls deterministically, settings persist across restarts.

### Phase 1 — Flyable core (vertical slice) ⭐

- Pluto-class quad rigid body with 4-motor thrust dynamics, gravity, drag, inertia.
- PID cascade + **Stabilize** mode + mixer.
- Keyboard input → normalized sticks; **Arm/Disarm, Takeoff, Land**.
- One environment (**Drone Arena** — enclosed, good for learning).
- **FPV** + **Third-person/Chase** cameras.
- Core HUD: artificial horizon, attitude, altitude, throttle, armed/mode.
- **Done when:** you can arm, take off, hover, fly a lap, and land with the keyboard, and it *feels* like a quad.

### Phase 2 — Flight systems & instruments

- Remaining flight modes (Altitude Hold, Position Hold, Acro, Head Free, Manual, Guided, RTH).
- Full physics params live-editable (wind + gusts, ground effect, battery sag, motor power, gravity, prop efficiency, PID) — changes apply instantly.
- Full HUD ( vertical speed, ground speed,, flight time).
- Telemetry system + uPlot graphs (accel/gyro/mag/RPM/ESC/current/voltage).
- **Done when:** all 8 modes fly correctly and every HUD/telemetry field is live and accurate.

### Phase 3 — Content: drones, environments, weather, obstacles

- 5 drone models (65mm TinyWhoop, Pluto, 250 racer, 450 quad, hexacopter) as registered specs with real differing handling.
- Environments: 4 indoor + 5 outdoor, day/night, weather (sunny/windy/rain-visual/fog).
- Obstacle system (trees/buildings/walls/poles/gates/hoops/moving) with Rapier collision + collision events feeding scoring.
- **Done when:** every drone flies distinctly, every map loads, weather/day-night toggle, and collisions register.

### Phase 4 — Training, missions, scoring

- Lesson framework (objectives w/ live predicates, instructions, live score, completion %); all 11 lessons.
- Missions/challenges (8 types) with gate/hoop/waypoint/landing-pad primitives.
- Scoring engine (smoothness, landing accuracy, time, battery, collisions, completion) + Bronze/Silver/Gold; scores persisted.
- **Done when:** a learner can complete a lesson and a mission end-to-end and earn a saved medal.

### Phase 5 — Input devices & cameras

- Gamepad API + Xbox/PS mappings; USB RC/ELRS via WebHID/serial; full remapping UI with live capture.
- All 6 camera modes (FPV, Third-person, Chase, Free, Cockpit, Top).
- **Done when:** a USB transmitter and a gamepad both fly the drone, fully remappable, all cameras work.

### Phase 6 — Replay, settings presets, polish, packaging

- Replay recorder/player (path, stick inputs, telemetry, camera track) + file export/import.
- Graphics presets (Low/Med/High/Ultra) and physics presets (Beginner/Intermediate/Advanced).
- UI/UX polish pass, audio, performance tuning to 60–120 fps.
- Forge makers → signed-ish installers for Windows/macOS/Linux; `ARCHITECTURE.md` + user docs.
- **Done when:** replays export/import, presets work, and installers build on all three OSes at target framerate.

---

## 7. Cross-cutting: performance budget

- Physics ≤ ~2 ms/frame at 60fps (fixed-step sub-stepping capped).
- Instanced meshes for obstacles/foliage; frustum culling; LODs for outdoor maps.
- Telemetry graphs on `requestAnimationFrame` with decimation, not per-tick React state.
- Graphics presets gate shadow resolution, post-processing, draw distance, foliage density.

## 8. Key risks & mitigations

| Risk                                               | Mitigation                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Flight feel is "off" (biggest UX risk)             | Nail it in Phase 1 with a tuning session before widening; per-drone PID defaults; expose gains early. |
| Scope creep across 20 areas                        | Phase gates with acceptance criteria; content is data, added incrementally.                           |
| Rapier determinism vs framerate                    | Fixed-timestep accumulator from Phase 0; never step physics with raw`dt`.                           |
| Electron packaging pain (native`better-sqlite3`) | Validate rebuild/packaging on all 3 OSes early (end of Phase 0), not at the end.                      |
| Asset pipeline (glb models) unavailable            | Procedural fallback meshes so the sim never blocks on art.                                            |

## 9. Immediate next step

**Phase 2** — remaining flight modes, environmental physics (wind, ground effect, battery sag), full HUD and telemetry graphs.

---

## 10. Progress & amendments

Record of what shipped and where reality diverged from the original plan.

### Phase 0 — Foundation ✅ complete

Electron Forge + Vite + React 19 + TS 5.7 scaffold; secure main/preload/renderer split (`contextIsolation` on, whitelisted `window.api`); typed IPC; dashboard shell; plugin registry with all four contracts; fixed-timestep loop. Verified by typecheck, `electron-forge package`, and a clean boot.

**Amendments:**

- **TypeScript pinned to 5.7, not 7.x.** TS 7 (the native port) is peer-incompatible with `typescript-eslint` (<6.1) and the wider toolchain.
- **Settings persistence is JSON, not SQLite.** `better-sqlite3` is a native module and adds packaging risk before we need relational storage. Settings live in a JSON document in `userData`; SQLite arrives in Phase 4 for scores/replays, which actually need it.
- **Entry files are `src/main.ts` / `src/preload.ts`, not `src/*/index.ts`.** The Forge Vite plugin names each bundle after the entry file's *basename*, so two `index.ts` entries collided into one `index.js` and packaging failed. Support modules still live under `src/main/`.
- **CSP requires `'wasm-unsafe-eval'`.** Rapier's physics WASM will not instantiate under a bare `script-src 'self'`. Narrow directive used deliberately — general `eval` stays blocked.

### Phase 1 — Flyable core ✅ complete

Flying PlutoX in the Drone Arena: body-relative thrust, cascade PID, Stabilize + Acro, Mode-2 keyboard control, arm/disarm, auto takeoff/land, three cameras, artificial-horizon HUD.

**Amendments:**

- **Attitude control is quaternion-based, not Euler.** The first implementation used `YXZ` Euler angles, which go singular past 90° of tilt — a flipped drone could never self-right ("stuck, needs reset"). Replaced with a tilt error computed by rotating body-up onto the commanded up-vector, valid at *any* attitude.
- **Torque is inertia-normalized.** The rate loop outputs angular *acceleration*; torque = `principalInertia() * α` (read from Rapier). Gains are therefore airframe-independent and carry over to every future drone model.
- **Control is applied as impulses (`force · dt`), not `addForce`.** Rapier's force accumulator persists across steps and would compound; impulses are one-shot per step.
- **Simplification vs plan:** collective thrust + net torque, rather than four independent point-forces at the rotors. Motor telemetry is therefore *approximated* for display. True per-motor mixing with thrust saturation is deferred to Phase 2.
- **Crash recovery aids** (not in the original plan, added after playtest): auto-upright when disarmed on the ground, low collider friction so the drone slides off walls instead of wedging, and Phase-1 obstacles removed until the Phase-3 collision system exists.

### Asset pipeline decision — procedural over CAD

A supplied `PlutoX.glb` (70.8 MB, **2.15 M triangles, 3,656 meshes**) is a CAD export, not a game asset; 3,656 meshes means ~3,656 draw calls/frame. The drone is instead a **procedural ~3k-triangle model** built to the CAD file's measured dimensions (186 × 48 × 187 mm, Y-up, origin-centred) and its recovered material palette, sized to the real **160 mm wheelbase** (motor-to-motor diagonal → 80 mm radius).

An optimized copy exists at `public/models/PlutoX.glb` (**1.61 MB**, via `gltf-transform optimize`) for future non-realtime use (e.g. a hangar/config view).

**Constraint discovered:** drei's `useGLTF` sources its Draco decoder from `gstatic.com`, and `<Environment preset>` fetches HDRIs from a CDN — both blocked by our CSP and unavailable offline. Any future GLB loading must supply local decoders; scene lighting must stay local.

### Environment realism pass

- **Rolling terrain** (`scene/environment/Terrain.tsx`). A displaced ring from
  r=70 to r=300 replaces the dead-flat horizon. Deterministic value noise (no
  `Math.random`) so the landscape is identical every launch. Two constraints
  shaped it: it starts *outside* the +/-60 flight bounds, so it can never
  reintroduce the "drone sunk into the ground" collider mismatch; and its
  displacement is **never negative**, because the academy sits on a flat 520m
  slab with surface y=0 and any valley would be buried by that slab with a
  visible intersection seam.
- **Fog ranges widened** (`state/worldStore.ts`). `fogFar` was 260 (day) while
  the mountains sat at r=230-290 — they were being *erased* by fog rather than
  hazed by it, which is why the distance read as flat. Far planes now 240-560.
- **Layered mountains** (`props.tsx`). Two ridge lines instead of one ring of 22
  identical 5-sided cones: a near ridge with contrast and a far, paler, taller
  one. Varied segment counts, rotation and squash break the cone silhouette;
  snow caps on the tall peaks. Each is seated on `terrainHeight()` at its own
  position and sunk 5m, so no gap can open under it.
- **Trees** now alternate conifer (stacked offset tiers) and broadleaf
  (overlapping spheres), with deterministic per-tree lean/twist — a treeline of
  identical cones was the most obvious placeholder in the scene.
- **Building detail**: ribbed cladding and roof trim on the hangar, window
  mullions and a gallery railing on the control tower. Flat metal boxes read as
  untextured primitives regardless of material quality.
- **Ground clutter** (`scene/environment/Scatter.tsx`). Instanced rocks and
  shrubs (3 draw calls) give the ground plane scale reference, plus soft-edged
  weathering blotches on the apron. Placement rejects anything landing on the
  apron or taxiway.

**Shadow fix found while verifying.** The renderer log showed
`PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.` — in three
0.185 the soft-shadow constant silently falls back to hard PCF, so
`shadows={{ type: THREE.PCFSoftShadowMap }}` had been doing nothing. Switched to
`PCFShadowMap` explicitly and fixed the real problem, which was texel density:
the shadow camera spanned 90m at 2048 (4.4cm/texel) while the drone is 16cm
across, making its shadow ~4 texels wide. Now 4096 over 38m half-extent
(~1.9cm/texel), with `normalBias` added to suppress acne.

Verified: `tsc --noEmit` 0, `eslint` 0, and the flight scene booted with zero
renderer errors (checked by temporarily defaulting `uiStore.section` to `'fly'`,
then reverting).

### USB gamepad support + categorised settings

Gamepad handling is ported from the Pluto ROS dashboard
(`ROS_PROJECTS/.../pluto_dashboard/templates/index.html`) so mappings and feel
carry over rather than being reinvented.

- **Binding model kept identical.** Continuous channels bind to `{axis, invert}`;
  discrete actions bind to *either* a button edge `{t:'b',i}` **or** an axis
  entering a position `{t:'a',a,p:'lo'|'hi'}`. That second form is not optional
  polish — real RC transmitters expose their 2- and 3-position switches as
  **axes**, so a button-only scheme cannot bind an arm switch on a FlySky or
  Taranis. Thresholds (`SWITCH_HI/LO` +/-0.5), the 0.12 default deadzone and the
  0.35 wiggle-detect delta all match the dashboard.
- **`input/gamepad.ts`** owns a single `requestAnimationFrame` poll loop. One
  owner is a correctness requirement, not tidiness: button and switch edges are
  consumed on transition, so a second poller would race for them and actions
  would fire once, twice, or not at all.
- **Poll loop is app-level, action dispatch is flight-view-level.** First cut
  attached the loop inside `attachKeyboard()`, which only mounts in `Viewport` —
  so the settings screen showed "no gamepad", dead meters, and Bind/Detect
  captured nothing. The loop now runs for the app's lifetime (`App.tsx`) while
  `setActionHandler` stays scoped to the flight view, so a bound button cannot
  arm the drone from a menu.
- **Last-input-wins arbitration** in `controls.ts`. A connected-but-idle pad must
  not lock out the keyboard, so whichever device the pilot actually moved last
  drives the sticks. Gamepad axes are applied unsmoothed — the spring in the
  stick already does the easing the keyboard needed.
- **Throttle maps `[-1,1]` to `[0,1]`**, centre 0.5. A gamepad stick springs to
  centre, so centre has to mean "hold": 0.5 is the hover point in
  altitude-managed modes and roughly hover in direct modes.
- **Shaping order** is deadzone then expo then sensitivity, the order a
  transmitter applies them, with the deadzone rescaled so output starts at zero
  just outside it instead of jumping.

**Settings reorganised into categories** (`SettingsPanel.tsx`): Video, Audio,
Controls, Interface, About. Controls holds physics difficulty, the keyboard
reference, and the full gamepad editor (`GamepadSetup.tsx`) with live axis
meters, a button monitor, per-channel Detect/invert and per-action Bind/Clear.
Meters are driven by rAF writing to DOM refs, not React state — a setState per
bar per frame would rerender the panel ~60x/sec for cosmetic movement. They call
`readChannel()` directly rather than reading the published stick values, so they
still work while gamepad input is switched *off* (otherwise you could not verify
a controller without first enabling it).

The Audio tab states plainly that no audio engine exists yet; the volume value
persists and will apply when it lands.

Verified: `tsc` 0, `eslint` 0, `electron-forge package` 0, and the Settings
screen rendered with zero renderer errors. **Not verified: behaviour with a
physical controller** — no gamepad is attached to this machine, so the polling,
shaping and binding paths are code-verified only.

### Controller auto-detection

The first cut adopted whatever pad appeared and applied one fixed axis layout.
That is wrong for roughly half of all devices: **standard-mapping gamepads put
the left stick on axes 0/1 and the right on 2/3, while RC transmitters use a
different order entirely**, so a fixed layout means roll and yaw are swapped the
moment you take off.

- **`detectKind()`** classifies a device as `standard` or `rc` from `Gamepad.id`,
  falling back to `Gamepad.mapping` and then to an axis/button-count heuristic
  (radios expose many axes and few buttons, pads the reverse). Verified against
  15 real Chromium `Gamepad.id` strings covering Xbox/DualShock/DualSense/
  8BitDo/Switch Pro and OpenTX/EdgeTX/Taranis/FlySky/Spektrum/BETAFPV radios.
- **Per-device memory.** `gamepad.devices` maps a device key to its profile. On
  connect the store restores that device's saved mapping, or seeds one from the
  detected layout. Editing a mapping writes through to the active device's
  profile, so swapping controllers and back restores what the pilot configured
  rather than resetting.
- **Continuous rescanning** in the poll loop, not just connect events. Browsers
  withhold a gamepad until it emits activity, so a controller already plugged in
  (or already paired over Bluetooth) at launch may never fire
  `gamepadconnected`. The loop rescans whenever nothing is adopted, which also
  covers a device vanishing without a disconnect event, and falls back to
  another attached controller instead of going dead.
- **Wired vs Bluetooth is not distinguishable** — the Gamepad API exposes no
  transport field. It also does not need to be: the OS presents both as plain
  HID gamepads and they behave identically. The UI says "USB or Bluetooth"
  rather than inventing a transport indicator.
- `pickPad()` skips devices with fewer than two axes, so wheels, pedal boards and
  assorted Bluetooth accessories that enumerate as gamepads are ignored.
- Settings gains a device picker when more than one controller is attached, and
  a "Re-detect" action that re-applies the detected layout.

Verified: `tsc` 0, `eslint` 0, `electron-forge package` 0, Settings renders with
zero renderer errors, detection logic 15/15 against real device ids. **Still not
verified with physical hardware** — no controller is attached to this machine.

### RC transmitter support (RadioMaster Pocket)

Detection worked — sticks read correctly — but buttons showed nothing, which is
expected rather than broken: **a radio in EdgeTX USB joystick mode reports zero
HID buttons**, because its switches and pots arrive as extra *axes*. The button
grid was rendering 16 permanently-dead slots, which read as a fault.

- Zero-button devices now get an explanation instead of a dead grid, pointing at
  Bind + flick-a-switch (the `{t:'a',a,p}` path that already existed for exactly
  this case). The grid renders the real button count rather than padding to 16.
- New profiles for a device reporting zero buttons are seeded with **no**
  bindings, instead of button defaults that could never fire.
- **Channel-order presets** (AETR / AERT / RETA / TAER) generated from the radio
  convention A=aileron, E=elevator, T=throttle, R=rudder. One click beats
  wiggle-detecting four axes, and EdgeTX/OpenTX default to AETR.

**Throttle inversion bug — safety-relevant.** The RC profile inherited
`throttle: { invert: true }` from a gamepad layout. A gamepad's Y axis reports
-1 at the *top*, so inverting is right there. A radio reports -1 at throttle
*idle*, so inverting means a resting throttle stick commands **full power** — the
aircraft would leap the instant it armed. RC throttle is now un-inverted, and
`PROFILE_REV` was added so already-saved device profiles are rebuilt on next
connect rather than restored with the hazardous mapping.

Verified: `tsc` 0, `eslint` 0, `electron-forge package` 0, Settings renders with
zero renderer errors, channel-order presets resolve as intended (AETR ->
roll:ax0 pitch:ax1(inv) throttle:ax2 yaw:ax3, idle stick -> 0% throttle).

### "Suddenly not detected" — it was HMR, not detection

Diagnosed by logging `navigator.getGamepads()` from the poll loop via
`console.warn` (the Vite plugin forwards warn, not log — an earlier attempt with
`console.log` produced nothing). The device was in fact fine throughout:

    Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)
    mapping=none  axes=8  buttons=24  adopted=0  config=loaded

**Root cause: Vite hot-module replacement.** `input/gamepad.ts` owns singleton
runtime state — the rAF loop, the adopted device, previous-frame button and
switch edges. A hot swap builds a fresh module with `index = null` and no loop,
while the discarded copy's rAF keeps running against state nobody reads. The UI
then imports the empty instance and reports "no controller" with a pad plugged
in. Editing that file while the app was running is what triggered it.

Fixed with an HMR guard: `dispose` cancels the loop and `accept` calls
`invalidate()`, forcing a full reload rather than a partial swap. Any module
holding long-lived device or loop state needs this.

**Correction to the previous entry:** the Pocket reports 24 buttons, not zero, so
the zero-button path does not apply to it. The buttons enumerate but stay
unpressed until switches are mapped to them in EdgeTX (Model → USB Joystick →
channel mode Button). Binding seeds now key off device *kind* rather than button
count: `DEFAULT_BINDINGS` is an Xbox face-button layout whose indices are
meaningless on a radio, so radios start with no bindings and the pilot binds real
switches (captured as axis positions).

Verified: `tsc` 0, `eslint` 0, `electron-forge package` 0, Settings renders with
zero renderer errors, diagnostic fully removed.

### Intermittent detection — three real races

"Sometimes detected, sometimes not" was three separate timing bugs, found by
instrumenting adopt/clear as *events* plus a 5s heartbeat and watching a 90s run.

1. **Hydration race.** `attachGamepad()` ran on mount and could adopt a
   controller *before* the async `hydrate()` resolved. `adoptDevice` then wrote a
   profile against un-hydrated defaults, and hydrate subsequently replaced the
   whole settings object and pushed the on-disk config over it, discarding the
   profile for the device actually plugged in. Which side won was pure timing.
   Fixed by gating the attach effect on `hydrated`.
2. **Loop ownership.** StrictMode double-mounts effects, so two poll loops could
   exist briefly while `raf` was a single shared module-level handle — only the
   newer was cancellable and the older kept consuming button edges forever. Each
   loop now carries a generation token and exits once superseded.
3. **Focus flapping.** Chromium stops exposing gamepads while the window is
   unfocused, and the loop treated the first empty slot as a disconnect. A
   single alt-tab made the controller "vanish". Now tolerates ~0.5s of empty
   frames before dropping the device, and re-adopting the same device no longer
   re-notifies the store (a flap would otherwise clobber the pilot's mapping).

**Also observed, and expected rather than fixed:** `requestAnimationFrame` is
suspended outright while the window is backgrounded — a 22-second gap with zero
heartbeats appeared mid-run. Gamepad polling is therefore frozen whenever the
app is not the focused window, and resumes on return. Chromium also only routes
gamepad input to the focused window, so this cannot be worked around from the
renderer; it is also harmless, since the sim is not flyable unfocused.

After the fixes, a 90s run showed: 0 clear events, `miss=0` throughout, config
loaded, device continuously adopted.

Verified: `tsc` 0, `eslint` 0, `electron-forge package` 0, instrumentation removed.
