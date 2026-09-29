import type { DroneSpec, EnvironmentSpec } from '@shared/types';

// What the shell says about the next flight: the drone, the arena, the ceiling.
// Every figure here is read from the plugin data — nothing is a placeholder.

/** "3 m", "20 m", "2.5 m": whole metres from 10 up, one decimal below, no ".0". */
export function formatMetres(m: number): string {
  const v = m >= 10 ? Math.round(m) : Math.round(m * 10) / 10;
  return `${v} m`;
}

/** "50 g", "720 g", "1.5 kg". */
export function formatMass(kg: number): string {
  return kg >= 1 ? `${Math.round(kg * 10) / 10} kg` : `${Math.round(kg * 1000)} g`;
}

export interface Ceiling {
  metres: number;
  /** The arena, when its roof is lower than the drone's own limit. */
  cappedBy: string | null;
}

/**
 * The height the next flight can reach: the lower of the drone's flight-
 * controller limit (`maxAltitude`) and the arena's roof (`bounds.max.y` above
 * its ground). The arena caps it — in the Classroom a 20 m drone still stops
 * at the 3 m ceiling.
 */
export function ceilingFor(
  drone: DroneSpec | undefined,
  env: EnvironmentSpec | undefined,
): Ceiling {
  const droneMax = drone?.maxAltitude ?? Infinity;
  const roof = env ? env.bounds.max[1] - (env.groundY ?? 0) : Infinity;
  if (roof < droneMax) return { metres: roof, cappedBy: env?.name ?? null };
  return { metres: Number.isFinite(droneMax) ? droneMax : 0, cappedBy: null };
}

export interface DroneFact {
  label: string;
  value: string;
}

/** The Hangar's spec card. Only fields the flight model actually uses. */
export function droneFacts(d: DroneSpec): DroneFact[] {
  const props = Math.round(d.propDiameterIn * 25.4);
  return [
    { label: 'Mass', value: formatMass(d.mass) },
    { label: 'Frame', value: `${d.frame === 'hex' ? 'Hex' : 'Quad'} · ${d.motors.length} motors` },
    { label: 'Props', value: `${props} mm${d.propBlades ? `, ${d.propBlades}-blade` : ''}` },
    { label: 'Battery', value: `${d.battery.cells}S · ${d.battery.capacityMah} mAh` },
    { label: 'Top speed', value: `${d.maxSpeed} m/s` },
    { label: 'Ceiling', value: formatMetres(d.maxAltitude) },
    { label: 'Wheelbase', value: `${Math.round(d.armLength * 2000)} mm` },
  ];
}

/** The airframe in a few words: "Quad · 55 mm props". */
export function droneBuild(d: DroneSpec): string {
  return `${d.frame === 'hex' ? 'Hex' : 'Quad'} · ${Math.round(d.propDiameterIn * 25.4)} mm props`;
}

/** One line under a drone's name in a list: "50 g · Quad · 55 mm props". */
export function droneLine(d: DroneSpec): string {
  return `${formatMass(d.mass)} · ${droneBuild(d)}`;
}

/** One line under an arena's name: "Indoor · 3 m roof" / "Outdoor". */
export function arenaLine(e: EnvironmentSpec): string {
  if (e.kind !== 'indoor') return 'Outdoor';
  return `Indoor · ${formatMetres(e.bounds.max[1] - (e.groundY ?? 0))} roof`;
}
