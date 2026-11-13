import { getSessionOwner } from '@/services/storage/sessionStorageTransition';
import type { OperationalTelemetryEvent } from '@/services/observability/operationalTelemetryTypes';
import {
  canUseOperationalTelemetryLocalStorage,
  OPERATIONAL_TELEMETRY_STORAGE_KEY,
  sanitizePersistedOperationalTelemetryEvent,
  trimOperationalTelemetryEvents,
} from '@/services/observability/operationalTelemetrySupport';

type LocalTelemetryEvent = OperationalTelemetryEvent & { localOwnerKey?: string | null };
let memoryEvents: LocalTelemetryEvent[] = [];

export const persistOperationalTelemetryEvents = (
  events: LocalTelemetryEvent[],
  options: { onPersistError?: (error: unknown) => void } = {}
): void => {
  memoryEvents = trimOperationalTelemetryEvents(events);

  if (!canUseOperationalTelemetryLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(OPERATIONAL_TELEMETRY_STORAGE_KEY, JSON.stringify(memoryEvents));
  } catch (error) {
    options.onPersistError?.(error);
  }
};

const readRetainedOperationalTelemetryEvents = (
  options: { onReadError?: (error: unknown) => void } = {}
): LocalTelemetryEvent[] => {
  if (memoryEvents.length > 0) {
    return memoryEvents;
  }

  if (!canUseOperationalTelemetryLocalStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(OPERATIONAL_TELEMETRY_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    memoryEvents = trimOperationalTelemetryEvents(
      parsed
        .map((value: unknown) => {
          const event = sanitizePersistedOperationalTelemetryEvent(value);
          return event
            ? {
                ...event,
                localOwnerKey:
                  value &&
                  typeof value === 'object' &&
                  'localOwnerKey' in value &&
                  typeof value.localOwnerKey === 'string'
                    ? value.localOwnerKey
                    : undefined,
              }
            : null;
        })
        .filter(event => event !== null)
    );
    return memoryEvents;
  } catch (error) {
    options.onReadError?.(error);
    return [];
  }
};

/** Only the recorder reads the retained history when appending; UI readers never see other owners. */
export const appendOperationalTelemetryEvent = (
  event: OperationalTelemetryEvent,
  options: {
    onReadError?: (error: unknown) => void;
    onPersistError?: (error: unknown) => void;
  } = {}
): void => {
  persistOperationalTelemetryEvents(
    [
      ...readRetainedOperationalTelemetryEvents(options),
      { ...event, localOwnerKey: getSessionOwner() },
    ],
    options
  );
};

export const readOperationalTelemetryEvents = (
  options: { onReadError?: (error: unknown) => void } = {}
): OperationalTelemetryEvent[] => {
  const owner = getSessionOwner();
  // Unattributed legacy events remain retained, but cannot establish a right to read clinical context.
  return owner
    ? readRetainedOperationalTelemetryEvents(options)
        .filter(event => event.localOwnerKey === owner)
        .map(({ localOwnerKey: _owner, ...event }) => event)
    : [];
};
