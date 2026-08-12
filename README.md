# Drone Flight Simulator

A realistic multirotor flight simulator for STEM education and pilot training, built around
the [Drona Aviation](https://www.dronaaviation.com/) **Pluto** airframes.

It is a desktop app: real rigid-body physics, a proper flight controller with selectable
flight modes, live telemetry, and a guided **Flight School** that teaches a complete beginner
to arm, take off, hover and land before they ever touch real hardware.

---

## Features

- **Genuine flight model.** Fixed-timestep rigid-body simulation (Rapier) driven by a real
  rate/attitude PID stack and a motor mixer — not scripted animation. LiPo voltage sag, wind,
  aerodynamic drag and ground effect are all modelled, and a bad landing crashes the aircraft.
- **Three flight modes.** `stabilize` (self-levelling), `altitude-hold` (throttle springs to
  centre and commands climb rate) and `acro` (direct rate control, no auto-levelling).
- **Flight School.** Nine progressive lessons, each with a scripted demonstration flown
  through the *real* controller and physics, then a scored hands-on attempt.
- **Arm safety enforced.** The aircraft refuses to arm with the throttle raised, the way a
  real flight controller does — and the Arm lesson coaches you through it.
- **Full instrument HUD.** Artificial horizon, altitude tape, compass, stick indicators and
  streaming telemetry charts (uPlot).
- **Two airframes.** The **Pluto** 160 mm nano quad and the **Pluto Guru**, a 230 mm trainer
  with 135 mm props — 8x the mass, and a correspondingly heavier, calmer machine to fly. Both
  are real CAD models with independently spinning propellers.
- **Multiple environments.** Drone Arena, Drone Academy, Classroom and the Flight School
  classroom.
- **Keyboard or gamepad.** Mode-2 layout on both; whichever device you touched last flies the
  aircraft, so an idle gamepad never locks out the keyboard.

---

## Flight School curriculum

| # | Lesson | Focus |
|---|--------|-------|
| 1 | Arm | Wake the motors |
| 2 | Disarm | Cut the motors safely |
| 3 | Takeoff | Lift off smoothly |
| 4 | Throttle Control | Master your altitude |
| 5 | Yaw Control | Rotate on the spot |
| 6 | Pitch Control | Fly forward and back |
| 7 | Roll Control | Slide left and right |
| 8 | Hovering | Hold a rock-steady hover |
| 9 | Landing | Touch down on the pad |

Lessons are data, not hard-coded scenes. Adding one is a file in
[src/renderer/training/lessons/](src/renderer/training/lessons/) plus a line in its
[index.ts](src/renderer/training/lessons/index.ts) — the director, HUD and lesson-select
screen are generic.

---

## Controls

Mode-2 layout, matching a real transmitter: **left stick = throttle + yaw**, **right stick =
pitch + roll**.

| Action | Keyboard |
|--------|----------|
| Throttle up / down | `W` / `S` |
| Yaw left / right | `A` / `D` |
| Pitch forward / back | `↑` / `↓` |
| Roll left / right | `←` / `→` |
| Arm / disarm | `Enter` |
| Take off / land | `Space` |
| Cycle camera (chase → FPV → orbit) | `C` |
| Cycle flight mode | `M` |
| Reset aircraft | `R` |
| Toggle help | `H` |
| Pause / back out | `Esc` |

Gamepads (Xbox, PlayStation, and most USB controllers) are detected automatically via the
Gamepad API; axes and buttons are remappable in **Settings**.

---

## Getting started

**Prerequisites:** Node.js 20.19+ or 22.12+, and npm.

```bash
git clone https://github.com/techsavvyomi/Drone-Sim.git
cd Drone-Sim
npm install
npm start
```

`npm start` launches Electron with Vite HMR — edit anything under `src/renderer/` and the
window updates without losing your place.

### 3D assets

The drone and environment `.glb` models are **not** in the repository — they exceed GitHub's
100 MB file limit and are gitignored.

**A fresh clone will not build until you supply them.** The renderer imports each model as a
static asset, so an absent file is a build-time `Module not found`, not a graceful fallback.
The procedural-mesh fallback in [DroneModel.tsx](src/renderer/sim/drone/DroneModel.tsx) only
catches models that fail to *load or parse* at runtime.

Place these in `src/assets/models/`:

| File | Used by |
|------|---------|
| `PlutoX.opt.glb` | Pluto drone |
| `PlutoGuru.opt.glb` | Pluto Guru drone |
| `school_class_room.glb`, `warehouse.glb` | Environments |

The `.opt.glb` variants are produced from the raw CAD exports by
[scripts/prepare-drone-model.mjs](scripts/prepare-drone-model.mjs), which shrinks them ~10x
while keeping each propeller as a separately animatable node:

```bash
node scripts/prepare-drone-model.mjs "src/assets/models/PlutoX.glb" \
  src/assets/models/PlutoX.opt.glb

node scripts/prepare-drone-model.mjs "src/assets/models/Pluto Guru.glb" \
  src/assets/models/PlutoGuru.opt.glb \
  --props=Body1.010,Body1.019,Body1.009,Body1.020
```

Pass `--props` when the export gives the propellers no distinguishing name of their own — see
the script's header for how to find the right node names.

---

## Scripts

| Command | What it does |
|---------|--------------|
| `npm start` | Run the app in development with HMR |
| `npm run package` | Package the app for the current platform |
| `npm run make` | Build distributables (`.dmg`/zip, Squirrel `.exe`, `.deb`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint over `src/` |
| `npm run format` | Prettier over `src/` |

---

## Project structure

```
src/
├─ main.ts                  # Electron main: window lifecycle
├─ main/ipc/                # Typed IPC handlers (settings load/save, app info)
├─ preload.ts               # contextBridge surface
├─ shared/types/            # Contracts shared between main and renderer
└─ renderer/
   ├─ app/                  # Shell, home, settings, lesson select, training screen
   ├─ sim/
   │  ├─ control/           # Flight controller, PID stack, motor mixer
   │  ├─ dynamics/          # Battery, environmental forces
   │  └─ drone/             # Drone body, propellers, debris
   ├─ scene/                # Three.js / R3F world and environment rendering
   ├─ hud/                  # Instruments, overlays, training HUD
   ├─ input/                # Keyboard + gamepad, scripted-demo input
   ├─ training/             # Flight School director and lessons
   ├─ plugins/              # Registered drones and environments (data-driven)
   └─ state/                # Zustand stores (flight, sim, UI, training)
```

The architecture is deliberately **thin main, fat renderer**: physics, rendering and game
logic all live in the renderer; the main process owns only what a browser cannot do.

---

## Tech stack

Electron (Forge + Vite) · TypeScript (strict) · React 19 · Three.js + React Three Fiber +
drei · Rapier physics via `@react-three/rapier` · Zustand · uPlot

The full design rationale and phased roadmap live in `docs/PLAN.md`, which this branch keeps
local rather than committing.

---

## License

MIT © Drona Aviation
