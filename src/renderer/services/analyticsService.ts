import type { GameplayEventType } from '@shared/backend/contract';
import type { TelemetryStatus } from '@shared/backend/ipc';
import { profileBackend } from './backend';

// AnalyticsService: gameplay events.
//
// Events carry their own client timestamp, because the outbox may deliver them
// minutes (or a launch) later. `sessionKey` is the key SessionService.start
// returned, or null for something that happened outside a flight.

export const AnalyticsService = {
  track(
    eventType: GameplayEventType,
    eventData: Record<string, unknown> | undefined,
    sessionKey: string | null,
  ): void {
    profileBackend().telemetry.recordEvents(sessionKey, [
      { eventType, eventData, timestamp: new Date().toISOString() },
    ]);
  },

  /** How much recorded data is still waiting to be uploaded. */
  status(): Promise<TelemetryStatus> {
    return profileBackend().telemetry.status();
  },
};
