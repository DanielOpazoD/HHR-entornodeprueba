import {
  DicomTicketExpiredError,
  DicomTransferError,
  type DicomOriginalTooLargeError,
} from './dicomLoadState';
import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { defaultFirebaseConfigRuntimeAdapter } from '@/services/firebase-runtime/firebaseConfigRuntimeAdapter';

/** What the Santiago function returns at most (`functions/lib/mmrad/mmradDicomSantiagoFunction.js`). */
export const MAX_LARGE_DICOM_ORIGINAL_BYTES = 30_000_000;
/** 25 MB to Rapa Nui on a slow link; the function itself stops after 180 s. */
export const LARGE_DICOM_ORIGINAL_TIMEOUT_MS = 150_000;

const FIREBASE_PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

const santiagoUrl = (): string => {
  const projectId = defaultFirebaseConfigRuntimeAdapter.getOptionalApp()?.options.projectId ?? '';
  if (!FIREBASE_PROJECT_ID.test(projectId)) throw new Error('Firebase sin proyecto.');
  return `https://southamerica-west1-${projectId}.cloudfunctions.net/mmradDicomSantiago`;
};

/**
 * Asks the Santiago function for an original that `mmrad-dicom` cannot carry (Netlify responses
 * hold ~4.5 MB; MMRAD's radiographs are 23-25 MB). Transient answers and an expired ticket keep
 * the bridge's retry and renewal; any other refusal keeps the bridge's own too-large error.
 */
export const requestLargeDicomOriginal = async (
  ticket: string,
  tooLarge: DicomOriginalTooLargeError,
  signal: AbortSignal
): Promise<Response> => {
  const auth = await resolveCurrentUserAuthHeaders();
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(santiagoUrl(), {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
      signal,
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch (error) {
    // The bridge answered a moment ago, so a refusal before any answer (no function, no CORS,
    // no invoker) is not the network: show the bridge's message instead of retrying it.
    if (signal.aborted) throw error;
    throw tooLarge;
  }
  if (response.ok && response.headers.get('content-type')?.includes('application/dicom'))
    return response;
  const data: unknown = await response.json().catch(() => null);
  const coded = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  if (response.status === 403 && coded.code === 'ticket-expired')
    throw new DicomTicketExpiredError();
  if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
    const retry = response.headers.get('retry-after');
    throw new DicomTransferError(true, retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : 0);
  }
  throw tooLarge;
};
