import { readDicomBytes } from './readDicomBytes';
import { DicomTransferError, type DicomLoadState } from './dicomLoadState';
import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { normalizeDicomPatientId, type DicomStudy } from './dicomTypes';

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
  signal: AbortSignal
): Promise<DicomStudy> => {
  const response = await request({ action: 'metadata', link, patientId }, signal);
  const study = (await response.json()) as DicomStudy;
  if (
    normalizeDicomPatientId(study.patientId || '') !== normalizeDicomPatientId(patientId) ||
    !study.series?.length ||
    !study.uid
  )
    throw new Error('El estudio no corresponde al paciente seleccionado.');
  return study;
};

export const fetchDicomInstance = async (
  ticket: string,
  signal: AbortSignal,
  timing?: (value: Partial<DicomLoadState['timings']>, bytes?: number) => void,
  maxBytes?: number
): Promise<Uint8Array> => {
  const start = performance.now();
  try {
    const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    const response = await request({ action: 'instance', ticket }, attemptSignal);
    const headers = performance.now();
    const bytes = await readDicomBytes(response, attemptSignal, maxBytes);
    const upstream = /upstream;dur=([0-9.]+)/.exec(response.headers.get('server-timing') || '');
    timing?.(
      {
        headers: headers - start,
        transfer: performance.now() - headers,
        ...(upstream ? { upstream: Number(upstream[1]), upstreamSamples: 1 } : {}),
      },
      bytes.byteLength
    );
    return bytes;
  } catch (error) {
    signal.throwIfAborted();
    const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
    if (
      error instanceof TypeError ||
      (typeof name === 'string' && ['TimeoutError', 'AbortError'].includes(name))
    )
      throw new DicomTransferError(true);
    throw error;
  }
};
