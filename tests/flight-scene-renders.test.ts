import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// New York stalled for 150-400 ms at a time (user, 2026-09-30: "kabhi atak jata
// hai mini second ke liye"). A CPU profile over CDP put every stall in React:
// all ~3,400 of the city's colliders re-rendering. Two causes, held here at the
// source because the renders happen inside the WebGL canvas, which jsdom cannot
// run:
// - <Physics gravity={[0, -GRAVITY, 0]}> made a new array on every FlightScene
//   render; @react-three/rapier rebuilds its context when `gravity` changes
//   identity, and every collider reads that context.
// - NewYorkEnv rendered the generated NewYorkColliders as a plain child, so each
//   parent render rebuilt it too.
// After both: long tasks over 60 ms in flight went from ~20 (150-400 ms) to 3
// (67-134 ms, each at a crash reset) on the same route.

const scene = readFileSync('src/renderer/scene/FlightScene.tsx', 'utf8');
const nyc = readFileSync('src/renderer/scene/environment/NewYorkEnv.tsx', 'utf8');
/** The <Physics …> tag's props: from the JSX tag (not a comment naming it) to its `>`. */
const physicsTag = (() => {
  const at = scene.search(/^\s*<Physics$/m);
  return scene.slice(at, scene.indexOf('>', scene.indexOf('numSolverIterations', at)));
})();

describe('what <Physics> is given keeps its identity across renders', () => {
  it('gravity is one module-level array, not built inline', () => {
    const physics = physicsTag;
    expect(physics).toMatch(/gravity=\{GRAVITY_VECTOR\}/);
    expect(physics).not.toMatch(/gravity=\{\[/);
    expect(scene).toMatch(/^const GRAVITY_VECTOR: \[number, number, number\] = \[0, -GRAVITY, 0\];$/m);
  });

  it('no other <Physics> prop is an inline array or object', () => {
    const physics = physicsTag;
    expect(physics).not.toMatch(/=\{\s*[[{]/);
  });
});

describe('New York colliders render once', () => {
  it('NewYorkEnv renders a memoised NewYorkColliders, never the plain one', () => {
    expect(nyc).toMatch(/const CityColliders = memo\(NewYorkColliders\);/);
    expect(nyc).toContain('<CityColliders />');
    expect(nyc).not.toContain('<NewYorkColliders />');
  });

  it('the generated component still takes no props, so memo can always bail out', () => {
    const gen = readFileSync('src/renderer/scene/environment/NewYorkColliders.tsx', 'utf8');
    expect(gen).toMatch(/export function NewYorkColliders\(\) \{/);
  });
});
