import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BallCollider,
  ConeCollider,
  CuboidCollider,
  CylinderCollider,
  RigidBody,
} from '@react-three/rapier';
import * as THREE from 'three';
import { useWorldStore } from '../../state/worldStore';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';
import { terrainHeight } from './Terrain';
import { concreteNormal } from './textures';

// Reusable academy props. Everything is procedural geometry — no external
// assets — and only objects a drone can realistically hit get colliders.

const YELLOW = '#e8c317';
const WHITE = '#eef2f5';

/* ---------------------------------------------------------------- Helipad */

export function Helipad({ position = [0, 0, 0] as [number, number, number] }) {
  const night = useWorldStore((s) => TIME_NIGHT(s.timeOfDay));
  const lights = ACADEMY_PAD.perimeterLights;
  // Radius and slab height come from ACADEMY_PAD because Flight School places
  // every lesson prop on this surface. Hard-coding them here once meant the two
  // could drift, and a pad 12 cm proud of the ground swallows anything drawn at
  // y = 0.
  const R = ACADEMY_PAD.radius;
  const H = ACADEMY_PAD.surfaceY;

  return (
    <group position={position}>
      {/* Concrete slab */}
      <RigidBody type="fixed" colliders={false}>
        {/* Circular pad, circular collider — the auto cuboid made the square
            around the pad solid. */}
        <CylinderCollider args={[H / 2, R]} position={[0, H / 2, 0]} />
        <mesh position={[0, H / 2, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[R, R, H, 48]} />
          <meshStandardMaterial
            color="#8d9193"
            normalMap={concreteNormal()}
            roughness={0.9}
            envMapIntensity={0.55}
          />
        </mesh>
      </RigidBody>

      {/* Yellow safety boundary */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1215, 0]}>
        <ringGeometry args={[6.1, 6.5, 64]} />
        <meshStandardMaterial color={YELLOW} roughness={0.7} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1215, 0]}>
        <ringGeometry args={[4.5, 4.62, 64]} />
        <meshStandardMaterial color={WHITE} roughness={0.7} />
      </mesh>

      {/* Painted "H" */}
      <group position={[0, 0.1225, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh position={[-1.05, 0, 0]}>
          <planeGeometry args={[0.52, 3.2]} />
          <meshStandardMaterial color={WHITE} roughness={0.8} />
        </mesh>
        <mesh position={[1.05, 0, 0]}>
          <planeGeometry args={[0.52, 3.2]} />
          <meshStandardMaterial color={WHITE} roughness={0.8} />
        </mesh>
        <mesh>
          <planeGeometry args={[1.6, 0.52]} />
          <meshStandardMaterial color={WHITE} roughness={0.8} />
        </mesh>
      </group>

      {/* Perimeter landing lights */}
      {Array.from({ length: lights }, (_, i) => {
        const a = (i / lights) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * ACADEMY_PAD.lightRadius, 0.18, Math.sin(a) * ACADEMY_PAD.lightRadius]}>
            <sphereGeometry args={[0.09, 8, 8]} />
            <meshStandardMaterial
              color={night ? '#fff2c0' : '#c8cdd0'}
              emissive={night ? '#ffd257' : '#000000'}
              emissiveIntensity={night ? 2.2 : 0}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function TIME_NIGHT(t: string): boolean {
  return t === 'night';
}

/* ------------------------------------------------------------------ Gates */

export type GateKind = 'square' | 'circle' | 'rect';

/** How many boxes stand in for a ring gate's torus. See `RaceGate`. */
const RING_SEGMENTS = 24;

export function RaceGate({
  position,
  rotation = [0, 0, 0],
  kind = 'square',
  color = '#2f7fff',
  size = 3,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  kind?: GateKind;
  color?: string;
  size?: number;
}) {
  const night = useWorldStore((s) => TIME_NIGHT(s.timeOfDay));
  const glow = night ? 2.4 : 0.55;
  const mat = (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={glow}
      roughness={0.4}
      toneMapped={false}
    />
  );

  const w = kind === 'rect' ? size * 1.5 : size;
  const h = size;
  const t = size * 0.07;
  const legH = position[1] - h / 2;

  return (
    // The frame is SOLID and the opening is not — which is the whole of what a
    // gate is, and it was the one part of it the physics did not know. Until
    // this, an upright could be flown through as readily as the hole beside it,
    // so the three navigation modules could be "flown" straight at the frame.
    //
    // Explicit colliders, never `colliders="cuboid"`: the automatic hull round
    // a torus is a solid slab across the ring, and the hull round four bars is a
    // solid pane over the opening. Either way the gate stops being a gate.
    <RigidBody type="fixed" colliders={false} position={position} rotation={rotation}>
      {kind === 'circle' ? (
        // Rapier has no torus, so the ring is walled with a polygon of thin
        // boxes, each one a chord of it. The COUNT is the thing to get right: a
        // chord bows inside the true circle by R(1 - cos(pi/N)), and collider
        // standing in front of a visible surface is the mistake that makes a
        // map feel broken — a gentle approach sinks into nothing and is shoved
        // back out. At 24 that bow is 1.5 cm on the widest ring here, well
        // inside the drone's own body, and it stays clear of the volume the
        // lesson scores (`arena.ts` judges a pass at 0.45 x size, against a rim
        // at 0.451 x size).
        Array.from({ length: RING_SEGMENTS }, (_, i) => {
          const a = (i / RING_SEGMENTS) * Math.PI * 2;
          const tube = t * 0.7;
          return (
            <CuboidCollider
              key={i}
              args={[Math.sin(Math.PI / RING_SEGMENTS) * (size / 2) + tube, tube, tube]}
              position={[Math.cos(a) * (size / 2), Math.sin(a) * (size / 2), 0]}
              rotation={[0, 0, a + Math.PI / 2]}
            />
          );
        })
      ) : (
        // One box per bar, at the bar's own size and place. Fitting them to the
        // FRAME's bounds instead would wall the hole shut.
        <>
          <CuboidCollider args={[w / 2, t / 2, t / 2]} position={[0, h / 2, 0]} />
          <CuboidCollider args={[w / 2, t / 2, t / 2]} position={[0, -h / 2, 0]} />
          <CuboidCollider args={[t / 2, h / 2, t / 2]} position={[-w / 2, 0, 0]} />
          <CuboidCollider args={[t / 2, h / 2, t / 2]} position={[w / 2, 0, 0]} />
        </>
      )}
      {/* The legs, on the same test the meshes below use: a gate hung low
          enough to have none must not grow invisible ones. */}
      {legH > 0.2 &&
        [-w / 2, w / 2].map((x) => (
          <CylinderCollider key={x} args={[legH / 2, 0.06]} position={[x, -h / 2 - legH / 2, 0]} />
        ))}
      {kind === 'circle' ? (
        <mesh castShadow>
          <torusGeometry args={[size / 2, t * 0.7, 12, 40]} />
          {mat}
        </mesh>
      ) : (
        <>
          <mesh position={[0, h / 2, 0]} castShadow>
            <boxGeometry args={[w, t, t]} />
            {mat}
          </mesh>
          <mesh position={[0, -h / 2, 0]} castShadow>
            <boxGeometry args={[w, t, t]} />
            {mat}
          </mesh>
          <mesh position={[-w / 2, 0, 0]} castShadow>
            <boxGeometry args={[t, h, t]} />
            {mat}
          </mesh>
          <mesh position={[w / 2, 0, 0]} castShadow>
            <boxGeometry args={[t, h, t]} />
            {mat}
          </mesh>
        </>
      )}

      {/* Support legs down to the ground */}
      {legH > 0.2 && (
        <>
          <mesh position={[-w / 2, -h / 2 - legH / 2, 0]}>
            <cylinderGeometry args={[0.05, 0.06, legH, 8]} />
            <meshStandardMaterial color="#2b3038" roughness={0.7} />
          </mesh>
          <mesh position={[w / 2, -h / 2 - legH / 2, 0]}>
            <cylinderGeometry args={[0.05, 0.06, legH, 8]} />
            <meshStandardMaterial color="#2b3038" roughness={0.7} />
          </mesh>
        </>
      )}
    </RigidBody>
  );
}

/* ------------------------------------------------------------------ Cones */

export function TrafficCone({ position }: { position: [number, number, number] }) {
  return (
    // Solid. The slalom is nine cones to be flown AROUND — a cone the drone
    // passes through is a mark painted on the grass, not an obstacle, and the
    // yaw drill it exists for has nothing left to get wrong.
    <RigidBody type="fixed" colliders={false} position={position}>
      <ConeCollider args={[0.26, 0.17]} position={[0, 0.28, 0]} />
      <CuboidCollider args={[0.21, 0.02, 0.21]} position={[0, 0.02, 0]} />
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[0.42, 0.04, 0.42]} />
        <meshStandardMaterial color="#25282c" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.28, 0]} castShadow>
        <coneGeometry args={[0.17, 0.52, 14]} />
        <meshStandardMaterial color="#ef6c1f" roughness={0.65} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.125, 0.145, 0.09, 14]} />
        <meshStandardMaterial color={WHITE} roughness={0.6} />
      </mesh>
    </RigidBody>
  );
}

/* --------------------------------------------------------- Landing target */

export function LandingTarget({
  position,
  label,
  color,
}: {
  position: [number, number, number];
  label: string;
  color: string;
}) {
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]} receiveShadow>
        <circleGeometry args={[1.25, 40]} />
        <meshStandardMaterial
          color="#2c3136"
          roughness={0.9}
          polygonOffset
          polygonOffsetFactor={-6}
          polygonOffsetUnits={-6}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, 0]}>
        <ringGeometry args={[0.95, 1.15, 40]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, 0]}>
        <ringGeometry args={[0.4, 0.5, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
      {/* Corner ticks read as a pad marking without needing text geometry */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return (
          <mesh
            key={`${label}-${i}`}
            position={[Math.cos(a) * 1.05, 0.018, Math.sin(a) * 1.05]}
            rotation={[-Math.PI / 2, 0, -a]}
          >
            <planeGeometry args={[0.34, 0.1]} />
            <meshStandardMaterial color={WHITE} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------- Hover boxes */

/**
 * A wireframe cube hanging in the air, to hold a hover INSIDE.
 *
 * The one prop in the academy that is deliberately left with no collider. Every
 * other solid thing here now stops the drone; this is a target volume, and the
 * exercise is to sit in the middle of it. Give it a shell and the exercise
 * becomes impossible rather than harder — which is the same reason a gate's
 * opening is left clear while its frame is not.
 */
export function HoverBox({
  position,
  size = 2,
  color = '#38bdf8',
}: {
  position: [number, number, number];
  size?: number;
  color?: string;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((s) => {
    if (ref.current) ref.current.position.y = position[1] + Math.sin(s.clock.elapsedTime * 0.8) * 0.08;
  });

  return (
    <group ref={ref} position={position}>
      <mesh>
        <boxGeometry args={[size, size, size]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.12}
          roughness={0.1}
          metalness={0}
          depthWrite={false}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(size, size, size)]} />
        <lineBasicMaterial color={color} transparent opacity={0.85} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

/* ---------------------------------------------------------- Waypoint tower */

export function WaypointTower({
  position,
  height = 4,
  color = '#37e08a',
  index = 0,
}: {
  position: [number, number, number];
  height?: number;
  color?: string;
  index?: number;
}) {
  const led = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((s) => {
    if (led.current) {
      led.current.emissiveIntensity = 1.2 + Math.sin(s.clock.elapsedTime * 2 + index) * 0.8;
    }
  });

  return (
    <group position={position}>
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[0, height / 2, 0]} castShadow>
          <boxGeometry args={[0.16, height, 0.16]} />
          <meshStandardMaterial color="#3a4048" roughness={0.7} metalness={0.3} />
        </mesh>
      </RigidBody>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <cylinderGeometry args={[0.42, 0.5, 0.12, 12]} />
        <meshStandardMaterial color="#2a2f36" roughness={0.9} />
      </mesh>
      <mesh position={[0, height + 0.14, 0]}>
        <sphereGeometry args={[0.16, 12, 12]} />
        <meshStandardMaterial
          ref={led}
          color={color}
          emissive={color}
          emissiveIntensity={1.6}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ Scenery */

export function Windsock({ position }: { position: [number, number, number] }) {
  const sock = useRef<THREE.Group>(null);
  useFrame((s) => {
    if (sock.current) {
      sock.current.rotation.y = Math.sin(s.clock.elapsedTime * 0.4) * 0.4;
      sock.current.rotation.z = -1.05 + Math.sin(s.clock.elapsedTime * 1.5) * 0.12;
    }
  });

  return (
    // The MAST only. The sock is cloth on a swivel that turns with the wind, and
    // a hard shell round something that visibly swings would be a collider in a
    // place the pilot watched it leave.
    <RigidBody type="fixed" colliders={false} position={position}>
      <CylinderCollider args={[2, 0.08]} position={[0, 2, 0]} />
      <mesh position={[0, 2, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 4, 10]} />
        <meshStandardMaterial color="#9aa3ad" metalness={0.7} roughness={0.35} envMapIntensity={1.2} />
      </mesh>
      <group ref={sock} position={[0, 3.9, 0]}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[0.32 + i * 0.42, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.3 - i * 0.045, 0.34 - i * 0.045, 0.42, 12, 1, true]} />
            <meshStandardMaterial
              color={i % 2 ? WHITE : '#ef5b25'}
              side={THREE.DoubleSide}
              roughness={0.8}
            />
          </mesh>
        ))}
      </group>
    </RigidBody>
  );
}

export function EquipmentBox({
  position,
  color = '#2f6fb3',
  size = [1.1, 0.7, 0.8],
}: {
  position: [number, number, number];
  color?: string;
  size?: [number, number, number];
}) {
  return (
    <RigidBody type="fixed" colliders="cuboid" position={position}>
      <mesh position={[0, size[1] / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[0, size[1] + 0.02, 0]} castShadow>
        <boxGeometry args={[size[0] * 1.04, 0.05, size[2] * 1.04]} />
        <meshStandardMaterial color="#20252b" roughness={0.7} />
      </mesh>
    </RigidBody>
  );
}

export function Tree({
  position,
  scale = 1,
  variant = 0,
}: {
  position: [number, number, number];
  scale?: number;
  /** Alternates between conifer and broadleaf so a treeline isn't uniform. */
  variant?: number;
}) {
  const conifer = variant % 2 === 0;
  // Deterministic per-tree jitter: identical trees read as instanced clones.
  const lean = ((variant * 37) % 7) / 90;
  const twist = ((variant * 53) % 100) / 100;

  return (
    <group position={position} scale={scale} rotation={[lean, twist * Math.PI, lean * 0.6]}>
      {/* Trunk and canopy, both solid, and INSIDE the scaled group so the
          colliders take the tree's own scale with it — a body hung outside it
          would collide at the size of the smallest tree in the line.

          The treeline stands outside the fence, which is not the same as out of
          reach: the fence is 2.4 m of a 30 m ceiling, so the drone flies over it
          and the arena's bounds (60 m square) run past the trees at the corners.
          One cone or one ball for the whole canopy rather than one per tier or
          lobe — nobody threads the inside of a tree, and the difference is 34
          bodies against 170. */}
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[1.05, 0.2]} position={[0, 1.05, 0]} />
        {conifer ? (
          <ConeCollider args={[1.72, 1.32]} position={[0, 3.07, 0]} />
        ) : (
          <BallCollider args={[1.5]} position={[0, 2.95, 0]} />
        )}
      </RigidBody>

      {/* Tapered trunk */}
      <mesh position={[0, 1.05, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.26, 2.1, 7]} />
        <meshStandardMaterial color="#4a3a2a" roughness={0.96} />
      </mesh>

      {conifer ? (
        // Stacked, shrinking, slightly offset tiers rather than one cone.
        [0, 1, 2, 3].map((i) => (
          <mesh
            key={i}
            position={[0, 2.1 + i * 0.72, 0]}
            rotation={[0, i * 0.7, 0]}
            castShadow
          >
            <coneGeometry args={[1.32 - i * 0.27, 1.5 - i * 0.15, 8]} />
            <meshStandardMaterial
              color={i % 2 ? '#33642f' : '#2b5629'}
              roughness={0.92}
              flatShading
            />
          </mesh>
        ))
      ) : (
        // Broadleaf: overlapping spheres give an irregular canopy.
        [
          [0, 2.9, 0, 1.35],
          [0.62, 2.55, 0.28, 0.95],
          [-0.55, 2.62, -0.35, 0.88],
          [0.12, 3.45, -0.5, 0.8],
        ].map(([x, y, z, r], i) => (
          <mesh key={i} position={[x, y, z]} castShadow>
            <sphereGeometry args={[r, 9, 7]} />
            <meshStandardMaterial
              color={i % 2 ? '#3d6b32' : '#456f38'}
              roughness={0.95}
              flatShading
            />
          </mesh>
        ))
      )}
    </group>
  );
}

export function Floodlight({
  position,
  rotationY = 0,
}: {
  position: [number, number, number];
  rotationY?: number;
}) {
  const night = useWorldStore((s) => TIME_NIGHT(s.timeOfDay));
  return (
    <RigidBody type="fixed" colliders={false} position={position} rotation={[0, rotationY, 0]}>
      {/* An 8 m mast standing at the edge of the practice area, and the lamp
          head on top of it — the one thing here the drone meets at height
          rather than on the ground. Both boxed at the size they are drawn: the
          head is two lamps side by side, taken as the one block they read as. */}
      <CylinderCollider args={[4, 0.14]} position={[0, 4, 0]} />
      <CuboidCollider args={[0.85, 0.32, 0.14]} position={[0, 8.1, 0.2]} rotation={[0.5, 0, 0]} />
      <mesh position={[0, 4, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.14, 8, 10]} />
        <meshStandardMaterial color="#767f89" metalness={0.75} roughness={0.34} envMapIntensity={1.2} />
      </mesh>
      {[-0.45, 0.45].map((x) => (
        <mesh key={x} position={[x, 8.1, 0.2]} rotation={[0.5, 0, 0]} castShadow>
          <boxGeometry args={[0.8, 0.55, 0.22]} />
          <meshStandardMaterial
            color="#c9d2da"
            emissive={night ? '#fff4d0' : '#000000'}
            emissiveIntensity={night ? 2.6 : 0}
            toneMapped={false}
          />
        </mesh>
      ))}
      {night && <pointLight position={[0, 7.6, 1]} intensity={90} distance={40} color="#ffeec2" />}
    </RigidBody>
  );
}

/**
 * The hangar's arched roof, as the collider has to see it.
 *
 * These describe the shell drawn inside `Hangar` and must not drift from it:
 * `SEGMENTS` is that `cylinderGeometry`'s own radial-segment count, which is
 * what lets each collider box land exactly on one drawn facet.
 */
const ROOF_R = 5.1;
const ROOF_SEGMENTS = 20;
const ROOF_HALF_LEN = 8;
const ROOF_THICKNESS = 0.12;
/** Height of the eaves — the arch's centre, and the top of the walls. */
const ROOF_EAVE_Y = 6;

export function Hangar({ position, rotationY = 0 }: { position: [number, number, number]; rotationY?: number }) {
  return (
    // Explicit collider only. With colliders="cuboid" the half-cylinder roof
    // generated a ~10x10x16 m invisible box around the building, and the flat
    // door plane produced a degenerate collider — both of which the drone hit
    // well away from any visible surface.
    //
    // Two shapes, because the building is two shapes. A single box across both
    // was the whole hangar's collider for a while: it stopped at y = 8.4 while
    // the arched roof reaches 11.1, so a drone coming in over the top passed
    // straight through the roof skin and came to rest INSIDE the building, three
    // metres below the ridge — the clearest possible version of an obstacle the
    // pilot can see and fly through. The same box was also 2.4 m taller than the
    // walls it was standing in for, and 0.5 m wider than the arch above them, so
    // approaching the eaves from the side hit nothing at all.
    <RigidBody type="fixed" colliders={false} position={position} rotation={[0, rotationY, 0]}>
      {/* Walls: exactly the box that is drawn. */}
      <CuboidCollider args={[8, 3, 5]} position={[0, 3, 0]} />
      {/* Roof: one box per facet of the arch, exactly as the ring gates wall
          their torus.
          A single cylinder collider is the obvious shape and cannot be made to
          fit. Its radius has to come down to 5.0 to stay inside the walls —
          anything wider bulges past them in the last metre under the eaves and
          puts an invisible ledge down the side of the building — and at 5.0 it
          sits 10 cm inside a 5.1 m roof, which is a third of a Pluto's width of
          roof the drone sinks into before anything stops it.
          The shell is drawn as a 20-sided fan, so 20 chords ARE the surface:
          each box's outer face is placed on its facet's own plane, which is
          neither proud of the roof nor behind it. Being boxes they also stop at
          the eaves instead of continuing down past the walls. */}
      {Array.from({ length: ROOF_SEGMENTS }, (_, i) => {
        const step = Math.PI / ROOF_SEGMENTS;
        // Facet centre, measured round the arch from the right-hand eave.
        const a = (i + 0.5) * step;
        // Half-chord, and the distance out to the facet's plane — less the
        // box's own thickness, so its OUTER face is the one that lands there.
        const chord = ROOF_R * Math.sin(step / 2);
        const depth = ROOF_R * Math.cos(step / 2) - ROOF_THICKNESS;
        return (
          <CuboidCollider
            key={i}
            args={[ROOF_HALF_LEN, ROOF_THICKNESS, chord]}
            position={[0, ROOF_EAVE_Y + depth * Math.sin(a), depth * Math.cos(a)]}
            rotation={[Math.PI / 2 - a, 0, 0]}
          />
        );
      })}

      <mesh position={[0, 3, 0]} castShadow receiveShadow>
        <boxGeometry args={[16, 6, 10]} />
        <meshStandardMaterial color="#7a838d" roughness={0.62} metalness={0.35} envMapIntensity={0.9} />
      </mesh>
      {/* Ribbed cladding — flat metal walls read as untextured boxes. */}
      {Array.from({ length: 15 }, (_, i) => (
        <mesh key={i} position={[-7.5 + i * 1.07, 3, 5.03]} castShadow>
          <boxGeometry args={[0.09, 5.9, 0.06]} />
          <meshStandardMaterial color="#69727c" roughness={0.6} metalness={0.4} />
        </mesh>
      ))}
      {/* Roof edge trim */}
      <mesh position={[0, 6.05, 0]}>
        <boxGeometry args={[16.3, 0.18, 10.3]} />
        <meshStandardMaterial color="#5d666f" roughness={0.55} metalness={0.5} />
      </mesh>
      {/* Curved roof (visual only) */}
      <mesh position={[0, 6, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[5.1, 5.1, 16, 20, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#98a2ac" roughness={0.5} metalness={0.55} envMapIntensity={1.1} side={THREE.DoubleSide} />
      </mesh>
      {/* Door opening (visual only) */}
      <mesh position={[0, 2.2, 5.02]}>
        <planeGeometry args={[7, 4.4]} />
        <meshStandardMaterial color="#20262d" roughness={0.9} />
      </mesh>
    </RigidBody>
  );
}

export function ControlTower({ position }: { position: [number, number, number] }) {
  const night = useWorldStore((s) => TIME_NIGHT(s.timeOfDay));
  return (
    // Cylinder colliders: a cuboid hull around the mast and cab made the tower
    // noticeably wider to hit than it looks.
    <RigidBody type="fixed" colliders={false} position={position}>
      {/* The mast TAPERS, 2.1 m at the foot to 1.6 m under the cab, so one
          cylinder at its base radius stands up to half a metre proud of the
          shaft the pilot is looking at. Two stacked segments, each taken at the
          radius of its own top edge, sit inside the cone the whole way up. */}
      <CylinderCollider args={[2.5, 1.85]} position={[0, 2.5, 0]} />
      <CylinderCollider args={[2.5, 1.6]} position={[0, 7.5, 0]} />
      <CylinderCollider args={[1.2, 3.2]} position={[0, 11.2, 0]} />

      <mesh position={[0, 5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.6, 2.1, 10, 14]} />
        <meshStandardMaterial color="#8b949e" roughness={0.7} metalness={0.2} envMapIntensity={0.8} />
      </mesh>
      <mesh position={[0, 10.8, 0]} castShadow>
        <cylinderGeometry args={[3.1, 2.6, 2.4, 14]} />
        <meshStandardMaterial
          color="#1d3040"
          emissive={night ? '#3e5f7a' : '#0a1420'}
          emissiveIntensity={night ? 0.8 : 0.15}
          roughness={0.25}
          metalness={0.5}
        />
      </mesh>
      <mesh position={[0, 12.2, 0]} castShadow>
        <cylinderGeometry args={[3.35, 3.35, 0.3, 14]} />
        <meshStandardMaterial color="#5d666f" roughness={0.8} />
      </mesh>
      {/* Mullions between the cab glazing */}
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 2.95, 10.8, Math.sin(a) * 2.95]} rotation={[0, -a, 0]}>
            <boxGeometry args={[0.08, 2.4, 0.12]} />
            <meshStandardMaterial color="#5d666f" roughness={0.6} metalness={0.4} />
          </mesh>
        );
      })}
      {/* Gallery railing */}
      {Array.from({ length: 20 }, (_, i) => {
        const a = (i / 20) * Math.PI * 2;
        return (
          <mesh key={`r${i}`} position={[Math.cos(a) * 3.3, 12.75, Math.sin(a) * 3.3]}>
            <boxGeometry args={[0.05, 0.9, 0.05]} />
            <meshStandardMaterial color="#6f7883" metalness={0.5} roughness={0.6} />
          </mesh>
        );
      })}
      <mesh position={[0, 13.2, 0]}>
        <torusGeometry args={[3.3, 0.04, 6, 28]} />
        <meshStandardMaterial color="#6f7883" metalness={0.5} roughness={0.6} />
      </mesh>
      <mesh position={[0, 13.2, 0]}>
        <sphereGeometry args={[0.18, 10, 10]} />
        <meshStandardMaterial color="#ff4444" emissive="#ff2222" emissiveIntensity={2} toneMapped={false} />
      </mesh>
    </RigidBody>
  );
}

export function Bench({ position, rotationY = 0 }: { position: [number, number, number]; rotationY?: number }) {
  return (
    <RigidBody type="fixed" colliders={false} position={position} rotation={[0, rotationY, 0]}>
      {/* One box round seat, back and legs. The bench is 2 m of furniture
          standing 11 m off the pad, which is exactly where a beginner's first
          drift takes them. Fitted to what is drawn — the back leans 0.26 m
          behind the seat, so the box is off-centre in z rather than square. */}
      <CuboidCollider args={[1, 0.415, 0.37]} position={[0, 0.415, -0.09]} />
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[2, 0.09, 0.55]} />
        <meshStandardMaterial color="#8a6a44" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.78, -0.26]} rotation={[-0.25, 0, 0]} castShadow>
        <boxGeometry args={[2, 0.09, 0.4]} />
        <meshStandardMaterial color="#8a6a44" roughness={0.9} />
      </mesh>
      {[-0.85, 0.85].map((x) => (
        <mesh key={x} position={[x, 0.22, 0]} castShadow>
          <boxGeometry args={[0.09, 0.45, 0.5]} />
          <meshStandardMaterial color="#3c4249" roughness={0.7} metalness={0.3} />
        </mesh>
      ))}
    </RigidBody>
  );
}

/** Chain-link style fence run along +X. */
export function FenceRun({
  from,
  to,
  height = 2.4,
}: {
  from: [number, number];
  to: [number, number];
  height?: number;
}) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);
  const posts = Math.max(2, Math.round(len / 4));

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[(from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2]}
      rotation={[0, angle, 0]}
    >
      {/* The whole panel, not the posts. Chain-link is see-through, which is why
          it is drawn at 0.18 opacity — it is not fly-through, and a fence the
          drone crossed anywhere but over the top would be scenery. The run
          points down local Z (the posts are laid out along it), so the wall is
          thin in x and as long as the run in z.

          It stops at 2.4 m ON PURPOSE, unlike Flight School's boundary walls,
          which collide to the ceiling. Those walls ARE the edge of the world;
          this is a fence round a field with 30 m of sky over it, and the arena's
          own soft containment is what turns the drone back at the bounds. */}
      <CuboidCollider args={[0.05, height / 2, len / 2]} position={[0, height / 2, 0]} />
      <mesh position={[0, height / 2, 0]}>
        <planeGeometry args={[0.02, height]} />
        <meshStandardMaterial visible={false} />
      </mesh>
      {/* Mesh panel */}
      <mesh position={[0, height / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[len, height]} />
        <meshStandardMaterial
          color="#9aa5b0"
          transparent
          opacity={0.18}
          side={THREE.DoubleSide}
          roughness={0.8}
          metalness={0.4}
        />
      </mesh>
      {/* Posts */}
      {Array.from({ length: posts + 1 }, (_, i) => (
        <mesh key={i} position={[0, height / 2, -len / 2 + (i * len) / posts]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, height, 8]} />
          <meshStandardMaterial color="#6f7883" metalness={0.5} roughness={0.6} />
        </mesh>
      ))}
      {/* Top rail */}
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.035, 0.035, len, 8]} />
        <meshStandardMaterial color="#6f7883" metalness={0.5} roughness={0.6} />
      </mesh>
    </RigidBody>
  );
}

/** Distant mountain ring — big, cheap, and never collided with. */
export function Mountains() {
  // Two ridge lines at different distances. Fog does the aerial-perspective
  // work: the far ridge washes out toward the sky colour while the near one
  // keeps some contrast, which is what actually sells distance. A single ring
  // of identical cones reads as a paper cut-out no matter how it's shaded.
  const ridges = useMemo(() => {
    const out: {
      pos: [number, number, number];
      radius: number;
      height: number;
      seg: number;
      rot: number;
      squash: number;
      color: string;
      snow: boolean;
    }[] = [];

    const build = (
      count: number,
      rMin: number,
      rSpread: number,
      hMin: number,
      hSpread: number,
      color: string,
    ) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + ((i * 17) % 11) / 40;
        const r = rMin + ((i * 37) % rSpread);
        const h = hMin + ((i * 53) % hSpread);
        out.push({
          // Seat each peak on the rolling terrain it stands on, sunk a few
          // metres so no gap can open between the cone and the ground.
          pos: [
            Math.cos(a) * r,
            terrainHeight(Math.cos(a) * r, Math.sin(a) * r) + h / 2 - 5,
            Math.sin(a) * r,
          ],
          radius: h * (0.5 + ((i * 29) % 30) / 100),
          height: h,
          seg: 4 + (i % 3),
          rot: ((i * 41) % 100) / 16,
          squash: 0.7 + ((i * 23) % 60) / 100,
          color,
          snow: h > hMin + hSpread * 0.62,
        });
      }
    };

    // Near ridge: lower, darker, more contrast.
    build(20, 175, 45, 40, 46, '#556b7c');
    // Far ridge: taller, paler — reads as many kilometres away.
    build(16, 250, 55, 70, 70, '#7a8ea0');
    return out;
  }, []);

  return (
    <group>
      {ridges.map((m, i) => (
        <group key={i} position={m.pos} rotation={[0, m.rot, 0]} scale={[m.squash, 1, 1]}>
          <mesh>
            <coneGeometry args={[m.radius, m.height, m.seg]} />
            <meshStandardMaterial color={m.color} roughness={1} flatShading />
          </mesh>
          {m.snow && (
            <mesh position={[0, m.height * 0.34, 0]}>
              <coneGeometry args={[m.radius * 0.34, m.height * 0.32, m.seg]} />
              <meshStandardMaterial color="#e8eef5" roughness={0.9} flatShading />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

export function MaintenanceTent({ position }: { position: [number, number, number] }) {
  return (
    <RigidBody type="fixed" colliders={false} position={position}>
      {/* The canopy is a four-sided cone — a pyramid whose corners point down
          x and z — so the collider is a box turned 45 degrees to sit on its
          EDGES: half a side is 4.2 / sqrt(2). Squared up to the axes instead it
          would be a 8.4 m block with two metres of solid nothing at each corner.
          It is boxed rather than tapered, so the very top overhangs the slope by
          a little; a roof is a roof, and the alternative is four sloped hulls
          for a prop nothing is flown through. */}
      <CuboidCollider args={[2.97, 1.1, 2.97]} position={[0, 2.5, 0]} rotation={[0, Math.PI / 4, 0]} />
      {[
        [-2.6, -2.6],
        [2.6, -2.6],
        [-2.6, 2.6],
        [2.6, 2.6],
      ].map(([x, z]) => (
        <CylinderCollider key={`${x},${z}`} args={[0.8, 0.06]} position={[x, 0.8, z]} />
      ))}
      <CuboidCollider args={[1.2, 0.04, 0.45]} position={[0, 0.8, -1.2]} />
      <mesh position={[0, 2.5, 0]} castShadow>
        <coneGeometry args={[4.2, 2.2, 4]} />
        <meshStandardMaterial color="#b8452f" roughness={0.85} />
      </mesh>
      {[
        [-2.6, -2.6],
        [2.6, -2.6],
        [-2.6, 2.6],
        [2.6, 2.6],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.8, z]} castShadow>
          <cylinderGeometry args={[0.06, 0.06, 1.6, 8]} />
          <meshStandardMaterial color="#8b939c" metalness={0.5} roughness={0.6} />
        </mesh>
      ))}
      {/* Tool table under the canopy */}
      <mesh position={[0, 0.8, -1.2]} castShadow>
        <boxGeometry args={[2.4, 0.08, 0.9]} />
        <meshStandardMaterial color="#7d848c" metalness={0.4} roughness={0.6} />
      </mesh>
    </RigidBody>
  );
}

export function ChargingStation({ position }: { position: [number, number, number] }) {
  const night = useWorldStore((s) => TIME_NIGHT(s.timeOfDay));
  return (
    <group position={position}>
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[0, 0.9, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.5, 1.8, 0.7]} />
          <meshStandardMaterial color="#2f3a45" roughness={0.6} metalness={0.35} />
        </mesh>
      </RigidBody>
      <mesh position={[0, 1.35, 0.37]}>
        <planeGeometry args={[1.0, 0.6]} />
        <meshStandardMaterial
          color="#0f2030"
          emissive="#1e6fa8"
          emissiveIntensity={night ? 1.4 : 0.5}
          toneMapped={false}
        />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-0.45 + i * 0.45, 0.35, 0.37]}>
          <sphereGeometry args={[0.07, 8, 8]} />
          <meshStandardMaterial color="#37e08a" emissive="#37e08a" emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
