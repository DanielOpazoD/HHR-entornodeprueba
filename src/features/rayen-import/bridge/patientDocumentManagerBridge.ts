/** Browser bridge for the Eloisa patient document manager. */

export const RAYEN_PATIENT_DOCUMENT_MANAGER_REQUEST_TYPE =
  'HHR_RAYEN_PATIENT_DOCUMENT_MANAGER_REQUEST';
export const RAYEN_PATIENT_DOCUMENT_MANAGER_RESULT_TYPE =
  'HHR_RAYEN_PATIENT_DOCUMENT_MANAGER_RESULT';

export interface RayenPatientDocumentManagerResult {
  ok: boolean;
  count?: number;
  opened?: boolean;
  reused?: boolean;
  error?: string;
}

export const requestRayenPatientDocumentManager = (
  clinicalEpisodeId: string,
  operation: 'count' | 'open',
  timeoutMs = operation === 'count' ? 15000 : 8000,
  routeHint?: 'medical' | 'nurse'
): Promise<RayenPatientDocumentManagerResult> =>
  new Promise(resolve => {
    const encId = clinicalEpisodeId.trim();
    if (typeof window === 'undefined' || !/^\d+$/.test(encId)) {
      resolve({ ok: false, error: 'El paciente no tiene un episodio válido para abrir documentos.' });
      return;
    }

    const reqId = `patient-documents-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;
    // eslint-disable-next-line prefer-const -- cleanup closes over the timer assigned after posting
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_PATIENT_DOCUMENT_MANAGER_RESULT_TYPE || data.reqId !== reqId) {
        return;
      }
      cleanup();
      const count = Number.isInteger(data.count) && data.count >= 0 ? data.count : undefined;
      resolve({
        ok: data.ok === true,
        count,
        opened: data.opened === true,
        reused: data.reused === true,
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    };

    window.addEventListener('message', onMessage);
    window.postMessage({
      type: RAYEN_PATIENT_DOCUMENT_MANAGER_REQUEST_TYPE,
      reqId,
      encId,
      operation,
      routeHint,
    }, window.location.origin);
    timeoutId = setTimeout(() => {
      cleanup();
      resolve({ ok: false, error: 'La extensión Eloísa no respondió. Recárgala y reintenta.' });
    }, timeoutMs);
  });
