// What the app may open outside itself.
//
// Only the support email, for Settings → About → Report a bug. Checked in the
// main process rather than the page, so nothing running in the window can use
// the channel to launch other URLs, programs or local files.

export const SUPPORT_EMAIL = 'support@plutodrones.com';

export function isAllowedExternalUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'mailto:' && decodeURIComponent(url.pathname).toLowerCase() === SUPPORT_EMAIL;
  } catch {
    return false;
  }
}
