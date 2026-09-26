import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { useDisposable } from '../scene/useDisposable';
import { PALLET_H, STOCK_PILE } from './supermarketSites';
import { truckCargo } from './supermarketYard';
import type { Mission } from './types';

// ----------------------------------------------------------------------------
// The loading yard's furniture, for Missions 9 and 10.
//
//   - The STORE'S STOCK: two pallets of cartons stacked two high on the store
//     floor by the self-checkouts, and a yellow floor line round the stock
//     area. In front of it, the stock pallet the mission boxes stand on. It was
//     a six-pallet pile with a sign on the yard's tarmac; the user asked for
//     this end of the job inside the store, where the floor is a few metres of
//     tile between the checkouts and a display, and a pile that size would
//     stand in the checkouts.
//   - A pallet INSIDE the truck, on the trailer floor, and a strip of hazard
//     tape along the floor's open edge: the trailer has no wall on that side,
//     and the tape is what says "the way in is here" from across the car park.
//   - The rest of the truck's LOAD, on both missions: the trailer full of
//     stacked cartons either side of the pallet (`truckCargo`), solid.
//
// Primitives, two instanced meshes and small canvas textures; no lights. The
// mission's own boxes are not here: `Payload` draws them, standing on these
// pallets. `supermarketYard.ts` is the same yard as mission data.
//
// The stock and the pallets are solid, in one fixed body: a drone that flew
// through the stack it is collecting from would say it is scenery.
// ----------------------------------------------------------------------------

/** A pallet, metres: x, height, z. */
const PALLET = { w: 1.2, h: PALLET_H, d: 1.0 };
/** A carton of stock: x, height, z. Three by three fill a pallet. */
const CARTON = { w: 0.38, h: 0.3, d: 0.31 };
/** How many cartons high each stock pallet stands: two side by side along x. */
const LAYERS = [[2], [2]];
/** The gap between stock pallets, metres. */
const GAP = 0.15;

export function LoadingYard({ mission }: { mission: Mission }) {
  const yard = mission.yard;

  const res = useMemo(() => {
    const cartonTex = cartonTexture();
    const tapeTex = tapeTexture();
    return {
      cartonTex,
      tapeTex,
      carton: new THREE.MeshStandardMaterial({ map: cartonTex, roughness: 0.9, metalness: 0 }),
      pallet: new THREE.MeshStandardMaterial({ color: '#9a7a52', roughness: 0.92 }),
      line: new THREE.MeshBasicMaterial({
        color: '#f2c230',
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      tape: new THREE.MeshBasicMaterial({
        map: tapeTex,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      cartonGeo: new THREE.BoxGeometry(CARTON.w, CARTON.h, CARTON.d),
      palletGeo: new THREE.BoxGeometry(PALLET.w, PALLET.h, PALLET.d),
    };
  }, []);
  useDisposable(res);

  /** The truck's own load: whole cartons in each block. */
  const cargo = useMemo(() => (yard ? truckCargo(yard) : []), [yard]);

  /** Every carton in the stock and in the truck, as a place in the world. */
  const cartons = useMemo(() => {
    const out: [number, number, number][] = [];
    for (const b of cargo) {
      const nx = Math.floor((b.max[0] - b.min[0]) / (CARTON.w + 0.005));
      const nz = Math.floor((b.max[2] - b.min[2]) / (CARTON.d + 0.005));
      const ny = Math.floor((b.max[1] - b.min[1]) / CARTON.h);
      const x0 = (b.min[0] + b.max[0]) / 2 - ((nx - 1) * (CARTON.w + 0.005)) / 2;
      const z0 = (b.min[2] + b.max[2]) / 2 - ((nz - 1) * (CARTON.d + 0.005)) / 2;
      for (let l = 0; l < ny; l++)
        for (let i = 0; i < nx; i++)
          for (let k = 0; k < nz; k++)
            out.push([
              x0 + i * (CARTON.w + 0.005),
              b.min[1] + CARTON.h / 2 + l * CARTON.h,
              z0 + k * (CARTON.d + 0.005),
            ]);
    }
    LAYERS.forEach((row, ix) =>
      row.forEach((layers, iz) => {
        const cx = STOCK_PILE.min[0] + PALLET.w / 2 + ix * (PALLET.w + GAP);
        const cz = STOCK_PILE.min[2] + PALLET.d / 2 + iz * (PALLET.d + GAP);
        for (let l = 0; l < layers; l++)
          for (let a = -1; a <= 1; a++)
            for (let b = -1; b <= 1; b++)
              out.push([
                cx + a * (CARTON.w + 0.005),
                PALLET.h + CARTON.h / 2 + l * CARTON.h,
                cz + b * (CARTON.d + 0.005),
              ]);
      }),
    );
    return out;
  }, [cargo]);

  /** Every pallet, with the floor it stands on: the two under the stock, the
   *  store's, and the truck's on the trailer floor. */
  const pallets = useMemo(() => {
    const out: [number, number, number][] = [];
    LAYERS.forEach((row, ix) =>
      row.forEach((_, iz) =>
        out.push([
          STOCK_PILE.min[0] + PALLET.w / 2 + ix * (PALLET.w + GAP),
          0,
          STOCK_PILE.min[2] + PALLET.d / 2 + iz * (PALLET.d + GAP),
        ]),
      ),
    );
    if (yard) {
      out.push([yard.warehouse.at[0], 0, yard.warehouse.at[1]]);
      out.push([yard.truck.bay.at[0], yard.truck.hold.min[1], yard.truck.bay.at[1]]);
    }
    return out;
  }, [yard]);

  const cartonMesh = useRef<THREE.InstancedMesh>(null);
  const palletMesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const cm = cartonMesh.current;
    if (cm) {
      cartons.forEach((p, i) => {
        m.makeTranslation(p[0], p[1], p[2]);
        cm.setMatrixAt(i, m);
        // A little variation, so a wall of cartons reads as stock rather than
        // as one textured block: some newer, some sun-faded.
        const k = 0.86 + 0.14 * fract(Math.sin(i * 12.9898) * 43758.5453);
        cm.setColorAt(i, c.setRGB(k, k * 0.97, k * 0.94));
      });
      cm.instanceMatrix.needsUpdate = true;
      if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
    }
    const pm = palletMesh.current;
    if (pm) {
      pallets.forEach((p, i) => {
        m.makeTranslation(p[0], p[1] + PALLET.h / 2, p[2]);
        pm.setMatrixAt(i, m);
      });
      pm.instanceMatrix.needsUpdate = true;
    }
  }, [cartons, pallets]);

  if (!yard) return null;

  const pile = STOCK_PILE;
  const pileHalf: [number, number, number] = [
    (pile.max[0] - pile.min[0]) / 2,
    (pile.max[1] - pile.min[1]) / 2,
    (pile.max[2] - pile.min[2]) / 2,
  ];
  const pileMid: [number, number, number] = [
    (pile.max[0] + pile.min[0]) / 2,
    (pile.max[1] + pile.min[1]) / 2,
    (pile.max[2] + pile.min[2]) / 2,
  ];

  /** The stock area's floor line: round the stock and the pallet in front of it. */
  const wh = yard.warehouse;
  const area = {
    x0: Math.min(pile.min[0], wh.at[0] - wh.radius) - 0.4,
    x1: Math.max(pile.max[0], wh.at[0] + wh.radius) + 0.4,
    z0: pile.min[2] - 0.4,
    z1: wh.at[1] + wh.radius + 0.4,
  };
  const LINE = 0.12;

  /** The trailer's open edge: along the floor at the open side, the length of
   *  the hold. */
  const hold = yard.truck.hold;
  const TAPE = 0.18;

  return (
    <group>
      <RigidBody type="fixed" colliders={false} name="mission-yard">
        <CuboidCollider args={pileHalf} position={pileMid} />
        {cargo.map((b, i) => (
          <CuboidCollider
            key={`cargo-${i}`}
            args={[
              (b.max[0] - b.min[0]) / 2,
              (b.max[1] - b.min[1]) / 2,
              (b.max[2] - b.min[2]) / 2,
            ]}
            position={[
              (b.min[0] + b.max[0]) / 2,
              (b.min[1] + b.max[1]) / 2,
              (b.min[2] + b.max[2]) / 2,
            ]}
          />
        ))}
        {pallets.slice(LAYERS.flat().length).map((p, i) => (
          <CuboidCollider
            key={i}
            args={[PALLET.w / 2, PALLET.h / 2, PALLET.d / 2]}
            position={[p[0], p[1] + PALLET.h / 2, p[2]]}
          />
        ))}
      </RigidBody>

      <instancedMesh
        ref={cartonMesh}
        args={[res.cartonGeo, res.carton, cartons.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={palletMesh}
        args={[res.palletGeo, res.pallet, pallets.length]}
        castShadow
        receiveShadow
      />

      {/* The floor line round the stock area. */}
      {[
        [(area.x0 + area.x1) / 2, area.z0, area.x1 - area.x0, LINE],
        [(area.x0 + area.x1) / 2, area.z1, area.x1 - area.x0, LINE],
        [area.x0, (area.z0 + area.z1) / 2, LINE, area.z1 - area.z0],
        [area.x1, (area.z0 + area.z1) / 2, LINE, area.z1 - area.z0],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} material={res.line} position={[x, 0.012, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[w, d]} />
        </mesh>
      ))}

      {/* Hazard tape along the trailer floor's open edge. */}
      <mesh
        material={res.tape}
        position={[(hold.min[0] + hold.max[0]) / 2, hold.min[1] + 0.012, hold.max[2] - TAPE / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[hold.max[0] - hold.min[0], TAPE]} />
      </mesh>
    </group>
  );
}

/** Hazard tape: yellow and black diagonals, repeated along the edge. */
function tapeTexture(): THREE.CanvasTexture {
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#1f2326';
    for (let x = -S; x < S * 2; x += S / 2) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + S / 4, 0);
      ctx.lineTo(x + S / 4 + S, S);
      ctx.lineTo(x + S, S);
      ctx.closePath();
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(24, 1);
  return tex;
}

/** A carton face: kraft board, a band of tape down the middle, a white label. */
function cartonTexture(): THREE.CanvasTexture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#b8864f';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#d8c39a';
    ctx.fillRect(S * 0.4, 0, S * 0.2, S);
    ctx.fillStyle = '#f1eee6';
    ctx.fillRect(S * 0.08, S * 0.58, S * 0.26, S * 0.22);
    ctx.fillStyle = '#2f9e44';
    ctx.fillRect(S * 0.08, S * 0.58, S * 0.26, S * 0.05);
    ctx.strokeStyle = 'rgba(60, 40, 20, 0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, S - 3, S - 3);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function fract(x: number): number {
  return x - Math.floor(x);
}
