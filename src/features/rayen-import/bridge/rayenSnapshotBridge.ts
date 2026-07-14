import type { RayenCensusSnapshot, RayenEncounter } from '../contracts/rayenSnapshot';

export const RAYEN_IMPORT_MESSAGE_TYPE = 'HHR_RAYEN_CENSUS_SNAPSHOT';
export const RAYEN_IMPORT_ERROR_MESSAGE_TYPE = 'HHR_RAYEN_IMPORT_ERROR';
export const RAYEN_REQUEST_MESSAGE_TYPE = 'HHR_RAYEN_REQUEST_SNAPSHOT';

interface RayenImportMessage {
  type: typeof RAYEN_IMPORT_MESSAGE_TYPE;
  snapshot: RayenCensusSnapshot;
}

const isEncounter = (value: unknown): value is RayenEncounter => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.encounterId === 'string' &&
    typeof candidate.run === 'string' &&
    typeof candidate.firstGivenName === 'string' &&
    typeof candidate.firstFamilyName === 'string'
  );
};

export const isRayenCensusSnapshot = (value: unknown): value is RayenCensusSnapshot => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.facilityId === 'number' &&
    typeof candidate.capturedAt === 'string' &&
    Array.isArray(candidate.encounters) &&
    candidate.encounters.every(isEncounter)
  );
};

const isRayenImportMessage = (value: unknown): value is RayenImportMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === RAYEN_IMPORT_MESSAGE_TYPE && isRayenCensusSnapshot(candidate.snapshot);
};

type SnapshotHandler = (snapshot: RayenCensusSnapshot) => void;
type ImportErrorHandler = (error: string) => void;

const handlers = new Set<SnapshotHandler>();
const errorHandlers = new Set<ImportErrorHandler>();
let windowListenerAttached = false;

const detachWindowListenerIfUnused = (): void => {
  if (
    handlers.size === 0 &&
    errorHandlers.size === 0 &&
    windowListenerAttached &&
    typeof window !== 'undefined'
  ) {
    window.removeEventListener('message', onWindowMessage);
    windowListenerAttached = false;
  }
};

const attachWindowListener = (): void => {
  if (!windowListenerAttached && typeof window !== 'undefined') {
    window.addEventListener('message', onWindowMessage);
    windowListenerAttached = true;
  }
};

const onWindowMessage = (event: MessageEvent): void => {
  if (typeof window !== 'undefined' && event.origin !== window.location.origin) return;
  if (
    typeof event.data === 'object' &&
    event.data !== null &&
    event.data.type === RAYEN_IMPORT_ERROR_MESSAGE_TYPE &&
    typeof event.data.error === 'string'
  ) {
    errorHandlers.forEach(handler => handler(event.data.error));
    return;
  }
  if (!isRayenImportMessage(event.data)) return;
  handlers.forEach(handler => handler(event.data.snapshot));
};

export const subscribeToRayenSnapshots = (handler: SnapshotHandler): (() => void) => {
  handlers.add(handler);
  attachWindowListener();
  return () => {
    handlers.delete(handler);
    detachWindowListenerIfUnused();
  };
};

export const subscribeToRayenImportErrors = (handler: ImportErrorHandler): (() => void) => {
  errorHandlers.add(handler);
  attachWindowListener();
  return () => {
    errorHandlers.delete(handler);
    detachWindowListenerIfUnused();
  };
};

export const pushRayenSnapshot = (snapshot: RayenCensusSnapshot): void => {
  handlers.forEach(handler => handler(snapshot));
};

export const requestRayenSnapshot = (): void => {
  if (typeof window === 'undefined') return;
  window.postMessage({ type: RAYEN_REQUEST_MESSAGE_TYPE }, window.location.origin);
};
