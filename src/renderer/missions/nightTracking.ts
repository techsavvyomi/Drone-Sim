import type { Mission } from './types';
import { TIGER_ROUTES } from './tigerRoutes';
import { forest } from '../plugins/environments/forest';

// ----------------------------------------------------------------------------
// Mission 5 — Nightfall Predator Tracking (the forest, after dark).
//
// The fifth mission, and the first whose target is ALIVE. Mission 4 took the
// route away and left the pilot a red circle and a person lying on a roof;
// this one takes the daylight away as well, and the thing being looked for
// walks off while you are looking for it.
//
// Three rules carry the whole design, and each is a deliberate step past
// Mission 4:
//
//   1. NO MARK AT ALL, not even a red zone. A circle over a city names a block;
//      a circle over a forest names trees. What replaces it is four written
//      CLUES on the briefing card — near water, moving deeper in, seen at dusk,
//      and it has moved since. They narrow the map honestly without drawing on
//      it. (Mission 4 went the other way, from clues to a circle, and that was
//      right for a city. See docs/mission-search-rescue.md §4.)
//   2. THE LIGHT IS THE INSTRUMENT. At `night` there is no readout that finds
//      anything: the spotlight's pool is the only place the pilot can see the
//      ground, and its width is set by how high they fly. Climb and the pool
//      widens and dims; descend and it is bright, tight, and sweeping past too
//      fast to hold anything. That trade is the mission.
//   3. THE TARGET MOVES, so the hold cannot be a hover over a mark. It is five
//      seconds of LIGHT on an animal that is walking, and the bar drains rather
//      than resetting when it slips out — see the Director.
//
// And one rule that ends the attempt: get inside nine metres of the tiger and
// it is disturbed. A wildlife survey that drives the animal off has not been
// flown badly, it has failed.
//
// Positions come from `tigerRoutes.ts`, measured against the terrain and the
// generated trunk colliders — never chosen by eye. Re-measure with:
//
//     node scripts/check-tiger-routes.mjs
// ----------------------------------------------------------------------------

/** The clearing's own ground height, measured: the forest map declares no
 *  `groundY` of its own because it has none — see `forest.ts`. The pad the
 *  drone launches from and lands back on sits on it. */
const CLEARING_Y = -0.01;

/** Where the ranger station's pad is: the map's spawn.
 *
 *  Nothing lands on it — the survey ends over the animal, see `endsAtDrop` —
 *  but the base zone is still where the drone spawns and what `strayRadius` is
 *  measured from, so it has to be a real place. Read from the environment
 *  rather than copied, so moving the spawn moves the mission's centre with it;
 *  `helipad.ts` does the same for New York. */
const STATION: readonly [number, number] = [forest.spawn.position[0], forest.spawn.position[2]];

/** ONE POINT: the sighting.
 *
 *  Not two. The mission ends where the observation does — see `endsAtDrop` —
 *  so there is no landing to score, and `maxPointsOf` drops it with the leg.
 *  A rubric that asked for two on a mission that can only ever pay one is a
 *  gold medal nobody can win. */
const GOLD = 1;

export const nightTracking: Mission = {
  id: 'night-tracking',
  order: 5,
  name: 'Wildlife Tracker',
  subtitle: 'A tiger in the dark, and nothing on the map',
  kind: 'tracking',
  envId: 'forest',
  blurb:
    'A tiger has gone unrecorded on the evening survey. Find it in the forest with your spotlight and hold the light on it long enough to log the sighting, without ever disturbing it. The survey is over the moment the sighting is confirmed.',
  story:
    'The evening survey missed one of our tigers and the ground team cannot walk the gorge after dark. There is no collar on this animal and no fix to give you — only where it was last seen and which way it was heading. Take the drone out, find it with your light, and watch it long enough to confirm it is well. The moment we have the sighting, the job is done — you leave the animal alone and we log it.',
  /*
   * DUSK, against the missions' shared blue half hour — and it is its own
   * preset rather than either neighbour, because both neighbours failed.
   *
   * `night` was the first build, and it was too dark: a black screen with a
   * torch in it, where the trunks, the forest floor and the animal are all
   * invisible outside the pool. A search you cannot see to fly is not a search.
   * `evening` is the opposite failure — enough skylight in the clearing to fly
   * the whole mission with the light switched off, which makes this mission's
   * one instrument decoration.
   *
   * `dusk` sits between them, and the full reasoning for its numbers lives with
   * the preset in `worldStore.ts`. It keeps the star field, so the sky still
   * reads as nightfall, without night's 0.25 hemisphere.
   */
  hour: 'dusk',
  /*
   * THE CLUES, in place of a mark.
   *
   * Four lines, and every one of them is load-bearing rather than atmosphere:
   * the water and the "deeper in" narrow the map to the gorge and the shoulder
   * of the ridge road, the dusk sighting says the animal has been walking for
   * hours, and the last line is the honest warning that where it was seen is
   * not where it is. A clue that describes the whole forest equally well is not
   * a clue, and none of these do.
   */
  clues: [
    'The tiger was last seen near water, at the bottom of the gorge.',
    'It was moving deeper into the forest, away from the clearing.',
    'The sighting was at dusk. It has been walking since.',
    'It will not be where it was last seen. Search along its line, not at a point.',
  ],
  /*
   * THE RULES OF ENGAGEMENT, as their own card.
   *
   * Separate from the objectives because they answer a different question. The
   * objectives are what to do, read in order; these are what ENDS the attempt,
   * and a pilot looking for "how close is too close" should not have to read a
   * numbered list of tasks to find it.
   */
  rules: [
    'No marker, no waypoint and no route will be drawn to the tiger.',
    'The beam only counts from more than 9 m away. Search from 10 to 30 m above the ground.',
    'Once you have sighted the tiger, staying inside 9 m disturbs it and the survey fails.',
    'The spotlight only reaches the ground from under 30 m. Above that it finds nothing.',
    'If the tiger leaves the light the lock drains. Find it again and it fills from where it stopped.',
    'The survey ends at the sighting. There is no flight home to fly and no landing to score.',
  ],
  /* Four beats, and the last one is the SIGHTING rather than a landing.
   *
   * The card draws four whatever the mission flies — Forest Fire has drawn a
   * fourth picture for a leg it does not have since it was written, because the
   * beats are what the briefing SHOWS, not the legs the runtime walks. Here the
   * fourth is the confirmation itself: the pilot deserves a picture of the thing
   * that ends the mission, and it is not a pad. */
  flow: [
    { label: 'Sweep', note: 'Search the dark with your light', art: 'sweep' },
    { label: 'Sight', note: 'Eyeshine in the beam', art: 'track' },
    { label: 'Observe', note: 'Five seconds of light, from a distance', art: 'track' },
    { label: 'Logged', note: 'The sighting confirmed — survey over', art: 'track' },
  ],
  objectives: [
    'Fly out from the ranger station and search the forest with your spotlight.',
    'Find the tiger by eye. Nothing on the HUD will point at it.',
    'Hold the light on it for five seconds while staying more than 9 m away.',
    'The survey is complete the moment the sighting is confirmed.',
  ],
  mapNote: 'The forest at night. No marker, no route',
  /*
   * EIGHT MINUTES against a four minute par, the same pair Mission 4 carries
   * and for the same reason: a search cannot be timed like a flight. The same
   * pilot flying to the same standard finds the animal in ninety seconds or in
   * four minutes depending on which way they turned off the pad, so the limit
   * has to be generous enough that a wrong guess is not a failure, and the par
   * is what the rating is actually measured against.
   *
   * What is different here is that the target is walking, which cuts both ways:
   * a pilot searching the wrong half of the map will not be saved by the animal
   * wandering into them — the two routes never meet — but one who is searching
   * the right half and has not found it yet will have it walk back towards them
   * inside a couple of minutes. The patrols are 36 and 44 m long at 0.9 m/s,
   * so a there-and-back is eighty to a hundred seconds.
   */
  timeLimitSec: 480,
  parTimeSec: 240,
  groundY: CLEARING_Y,
  /*
   * NO CEILING OVERRIDE, deliberately, where Mission 4 raised its to eighty.
   *
   * That mission had to: its casualties are on roofs that start at 45 m and the
   * airframe stops at 30. Nothing here is above the pilot — the gorge floor is
   * thirty metres BELOW the pad — so the Guru's own limit is the right limit,
   * and raising it would only buy the one thing the mission is built to
   * prevent, which is searching the whole forest from above it.
   */
  routeAltitude: 18,
  medals: { bronze: 1, silver: GOLD, gold: GOLD },
  /*
   * NO CHECKPOINTS, and like Mission 4 this is a decision rather than an
   * omission: a ring is an answer. One ring over the gorge would tell the pilot
   * which half of the map to fly to before they had read a single clue.
   */
  route: [],
  homeVia: [],
  hideGuidanceUntilFound: true,
  /*
   * THE SURVEY ENDS AT THE SIGHTING. No flight home, no landing.
   *
   * The same call Forest Fire makes, and for a stronger reason. There, the fire
   * going out is the outcome and flying ninety-five metres back through the
   * trunks proves something the crossing already proved. Here it is not merely
   * redundant — it is the wrong ending. The whole mission is a single held
   * moment over an animal that must not be disturbed, and following it with a
   * two minute commute to a helipad makes the last thing the pilot does a
   * parking exercise.
   *
   * It also removes the one way this mission could waste a good flight: a pilot
   * who found the tiger in the dark, held the light on a walking target for five
   * seconds and then clipped a trunk on the way home lost all of it. The skill
   * being taught finished before that.
   *
   * What it changes: the `delivered` → `returning` → `landing` tail is skipped,
   * `maxPointsOf` drops the landing point (so the mission is worth ONE), and the
   * result carries `landed: false` honestly rather than claiming a touchdown
   * that never happened. The base zone stays in the spec — it is still where the
   * drone spawns and what `strayRadius` is measured from.
   */
  endsAtDrop: true,
  /*
   * A STRAY RADIUS, where the rescue refused one.
   *
   * Mission 4 argued that a recall banner narrows a search the app has already
   * narrowed once, and that is right — over a city, where the pilot can see
   * where they are. This is a forest at night with a 320 m fog and no skyline:
   * a pilot who has lost their bearings can fly to the map boundary with
   * nothing on screen ever saying they have left the survey area, and the
   * boundary itself is an invisible wall. 120 m covers both patrols with
   * twenty-five metres to spare at the far end of the ridge road, and it is a
   * warning with a grace period, never a wall.
   */
  strayRadius: 120,
  /* A forest is a wall of trunks with a canopy over it, so a depth-tested mark
   * is behind a tree from most headings — the landing ring vanishes and comes
   * back as the pilot yaws, which reads as a bug. Nothing here is a building,
   * so nothing is misread as a route. Mission 2 sets it for the same reason. */
  seeThroughMarks: true,
  /*
   * THE FULL THROTTLE AXIS, at 1 against the mission default of 0.55.
   *
   * This mission descends more than any other: thirty metres down into the
   * gorge, held, and thirty back out. The command scale slows the RATE the axis
   * travels rather than capping the descent, so at 0.55 a pilot dropping into
   * the ravine spends the descent asking rather than flying. The other three
   * axes stay soft — the light has to be PLACED — and only the throttle opts
   * out.
   */
  throttleScale: 1,

  tracking: {
    routes: TIGER_ROUTES,
    /*
     * NINE TENTHS OF A METRE PER SECOND — a walk, not a prowl.
     *
     * Slow enough that a pilot who has found the animal can stay with it by
     * flying gently, which is the point: the lock is meant to test placement,
     * not a chase. Fast enough that it covers its own patrol in about eighty
     * seconds, so a pilot searching the right area who has not seen it yet will
     * have it come back to them rather than having to sweep the whole line.
     */
    speed: 0.9,
    /*
     * FORTY-FIVE METRES OF REACH, in 3-D.
     *
     * A hard limit on top of the cone, and the cheaper of the two tests: at the
     * airframe's 30 m ceiling the cone alone is fourteen metres wide on the
     * ground, and without a reach the light would "find" an animal it could not
     * possibly illuminate out at the edge of a shallow pass. Forty-five is a
     * comfortable margin over the thirty the aircraft can actually be at.
     */
    lightRange: 45,
    /*
     * TWENTY-SIX DEGREES OF HALF-ANGLE, which is the number the whole mission
     * balances on.
     *
     * The pool on the ground is `agl · tan(26°)` — about half the height. At
     * ten metres up it is 4.9 m across the radius: tight, bright, and the tiger
     * walks out of it if the pilot drifts. At the 30 m ceiling it is 14.6 m,
     * which is a wide easy pool — and at that height, at night, over a canopy,
     * the pilot cannot see what is in it. That is the trade, and it is the same
     * number `DroneSpotlight` draws with, so what looks lit IS lit.
     *
     * Chosen rather than measured, and it is the first thing to change after a
     * fly test: too narrow and the mission is a pixel hunt, too wide and a
     * pilot at the ceiling finishes the lock without ever coming down.
     */
    coneDeg: 26,
    /** Five seconds, as the brief asks. Long enough to be a hold rather than a
     *  touch, short enough that losing it is a retry rather than a punishment
     *  — and it drains rather than resetting, which is what makes that true. */
    lockSeconds: 5,
    /*
     * NINE METRES, in 3-D, and it is a real constraint rather than a formality.
     *
     * The animal is 1.9 m long and the Guru spans 1.44 m; nine metres is about
     * five body lengths, which is the distance a survey drone is actually
     * flown at. Against the cone it sets the floor of the mission: at nine
     * metres up the pool is 4.4 m across, so the pilot can fly the lock from
     * just above the safe distance if they are precise, and a careless descent
     * costs them the attempt rather than merely the lock.
     */
    minSafeDistance: 9,
    /** Four seconds inside it before the survey fails, with the warning re-shown
     *  while the grace runs. A pilot who overshoots a descent has time to climb
     *  away; one who parks on top of the animal does not. */
    disturbGraceSec: 4,
    /*
     * THIRTY METRES ABOVE THE ANIMAL'S OWN DECK.
     *
     * Its own deck, not the clearing: the gorge floor is twenty-seven metres
     * below the pad, so a ceiling measured from the mission's `groundY` would
     * let a pilot hover over the ravine at launch height and light its floor
     * from fifty-seven metres up.
     *
     * The number is the airframe's own limit on purpose. It is not there to
     * push the pilot down — the cone and the dark already do that — it is there
     * so that a pilot who climbs to the top of the envelope over a gorge gets
     * nothing, which is the honest answer.
     */
    maxTrackAgl: 30,
  },

  /*
   * The three zones. Two of them are real.
   *
   * `pickup` and `drop` exist because `MissionZone` is a record of three and
   * cannot grow, and this mission has neither: nothing is collected and nothing
   * is put down. They are pointed at the station so that anything which reads
   * them without asking what kind of mission this is gets the pad rather than
   * the origin — which on this map is the pad anyway. Nothing draws them: see
   * `MissionMarkers`, which empties the list on a tracking mission.
   */
  zones: {
    pickup: {
      kind: 'pickup',
      at: STATION,
      label: 'Ranger station',
      groundY: CLEARING_Y,
      radius: 2.5,
      band: { min: 0, max: 3 },
      maxGroundSpeed: 12,
      maxVerticalSpeed: 12,
      hold: 0,
    },
    drop: {
      kind: 'drop',
      at: STATION,
      label: 'Sighting',
      groundY: CLEARING_Y,
      radius: 2.5,
      band: { min: 0, max: 3 },
      maxGroundSpeed: 12,
      maxVerticalSpeed: 12,
      hold: 0,
    },
    /* The pad under the spawn, and the only one of the three that is flown to.
     * Landing is judged by ground contact and stillness in the Director, so the
     * speeds here only gate the "LANDING ZONE REACHED" call. The ring is lifted
     * the same 0.35 m Mission 2's is: the road undulates half a metre along its
     * length and at the default 3 cm the mark sank behind whatever rise was
     * between the camera and it. */
    base: {
      kind: 'base',
      at: STATION,
      label: 'Ranger station',
      groundY: CLEARING_Y,
      radius: 2.5,
      band: { min: 0, max: 3 },
      maxGroundSpeed: 12,
      maxVerticalSpeed: 12,
      hold: 0,
      ringLift: 0.35,
    },
  },

  radio: {
    start: {
      id: 'nt-start',
      text: 'Pilot, one of our tigers missed the evening survey and we have no collar on it. Read your clues, take the light out over the forest and find it. Stay well back when you do — this is an observation, not an intercept.',
    },
    /* Never played by name — `radio` is an open record and nothing calls for
     * this key. It is the line the briefing quotes, kept beside the others so
     * the mission's voice lives in one place. */
    zone: {
      id: 'nt-zone',
      text: 'Last sighting was down in the gorge, near the water, heading deeper in. That was at dusk, so it has had hours to walk. Search the line, not the spot.',
    },
    located: {
      id: 'nt-located',
      text: 'That is our animal. Hold the light on it and keep your distance — five seconds and we have the sighting.',
    },
    delivered: {
      id: 'nt-observed',
      text: 'Sighting logged, and it looks in good condition. That is everything we needed — leave it be, pilot.',
    },
    /* NEITHER OF THESE IS EVER PLAYED. `radio` is a fixed record and every
     * mission has to fill it; this one ends at the sighting, so the two lines
     * about coming home belong to legs it never walks. Kept rather than faked
     * with the sign-off, so the next mission that copies this file gets the
     * record's real shape. */
    home: {
      id: 'nt-home',
      text: 'Nothing more to do out there. Bring the drone back when you are ready.',
    },
    landing: { id: 'nt-landing', text: 'Pad is below you. Bring it down gently.' },
    complete: {
      id: 'nt-complete',
      text: 'That is one tiger accounted for, and it never knew you were there. Good flying.',
    },
  },

  /*
   * The rating, and what it deliberately does NOT measure.
   *
   * There is no "how close did you get" rung, and there must not be: the
   * mission's rule is to stay back, and paying a pilot for flying nearer would
   * be the app asking for the one thing the brief forbids. Getting inside nine
   * metres is not a deduction, it ends the attempt — which is the strongest
   * statement the runtime can make about it.
   *
   * What TIME carries here is the search, exactly as it does on Mission 4: a
   * pilot who read the clues and flew to the gorge is fast, and one who swept
   * the whole forest is not.
   */
  ranks: [
    {
      stars: 3,
      text: 'Sighting logged, no collisions, inside 4:00',
      test: (r) => r.delivered && r.points >= GOLD && r.collisions === 0 && r.timeSec <= 240,
    },
    {
      stars: 2,
      text: 'Sighting logged, one collision at most',
      test: (r) => r.delivered && r.points >= GOLD && r.collisions <= 1,
    },
    { stars: 1, text: 'Log the sighting', test: (r) => r.delivered },
  ],
};
