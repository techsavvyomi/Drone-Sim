import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { holdFor, horizontalDist, type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';
import { FLIGHT_SCHOOL_PAD } from '../../plugins/environments/flightSchool';

const [PAD_X, PAD_Z] = FLIGHT_SCHOOL_PAD.center;
const PAD_R = FLIGHT_SCHOOL_PAD.radius;

/** A gently pulsing halo drawing the eye to the landing pad. */
function LandingHighlight() {
  const ring = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const s = 1 + 0.12 * Math.sin(t * 2.2);
    if (ring.current) ring.current.scale.set(s, s, 1);
    if (mat.current) mat.current.opacity = 0.35 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.2));
  });

  return (
    <mesh ref={ring} position={[PAD_X, 0.02, PAD_Z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[PAD_R * 1.15, PAD_R * 1.35, 48]} />
      <meshBasicMaterial ref={mat} color="#34d399" transparent opacity={0.4} depthWrite={false} />
    </mesh>
  );
}

// Step 2 — Land & Disarm. The mirror of Arm & Take Off, and taught as one action
// for the same reason: a landing is not finished until the motors are off. The
// drill deliberately fails if the pilot stops at touchdown.
export const landDisarmLesson: Lesson = {
  id: 'land-disarm',
  order: 14,
  title: 'Land & Disarm',
  subtitle: 'Come down and shut off',

  explain: {
    title: 'Landing and Disarming',
    body: [
      'Reduce throttle gradually to descend — never cut the motors in the air.',
      'Aim to touch down softly inside the highlighted landing circle.',
      'Then press ENTER to disarm. A drone left armed on the ground can spin its',
      'propellers unexpectedly, so the landing is not over until the motors are off.',
    ],
  },

  Scene: LandingHighlight,

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Armed and hovering' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.4, caption: 'Line up over the circle…' },
    { at: 3.8, cmd: 'takeoffLand', key: 'Space', caption: 'Reduce throttle smoothly to descend' },
    { at: 6.8, caption: 'Soft touchdown inside the circle' },
    { at: 7.8, cmd: 'disarm', key: 'Enter', caption: 'ENTER → motors stop. Safe to handle' },
  ],

  // Begin hovering so the drill is the descent and the shutdown, not the climb.
  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Land inside the circle, then disarm',
    hint: 'Fly over the circle, then reduce throttle to descend',
  },

  keys: [
    { code: 'KeyW', label: 'W', hint: 'Up' },
    { code: 'KeyS', label: 'S', hint: 'Down' },
    { code: 'Space', label: 'SPACE', hint: 'Auto-land' },
    { code: 'Enter', label: 'ENTER', hint: 'Disarm' },
  ],

  tips: [
    'Line up over the pad before you start descending.',
    'Descend slowly — a soft touchdown scores highest.',
    'Disarm immediately once you are down. It is also your fastest emergency stop.',
  ],
  commonMistakes: [
    'Cutting the motors while still in the air.',
    'Drifting off the pad during the descent.',
    'Walking away with the drone still armed.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Hard landing — try again' };

    if (p.altitude > 1.0) mem.airborne = 1;
    const dist = horizontalDist(p.position, PAD_X, PAD_Z);

    // Remember the fastest descent seen near the ground, for scoring the touchdown.
    if (!p.onGround && p.altitude < 1.0 && p.verticalSpeed < 0) {
      mem.touchVs = Math.max(mem.touchVs ?? 0, Math.abs(p.verticalSpeed));
    }

    const onPad = p.onGround && dist <= PAD_R;
    if (onPad) mem.finalDist = dist;
    const settled = holdFor(mem, 'settle', onPad && Math.abs(p.verticalSpeed) < 0.4, p.dt, 0.8);
    const landed = mem.airborne === 1 && settled >= 1;
    if (landed) mem.landed = 1;

    // Second half: the motors have to be off before this counts as finished.
    if (mem.landed) {
      if (!p.armed) return { done: true, progress: 1, hint: 'Down and disarmed — well flown' };
      return { done: false, progress: 0.8, hint: 'Down safely — now press ENTER to disarm' };
    }

    let hint: string;
    if (p.onGround && dist > PAD_R) hint = 'Off the pad — take off and line up again';
    else if (!p.onGround && dist > PAD_R) hint = 'Fly over the landing circle';
    else if (!p.onGround) hint = 'Reduce throttle to descend gently';
    else hint = 'Hold it steady on the pad';

    return { done: false, progress: onPad ? 0.6 * settled : 0, hint };
  },

  score: ({ collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const dist = mem.finalDist ?? PAD_R;
    const vs = mem.touchVs ?? 1;
    if (dist <= PAD_R * 0.35 && vs <= 0.5 && smoothness >= 0.4) return 3;
    if (dist <= PAD_R * 0.7 && vs <= 0.9) return 2;
    return 1;
  },

  practiceTimeout: 40,
};
