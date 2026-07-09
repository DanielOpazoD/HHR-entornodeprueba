/**
 * Bridge between the browser extension (which reads Rayen) and the HHR app.
 *
 * The extension's content script posts a `window.postMessage` with the snapshot;
 * this module validates the shape and forwards it to subscribers. `pushRayenSnapshot`
 * lets dev/test code inject a snapshot through the same path.
 *
 * Only the message SHAPE is trusted here; the app still previews/confirms before writing.
 */

import type { RayenCensusSnapshot, RayenEncounter } from '../contracts/rayenSnapshot';

export const RAYEN_IMPORT_MESSAGE_TYPE = 'HHR_RAYEN_CENSUS_SNAPSHOT';
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

const handlers = new Set<SnapshotHandler>();
let windowListenerAttached = false;

const onWindowMessage = (event: MessageEvent): void => {
  // Same-origin only: the extension content script posts into this page.
  if (typeof window !== 'undefined' && event.origin !== window.location.origin) return;
  if (!isRayenImportMessage(event.data)) return;
  handlers.forEach(handler => handler(event.data.snapshot));
};

/** Subscribe to Rayen snapshots delivered by the extension. Returns an unsubscribe fn. */
export const subscribeToRayenSnapshots = (handler: SnapshotHandler): (() => void) => {
  handlers.add(handler);
  if (!windowListenerAttached && typeof window !== 'undefined') {
    window.addEventListener('message', onWindowMessage);
    windowListenerAttached = true;
  }
  return () => {
    handlers.delete(handler);
  };
};

/** Inject a snapshot through the bridge (dev/testing, or a manual paste path). */
export const pushRayenSnapshot = (snapshot: RayenCensusSnapshot): void => {
  handlers.forEach(handler => handler(snapshot));
};

/** Ask the extension (if installed) to read Rayen and post back a fresh snapshot. */
export const requestRayenSnapshot = (): void => {
  if (typeof window === 'undefined') return;
  window.postMessage({ type: RAYEN_REQUEST_MESSAGE_TYPE }, window.location.origin);
};
