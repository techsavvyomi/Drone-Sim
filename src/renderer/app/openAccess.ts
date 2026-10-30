/** Accounts that can fly every mission and lesson from the start (user, 2026-10-30). */
const EVERYTHING_OPEN_FOR = ['atharva@dronaaviation.com'];

export function everythingOpen(email: string | null | undefined): boolean {
  return !!email && EVERYTHING_OPEN_FOR.includes(email.trim().toLowerCase());
}
