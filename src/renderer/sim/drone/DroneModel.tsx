import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { DroneSpec } from '@shared/types';
import { DEG2RAD } from '../mathx';
import { DroneMesh } from './DroneMesh';
import { BLUR_REV_PER_SEC, blurMix, propHubs, TAU } from './propHubs';
import { useSimStore } from '../../state/simStore';
import { useFlightStore } from '../../state/flightStore';
import { damp } from '../mathx';
import { PROP_SPIN_Y } from '../control/mixer';

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
  /** Model ships pre-blurred prop discs rather than modelled blades. */
  const blurProps = spec.propArt === 'blur';
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
    const _body = new THREE.Vector3();

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

      // Which corner this prop sits on, decided in the BODY frame.
      //
      // root.matrix carries scale, yaw AND modelOffset, so it is the only
      // transform that lands the hub where the airframe actually has it.
      // Rotating the raw model-space position by yaw alone silently assumes the
      // .glb is origin-centred: the PlutoX is, the Guru is not (its prop
      // centroid sits ~121 mm off in X), so all four of its hubs came out on
      // the same side and collapsed onto two motors — front pair both CW, rear
      // pair both CCW, instead of counter-rotating diagonals.
      root.updateMatrix();
      _body.copy(centre).applyMatrix4(root.matrix);
      const motor = _body.z < 0 ? (_body.x > 0 ? 0 : 1) : _body.x > 0 ? 2 : 3;

      // Motors 0/1 are the front pair, 2/3 the rear. Tint applies to the whole
      // prop (hub included) and multiplies any baked texture, so the moulding
      // detail survives rather than flattening to a solid colour.
      const tint = motor < 2 ? spec.propColors?.front : spec.propColors?.rear;
      if (tint) {
        blades.forEach((m) => {
          const col = (m as THREE.MeshStandardMaterial).color;
          if (col) col.set(tint);
        });
      }

      found.push({ pivot, motor, blades });
    }

    rotors.current = found;

    root.updateMatrix();
    root.updateWorldMatrix(true, true);

    if (found.length === 4) {
      propHubs.synthetic = false;
      propHubs.propRadius = 0;
      const byMotor = [...found].sort((a, b) => a.motor - b.motor);
      propHubs.positions = byMotor.map((f) =>
        f.pivot.position.clone().applyMatrix4(root.matrix),
      );
      propHubs.ready = true;

      // Keep a clonable copy of the real propeller for crash debris. Taken from
      // the pivot's child, so it arrives already centred on its hub. Materials
      // are re-cloned opaque — the in-flight ones get faded for the blur effect.
      //
      // Skipped for blur art: there is no blade to break off, only a picture of
      // one, and a flat disc of motion blur tumbling across the ground reads as
      // a rendering fault rather than a snapped propeller. PropDebris draws
      // nothing when the template is absent.
      const source = blurProps ? null : found[0]?.pivot.children[0];
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
    } else {
      // Single-mesh airframe: estimate motor hubs from the model AABB so
      // Propellers can spin black stand-in blades over the bake.
      propHubs.synthetic = true;
      propHubs.template = null;
      box.setFromObject(root);
      const ordered: THREE.Vector3[] = [];
      if (!box.isEmpty()) {
        const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
        const lb = box.clone().applyMatrix4(inv);
        const cx = (lb.min.x + lb.max.x) * 0.5;
        const cz = (lb.min.z + lb.max.z) * 0.5;
        const halfX = (lb.max.x - lb.min.x) * 0.5;
        const halfZ = (lb.max.z - lb.min.z) * 0.5;
        // Motors sit inboard of the prop tips (bbox edge).
        const hx = halfX * 0.62;
        const hz = halfZ * 0.62;
        propHubs.propRadius = Math.min(halfX, halfZ) * 0.36;
        // Above the baked prop plane so overlays cover the static texture.
        const y = lb.max.y + 0.012;
        for (const [lx, lz] of [
          [cx + hx, cz - hz],
          [cx - hx, cz - hz],
          [cx + hx, cz + hz],
          [cx - hx, cz + hz],
        ] as const) {
          const body = new THREE.Vector3(lx, y, lz).applyMatrix4(root.matrix);
          const motor = body.z < 0 ? (body.x > 0 ? 0 : 1) : body.x > 0 ? 2 : 3;
          ordered[motor] = body;
        }
      }
      propHubs.positions = ordered;
      propHubs.ready = ordered.filter(Boolean).length === 4;
    }

    return () => {
      rotors.current = [];
      propHubs.ready = false;
      propHubs.synthetic = false;
      propHubs.propRadius = 0;
      // Otherwise the next airframe inherits this one's rotor speeds, and a
      // 'blur' drone mounted after a spun-up one starts with its stand-in
      // blades already faded out.
      propHubs.spin.fill(0);
    };
  }, [model, spec.armLength, spec.modelYawDeg, spec.propColors, blurProps]);

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

      // Diagonal pairs counter-rotate, as on a real quad. Direction comes from
      // the mixer so the blades match the reaction torque they represent.
      const dir = PROP_SPIN_Y[r.motor];

      // Menu hero shot: a visible, believable idle spin with the blades kept
      // SOLID. The flight regime below spins far too fast for 60 fps to resolve
      // (so it fades the blades and lets the blur disc take over) — but the menu
      // scene has no blur disc, so there the blades themselves must stay visible
      // and turn at a rate the eye can actually follow (~7 rev/s).
      if (idleSpin > 0) {
        r.pivot.rotation.y += dir * idleSpin * 55 * dt;
        r.blades.forEach((m) => {
          m.opacity = 1;
          m.depthWrite = true;
        });
        // A 'blur' airframe shown as a hero is turning, so report it as fully
        // spun up. Leaving this unwritten would draw the disc AND the stand-in
        // blades Propellers keeps for the stopped case, on top of each other.
        if (blurProps) propHubs.spin[r.motor] = 1;
        return;
      }

      // Follow the real motor output. The old 0.2 floor spun the blades the
      // instant the aircraft was armed, whatever the motors were actually doing.
      const target = live ? motors[r.motor] : 0;
      const lambda = target > (rpm.current[i] ?? 0) ? 6 : 2.2;
      rpm.current[i] = damp(rpm.current[i] ?? 0, target, lambda, dt);

      // Motion-blur discs: the art already IS the blur, so the fade below has
      // to run the other way. Faded forwards it would leave a drone at full
      // throttle with no visible propellers at all.
      //
      // At rest it goes to ZERO, not to a ghost. A blur disc on a parked drone
      // reads as propellers that are always spinning, which is exactly what it
      // looks like — so the disc is hidden and Propellers draws solid stand-in
      // blades in its place until the motors actually turn.
      if (blurProps) {
        propHubs.spin[r.motor] = rpm.current[i];
        r.pivot.rotation.y += dir * rpm.current[i] * BLUR_REV_PER_SEC * TAU * dt;
        const smear = blurMix(rpm.current[i]);
        r.blades.forEach((m) => {
          m.opacity = smear;
          m.visible = smear > 0.01;
          // Never: these are alpha-blended sprites, and writing depth from one
          // punches a hole in whatever the next disc draws behind it.
          m.depthWrite = false;
        });
        return;
      }

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
