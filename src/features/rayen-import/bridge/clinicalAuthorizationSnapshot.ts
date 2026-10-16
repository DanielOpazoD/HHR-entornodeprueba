import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';
import {
  isRayenCensusSnapshot,
  isRayenSyncBundle,
  RAYEN_IMPORT_MESSAGE_TYPE,
  RAYEN_IMPORT_ERROR_MESSAGE_TYPE,
  RAYEN_SYNC_BUNDLE_REQUEST_MESSAGE_TYPE,
  RAYEN_SYNC_BUNDLE_CANCEL_MESSAGE_TYPE,
} from './rayenSnapshotBridge';

/** Read-only capture with its own correlation: never replaces the census run's active request. */
export const requestClinicalAuthorizationSnapshot = (
  signal: AbortSignal,
  timeoutMs = 90_000
): Promise<RayenCensusSnapshot | null> =>
  new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      resolve(null);
      return;
    }
    const dateStart = calendarStampInClinicalTimeZone(new Date()).iso;
    const dateEnd = new Date(Date.parse(`${dateStart}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const requestId = `clinical-authorization-${crypto.randomUUID()}`;
    let settled = false;
    let sent = false;
    const finish = (snapshot: RayenCensusSnapshot | null, cancel = false) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      signal.removeEventListener('abort', onAbort);
      if (cancel && sent) {
        try {
          window.postMessage(
            { type: RAYEN_SYNC_BUNDLE_CANCEL_MESSAGE_TYPE, requestId },
            window.location.origin
          );
        } catch {
          /* Local cleanup is still mandatory when the relay disappeared. */
        }
      }
      if (signal.aborted)
        reject(signal.reason ?? new DOMException('Stage cancelled', 'AbortError'));
      else resolve(snapshot);
    };
    const onAbort = () => finish(null, true);
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.requestId !== requestId
      )
        return;
      if (event.data.type === RAYEN_IMPORT_ERROR_MESSAGE_TYPE) finish(null);
      if (event.data.type === RAYEN_IMPORT_MESSAGE_TYPE) {
        const { snapshot, bundle } = event.data;
        finish(
          isRayenCensusSnapshot(snapshot) &&
            snapshot.isComplete === true &&
            isRayenSyncBundle(bundle) &&
            bundle.facilityId === snapshot.facilityId &&
            bundle.fichaMedicoCapturedAt === snapshot.capturedAt &&
            bundle.dateStart === dateStart &&
            bundle.dateEnd === dateEnd
            ? snapshot
            : null
        );
      }
    };
    const timer = signal.aborted ? undefined : setTimeout(() => finish(null, true), timeoutMs);
    if (signal.aborted) {
      onAbort();
      return;
    }
    window.addEventListener('message', onMessage);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      sent = true;
      window.postMessage(
        { type: RAYEN_SYNC_BUNDLE_REQUEST_MESSAGE_TYPE, requestId, dateStart, dateEnd },
        window.location.origin
      );
    } catch {
      finish(null);
    }
  });
