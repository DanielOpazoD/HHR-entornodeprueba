import { readDicomBytes } from './readDicomBytes';
import {
  DicomOriginalTooLargeError,
  DicomTicketExpiredError,
  DicomTransferError,
  type DicomLoadState,
} from './dicomLoadState';
import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { normalizeDicomPatientId, type DicomStudy } from './dicomTypes';
import {
  LARGE_DICOM_ORIGINAL_TIMEOUT_MS,
  MAX_LARGE_DICOM_ORIGINAL_BYTES,
  requestLargeDicomOriginal,
} from './mmradDicomSantiago';

const request = async (body: object, signal: AbortSignal): Promise<Response> => {
  const auth = await resolveCurrentUserAuthHeaders();
  signal.throwIfAborted();
  const response = await fetch('/.netlify/functions/mmrad-dicom', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    cache: 'no-store',
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const error = data && typeof data === 'object' && 'error' in data ? data.error : null;
    if ('action' in body && body.action === 'instance') {
      const coded = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      if (response.status === 403 && coded.code === 'ticket-expired')
        throw new DicomTicketExpiredError();
      if (response.status === 413 && coded.code === 'too-large') {
        const bytes = Number(coded.bytes);
        throw new DicomOriginalTooLargeError(
          Number.isFinite(bytes) && bytes > 0 ? bytes : undefined
        );
      }
      const retry = response.headers.get('retry-after');
      const seconds =
        retry && /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : retry
            ? Date.parse(retry) - Date.now()
            : 0;
      throw new DicomTransferError(
        [408, 429, 500, 502, 503, 504].includes(response.status),
        Number.isFinite(seconds) ? Math.max(0, seconds) : 0
      );
    }
    throw new Error(typeof error === 'string' ? error : 'No se pudo conectar con MMRAD.');
  }
  if (response.headers.get('content-type')?.includes('text/html'))
    throw new Error('El servidor DICOM no está disponible. En local utiliza Netlify Dev.');
  return response;
};

export const fetchDicomStudy = async (
  link: string,
  patientId: string,
  signal: AbortSignal,
  registeredPatientId?: string
): Promise<DicomStudy> => {
  const response = await request(
    {
      action: 'metadata',
      link,
      patientId,
      ...(registeredPatientId ? { registeredPatientId } : {}),
    },
    signal
  );
  const study = (await response.json()) as DicomStudy;
  if (
    normalizeDicomPatientId(study.patientId || '') !== normalizeDicomPatientId(patientId) ||
    normalizeDicomPatientId(study.registeredPatientId || '') !==
      normalizeDicomPatientId(registeredPatientId || '') ||
    !study.series?.length ||
    !study.uid
  )
    throw new Error('El estudio no corresponde al paciente seleccionado.');
  return study;
};

type InstanceTiming = (value: Partial<DicomLoadState['timings']>, bytes?: number) => void;

/** Reads one instance answer within its own time limit and reports its phases. */
const readInstance = async (
  send: (signal: AbortSignal) => Promise<Response>,
  timeoutMs: number,
  signal: AbortSignal,
  timing?: InstanceTiming,
  maxBytes?: number
): Promise<Uint8Array> => {
  const start = performance.now();
  const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  const response = await send(attemptSignal);
  const headers = performance.now();
  const bytes = await readDicomBytes(response, attemptSignal, maxBytes);
  const serverTiming = response.headers.get('server-timing') || '';
  const duration = (name: string) => {
    const match = new RegExp(`(?:^|,\\s*)${name};dur=([0-9.]+)(?:,|$)`).exec(serverTiming);
    const value = match ? Number(match[1]) : NaN;
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  const upstream = duration('upstream');
  const serverAuth = duration('auth');
  const upstreamHeaders = duration('upstream_headers');
  const upstreamBody = duration('upstream_body');
  timing?.(
    {
      headers: headers - start,
      transfer: performance.now() - headers,
      ...(upstream !== undefined ? { upstream, upstreamSamples: 1 } : {}),
      ...(serverAuth !== undefined && upstreamHeaders !== undefined && upstreamBody !== undefined
        ? { serverAuth, upstreamHeaders, upstreamBody, serverSamples: 1 }
        : {}),
    },
    bytes.byteLength
  );
  return bytes;
};

const isTransientTransfer = (error: unknown): boolean => {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  return (
    error instanceof TypeError ||
    (typeof name === 'string' && ['TimeoutError', 'AbortError'].includes(name))
  );
};

/**
 * An original the bridge cannot carry comes from the Santiago function instead, with the same
 * retry, renewal and cancellation. If that fails too, the bridge's too-large message stays.
 */
const fetchLargeOriginal = async (
  ticket: string,
  tooLarge: DicomOriginalTooLargeError,
  signal: AbortSignal,
  timing?: InstanceTiming,
  maxBytes?: number
): Promise<Uint8Array> => {
  const limit = Math.min(
    maxBytes ?? MAX_LARGE_DICOM_ORIGINAL_BYTES,
    MAX_LARGE_DICOM_ORIGINAL_BYTES
  );
  // A size MMRAD already declared beyond the limit (or the prefetch room) is not downloaded.
  if (tooLarge.bytes !== undefined && tooLarge.bytes > limit) throw tooLarge;
  try {
    return await readInstance(
      attempt => requestLargeDicomOriginal(ticket, tooLarge, attempt),
      LARGE_DICOM_ORIGINAL_TIMEOUT_MS,
      signal,
      timing,
      limit
    );
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof DicomTransferError) throw error;
    if (isTransientTransfer(error)) throw new DicomTransferError(true);
    throw tooLarge;
  }
};

export const fetchDicomInstance = async (
  ticket: string,
  signal: AbortSignal,
  timing?: InstanceTiming,
  maxBytes?: number
): Promise<Uint8Array> => {
  try {
    return await readInstance(
      attempt => request({ action: 'instance', ticket }, attempt),
      30_000,
      signal,
      timing,
      maxBytes
    );
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof DicomOriginalTooLargeError)
      return fetchLargeOriginal(ticket, error, signal, timing, maxBytes);
    if (isTransientTransfer(error)) throw new DicomTransferError(true);
    throw error;
  }
};
