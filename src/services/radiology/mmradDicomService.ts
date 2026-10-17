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
  signal: AbortSignal
): Promise<Uint8Array> => {
  const response = await request({ action: 'instance', ticket }, signal);
  return new Uint8Array(await response.arrayBuffer());
};
