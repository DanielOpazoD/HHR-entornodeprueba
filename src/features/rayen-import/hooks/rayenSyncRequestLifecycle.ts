import { cancelRayenSyncBundleRequest, requestRayenSyncBundle } from '../bridge/rayenImportBridge';

const SYNC_TIMEOUT_MS = 75_000;

/** Owns one correlated sync request so superseded or timed-out responses become inert. */
export const createRayenSyncRequestController = () => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let activeRequest: { requestId: string; runId: string } | null = null;

  const cancel = (): void => {
    if (timeout) clearTimeout(timeout);
    if (activeRequest) cancelRayenSyncBundleRequest(activeRequest.requestId);
    timeout = null;
    activeRequest = null;
  };

  const start = (
    dateStart: string,
    dateEnd: string,
    runId: string,
    onTimeout: () => void
  ): string => {
    cancel();
    const requestId = requestRayenSyncBundle(dateStart, dateEnd);
    activeRequest = { requestId, runId };
    timeout = setTimeout(() => {
      if (activeRequest?.requestId !== requestId) return;
      cancelRayenSyncBundleRequest(requestId);
      activeRequest = null;
      timeout = null;
      onTimeout();
    }, SYNC_TIMEOUT_MS);
    return requestId;
  };

  const getRunId = (requestId: string): string | null =>
    activeRequest?.requestId === requestId ? activeRequest.runId : null;

  return Object.freeze({ cancel, start, getRunId });
};

export type RayenSyncRequestController = ReturnType<typeof createRayenSyncRequestController>;
