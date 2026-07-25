import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { DroneSpec } from '@shared/types';
import { DEG2RAD } from '../mathx';
import { DroneMesh } from './DroneMesh';
import { propHubs } from './propHubs';
import { useSimStore } from '../../state/simStore';
import { useFlightStore } from '../../state/flightStore';
import { damp } from '../mathx';

// Loads a drone's .glb visual. The model is purely cosmetic — physics always
// uses the simple box collider on the RigidBody, so mesh complexity never
// affects simulation stability or cost.
//
// Falls back to the procedural mesh if the asset is missing or fails to parse,
// so the sim is never unflyable because of an art problem.

/** One propeller: a pivot at its hub, and the motor index driving it. */
interface PropRotor {
  pivot: THREE.Group;
  motor: number;
  /** Blade materials, faded out as RPM rises. */
  blades: THREE.Material[];
}

function Gltf({ spec, idleSpin = 0 }: { spec: DroneSpec; idleSpin?: number }) {
  const { scene } = useGLTF(spec.model!);
  const rotors = useRef<PropRotor[]>([]);
  const rpm = useRef<number[]>([0, 0, 0, 0]);
  // Clone so multiple drones (and StrictMode double-mounts) don't share one graph.
  const model = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        // CAD exports often ship double-sided; single-sided halves the fill cost.
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => (m.side = THREE.FrontSide));
        else if (mat) mat.side = THREE.FrontSide;
      }
    });

    return root;
  }, [scene]);


  // ---- Make the real propellers spin ----
  // Built in a layout effect, NOT inside the useMemo that clones the model.
  // Under StrictMode the memo factory runs twice, and <primitive> cannot swap
  // its object — so pivots created during the discarded render belonged to a
  // model that was never added to the scene. Rotating those moved nothing while
  // the transform counters happily climbed. Running here guarantees the pivots
  // belong to the object actually on screen.
  useLayoutEffect(() => {
    const root = model;
    const found: PropRotor[] = [];
    const yaw = (spec.modelYawDeg ?? 0) * DEG2RAD;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    root.updateWorldMatrix(true, true);

    // Only outermost PROP_ nodes — the tagged ones nest wrapper inside wrapper.
    const tops: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (!o.name.startsWith('PROP_')) return;
      for (let p = o.parent; p; p = p.parent) {
        if (p.name.startsWith('PROP_')) return;
      }
      tops.push(o);
    });

    const box = new THREE.Box3();
    const centre = new THREE.Vector3();
    const size = new THREE.Vector3();

    for (const node of tops) {
      // Refresh ancestors AND descendants each iteration: attaching the previous
      // pivot mutated the graph, and without the ancestor refresh the very first
      // prop resolves against a stale root matrix and lands off-centre.
      root.updateWorldMatrix(true, true);

      // Each propeller has a small hub mesh and a wide blade mesh; the hub's
      // centre is the true spin axis.
      let hub: THREE.Mesh | null = null;
      let hubSpan = Infinity;
      node.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        box.setFromObject(mesh);
        if (box.isEmpty()) return;
        box.getSize(size);
        const span = Math.max(size.x, size.z);
        if (span < hubSpan) {
          hubSpan = span;
          hub = mesh;
        }
      });

      box.setFromObject(hub ?? node);
      if (box.isEmpty()) continue;
      box.getCenter(centre);

      // setFromObject returns WORLD coordinates, but pivot.position is local to
      // the model root. Now that this runs after mount (rather than on a
      // detached clone) those frames differ by the drone's own transform — so
      // the centre has to be converted, or the pivot lands metres away and the
      // props orbit the airframe instead of spinning.
      root.worldToLocal(centre);

      const pivot = new THREE.Group();
      pivot.position.copy(centre);
      root.add(pivot);
      root.updateWorldMatrix(true, true);
      pivot.attach(node); // preserves the world transform

      // Clone the blade materials so fading one prop can't bleed into the
      // shared material used by the rest of the airframe (or the menu model).
      const blades: THREE.Material[] = [];
      node.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material | THREE.Material[];
        const clone = Array.isArray(mat) ? mat.map((m) => m.clone()) : mat.clone();
        mesh.material = clone;
        (Array.isArray(clone) ? clone : [clone]).forEach((m) => {
          m.transparent = true;
          blades.push(m);
        });
      });

      const bx = centre.x * cosY + centre.z * sinY;
      const bz = -centre.x * sinY + centre.z * cosY;
      const motor = bz < 0 ? (bx > 0 ? 0 : 1) : bx > 0 ? 2 : 3;
      found.push({ pivot, motor, blades });
    }

    rotors.current = found;

    // Publish hub positions in the drone's body frame (root.matrix carries the
    // model's scale/yaw/offset) so the blur discs land exactly on the blades.
    root.updateMatrix();
    const byMotor = [...found].sort((a, b) => a.motor - b.motor);
    propHubs.positions = byMotor.map((f) =>
      f.pivot.position.clone().applyMatrix4(root.matrix),
    );
    propHubs.ready = propHubs.positions.length === 4;

    // Keep a clonable copy of the real propeller for crash debris. Taken from
    // the pivot's child, so it arrives already centred on its hub. Materials
    // are re-cloned opaque — the in-flight ones get faded for the blur effect.
    const source = found[0]?.pivot.children[0];
    if (source) {
      const template = source.clone(true);
      template.position.set(0, 0, 0);
      template.rotation.set(0, 0, 0);
      template.visible = true;
      template.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material | THREE.Material[];
        const opaque = Array.isArray(mat) ? mat.map((m) => m.clone()) : mat.clone();
        (Array.isArray(opaque) ? opaque : [opaque]).forEach((m) => {
          m.transparent = false;
          m.opacity = 1;
          m.depthWrite = true;
        });
        mesh.material = opaque;
      });
      propHubs.template = template;
    }

    return () => {
      rotors.current = [];
      propHubs.ready = false;
    };
  }, [model, spec.armLength, spec.modelYawDeg]);

  // Spin from live motor output — idle on arm, faster with throttle, smoothed.
  useFrame((_s, dt) => {
    if (rotors.current.length === 0) return;
    const motors = useSimStore.getState().motors;
    const status = useFlightStore.getState().status();
    const live = status === 'armed' || status === 'flying';

    // A propeller that snapped off in a crash is hidden here; PropDebris draws
    // it as a loose physics object instead.
    const broken = useFlightStore.getState().brokenProps;

    rotors.current.forEach((r, i) => {
      const gone = broken.includes(r.motor);
      r.pivot.visible = !gone;
      if (gone) return;

      // idleSpin drives the menu hero shot, where there is no armed drone.
      const target = idleSpin > 0 ? idleSpin : live ? Math.max(motors[r.motor], 0.2) : 0;
      const lambda = target > (rpm.current[i] ?? 0) ? 6 : 2.2;
      rpm.current[i] = damp(rpm.current[i] ?? 0, target, lambda, dt);
      // Diagonal pairs counter-rotate, as on a real quad.
      const dir = r.motor === 0 || r.motor === 3 ? 1 : -1;
      // The pivot sits axis-aligned under the model root, so Y is up.
      // Full-speed rotation. Far past the point where 60 fps can resolve a
      // two-blade prop (~15 rev/s), so the blades WOULD strobe — which is why
      // they're faded out as RPM rises and the blur disc takes over, exactly as
      // a real prop stops resolving and becomes a translucent disc.
      r.pivot.rotation.y += dir * rpm.current[i] * 6400 * dt;

      const fade = 1 - Math.min(0.9, Math.max(0, rpm.current[i] - 0.08) * 2.6);
      r.blades.forEach((m) => {
        m.opacity = fade;
        m.depthWrite = fade > 0.6;
      });
    });
  });

  const scale = spec.modelScale ?? 1;
  const yaw = (spec.modelYawDeg ?? 0) * DEG2RAD;
  const offset = spec.modelOffset ?? [0, 0, 0];

  // key ties the mounted object to this exact clone: <primitive> cannot swap
  // its object in place, so without it a new clone would never reach the scene.
  return (
    <primitive
      key={model.uuid}
      object={model}
      scale={scale}
      rotation={[0, yaw, 0]}
      position={offset}
    />
  );
}

/** Renders `fallback` if the model subtree throws (missing/corrupt asset). */
class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[drone] GLB failed to load, using procedural mesh:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function DroneModel({
  spec,
  placeholder,
  idleSpin,
}: {
  spec: DroneSpec;
  /** Spin the props at this constant rate regardless of arm state (menu use). */
  idleSpin?: number;
  /**
   * What to show while the .glb streams in. Defaults to the procedural mesh.
   * Pass `null` where showing a *different-looking* airframe would be confusing
   * (e.g. the menu hero shot) — there it's better to show nothing briefly.
   */
  placeholder?: ReactNode;
}) {
  if (!spec.model) return <DroneMesh spec={spec} />;

  const loading = placeholder === undefined ? <DroneMesh spec={spec} /> : placeholder;

  return (
    // On a hard failure always fall back to the procedural mesh, so the sim is
    // never unflyable because of a missing asset.
    <ModelBoundary fallback={<DroneMesh spec={spec} />}>
      <Suspense fallback={loading}>
        <Gltf spec={spec} idleSpin={idleSpin} />
      </Suspense>
    </ModelBoundary>
  );
}

/** Warm the model cache at startup so the hero shot never pops. */
export function preloadDroneModel(spec: DroneSpec): void {
  if (spec.model) useGLTF.preload(spec.model);
}
