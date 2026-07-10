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
import type { EgresoLookupResult } from '../contracts/egresoLookup';
import type { EgresoReportRow } from '../contracts/egresoReport';

export const RAYEN_IMPORT_MESSAGE_TYPE = 'HHR_RAYEN_CENSUS_SNAPSHOT';
export const RAYEN_REQUEST_MESSAGE_TYPE = 'HHR_RAYEN_REQUEST_SNAPSHOT';
export const RAYEN_EGRESO_LOOKUP_REQUEST_TYPE = 'HHR_RAYEN_EGRESO_LOOKUP_REQUEST';
export const RAYEN_EGRESO_LOOKUP_RESULT_TYPE = 'HHR_RAYEN_EGRESO_LOOKUP_RESULT';
export const RAYEN_EGRESO_REPORT_REQUEST_TYPE = 'HHR_RAYEN_EGRESO_REPORT_REQUEST';
export const RAYEN_EGRESO_REPORT_RESULT_TYPE = 'HHR_RAYEN_EGRESO_REPORT_RESULT';

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
    // Tear down the shared window listener once the last subscriber leaves, so the
    // bridge keeps no global listener while the import feature is unmounted.
    if (handlers.size === 0 && windowListenerAttached && typeof window !== 'undefined') {
      window.removeEventListener('message', onWindowMessage);
      windowListenerAttached = false;
    }
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

/**
 * Ask the extension to look up the egresos of the given RUNs in gestión de camas — used to
 * recover definitive discharges for patients absent from Ficha Médico (late sync). Resolves
 * to `[]` if the extension / gestión de camas tab is unavailable or times out, so the caller
 * degrades gracefully (keeps the inferred discharges).
 */
export const requestEgresoLookup = (
  runs: string[],
  timeoutMs = 30000
): Promise<EgresoLookupResult[]> =>
  new Promise(resolve => {
    if (typeof window === 'undefined' || !Array.isArray(runs) || runs.length === 0) {
      resolve([]);
      return;
    }
    const reqId = `egreso-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_EGRESO_LOOKUP_RESULT_TYPE || data.reqId !== reqId) return;
      cleanup();
      resolve(Array.isArray(data.results) ? (data.results as EgresoLookupResult[]) : []);
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_EGRESO_LOOKUP_REQUEST_TYPE, reqId, runs },
      window.location.origin
    );
    setTimeout(() => {
      cleanup();
      resolve([]);
    }, timeoutMs);
  });

/**
 * Ask the extension to download + parse the bulk "Alta Administrativa" egreso report for a date
 * range (ISO YYYY-MM-DD) in gestión de camas. This enumerates the day's egresos — including
 * patients HHR never synced — with their discharge destination. Resolves to `[]` if the
 * extension / gestión de camas tab is unavailable or times out, so the caller degrades gracefully.
 */
export const requestEgresoReport = (
  dateStart: string,
  dateEnd: string,
  timeoutMs = 40000
): Promise<EgresoReportRow[]> =>
  new Promise(resolve => {
    if (typeof window === 'undefined' || !dateStart || !dateEnd) {
      resolve([]);
      return;
    }
    const reqId = `egreso-report-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_EGRESO_REPORT_RESULT_TYPE || data.reqId !== reqId) return;
      cleanup();
      resolve(Array.isArray(data.rows) ? (data.rows as EgresoReportRow[]) : []);
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_EGRESO_REPORT_REQUEST_TYPE, reqId, dateStart, dateEnd },
      window.location.origin
    );
    setTimeout(() => {
      cleanup();
      resolve([]);
    }, timeoutMs);
  });
