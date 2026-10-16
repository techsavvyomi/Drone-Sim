import { useSyncExternalStore } from 'react';
import { Badge } from '../ds';

/** Whether the computer has a network, from the OS (what Electron's `net.isOnline`
 *  in the main process also reads). It cannot see a Wi-Fi with no internet
 *  behind it; a sign-in then still answers with the "No internet" banner. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine !== false,
    () => true,
  );
}

/**
 * ● Online / ▲ Offline, always on show. Before, being offline was only known
 * once Sign in had failed (tester, TC-OFF-001).
 */
export function ConnectionChip() {
  const online = useOnline();
  return (
    <span
      className="net-chip"
      role="status"
      title={
        online
          ? 'Connected. Flights and progress save to your profile.'
          : 'No internet. A pilot who signed in here before can still sign in. Flights upload when you are back online.'
      }
    >
      {online ? (
        <Badge tone="armed" icon="dot">
          Online
        </Badge>
      ) : (
        <Badge tone="caution" icon="warning">
          Offline
        </Badge>
      )}
    </span>
  );
}
