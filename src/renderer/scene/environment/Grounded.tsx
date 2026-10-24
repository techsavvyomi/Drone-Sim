import { useState, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';

/**
 * Stands a race-course piece on whatever is under it. Waits for the map's
 * colliders (they load with the model), then casts once straight down from
 * `from` metres up, looking `length` metres. Nothing of the piece itself exists
 * yet, so the first hit is the surface — a road, the grass or a roof.
 */
export function Grounded({
  x,
  z,
  from,
  length,
  children,
}: {
  x: number;
  z: number;
  from: number;
  length: number;
  children: (y: number) => ReactElement;
}) {
  const { world, rapier } = useRapier();
  const [y, setY] = useState<number | null>(null);

  useFrame(() => {
    if (y !== null) return;
    const ray = new rapier.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(
      ray,
      length,
      true,
      rapier.QueryFilterFlags.EXCLUDE_DYNAMIC | rapier.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    if (hit) setY(from - hit.timeOfImpact);
  });

  return y === null ? null : children(y);
}
