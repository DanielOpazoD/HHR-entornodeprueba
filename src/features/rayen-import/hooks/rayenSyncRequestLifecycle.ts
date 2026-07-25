import { cancelRayenSyncBundleRequest, requestRayenSyncBundle } from '../bridge/rayenImportBridge';

const SYNC_TIMEOUT_MS = 75_000;

/** Owns one correlated sync request so superseded or timed-out responses become inert. */
export const createRayenSyncRequestController = () => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let requestId: string | null = null;

  const cancel = (): void => {
    if (timeout) clearTimeout(timeout);
    if (requestId) cancelRayenSyncBundleRequest(requestId);
    timeout = null;
    requestId = null;
  };

  const start = (dateStart: string, dateEnd: string, onTimeout: () => void): void => {
    cancel();
    requestId = requestRayenSyncBundle(dateStart, dateEnd);
    timeout = setTimeout(() => {
      if (requestId) cancelRayenSyncBundleRequest(requestId);
      requestId = null;
      timeout = null;
      onTimeout();
    }, SYNC_TIMEOUT_MS);
  };

  return Object.freeze({ cancel, start });
};
