// Hand-edited content for the About page. Everything else on that page is read
// from the running app (version, platform, registries, account state); only
// what the code cannot know lives here.

export interface ComingNextItem {
  title: string;
  note: string;
}

/**
 * Upcoming updates, shown under "Coming next".
 *
 * PLACEHOLDER: the repository has no roadmap, changelog or TODO file to draw
 * these from, so this list is empty on purpose. Add real, agreed items here.
 * While it is empty the page says so instead of showing made-up features.
 *
 * @example { title: 'Drone Studio', note: 'Build and tune your own drone' }
 */
export const COMING_NEXT: ComingNextItem[] = [];

/** Where "Explore Pluto Drones" sends the user, in their default browser. */
export const DRONA_AVIATION_URL = 'https://dronaaviation.com';
