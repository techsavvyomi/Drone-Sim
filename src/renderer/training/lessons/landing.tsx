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

// Lesson 4 — Precision landing. Take off, then bring the drone down gently
// inside the landing circle. Scored on accuracy, descent rate and stability.
export const landingLesson: Lesson = {
  id: 'landing',
  order: 4,
  title: 'Landing',
  subtitle: 'Touch down on the pad',

  explain: {
    title: 'Landing',
    body: [
      'Reduce throttle gradually to descend — never cut the motors in the air.',
      'Aim to touch down softly inside the highlighted landing circle.',
      'You can also tap the take-off/land key to let the drone auto-land where it is.',
    ],
  },

  Scene: LandingHighlight,

  demo: [
    { at: 0.0, cmd: 'takeoffLand', caption: 'Take off to a hover' },
    { at: 3.4, caption: 'Now bring it down gently…' },
    { at: 3.8, cmd: 'takeoffLand', caption: 'Reduce throttle smoothly to descend' },
    { at: 6.8, caption: 'Soft touchdown inside the circle' },
  ],

  // Begin hovering so the drill is the descent, not the take-off.
  setup: () => {
    useFlightStore.getState().requestTakeoffLand();
  },

  practice: {
    prompt: 'Land softly inside the landing circle',
    hint: 'Fly over the circle, then reduce throttle to descend',
  },

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

    let hint: string;
    if (p.onGround && dist > PAD_R) hint = 'Off the pad — take off and line up again';
    else if (!p.onGround && dist > PAD_R) hint = 'Fly over the landing circle';
    else if (!p.onGround) hint = 'Reduce throttle to descend gently';
    else hint = 'Hold it steady on the pad';

    const done = mem.airborne === 1 && settled >= 1;
    return { done, progress: onPad ? settled : 0, hint };
  },

  score: ({ collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const dist = mem.finalDist ?? PAD_R;
    const vs = mem.touchVs ?? 1;
    if (dist <= PAD_R * 0.35 && vs <= 0.5 && smoothness >= 0.4) return 3;
    if (dist <= PAD_R * 0.7 && vs <= 0.9) return 2;
    return 1;
  },

  // Landing takes longer to set up than the button lessons.
  practiceTimeout: 35,
};
