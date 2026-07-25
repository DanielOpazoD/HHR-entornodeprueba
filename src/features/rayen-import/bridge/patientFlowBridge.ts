export const RAYEN_PATIENT_FLOW_REQUEST_TYPE = 'HHR_RAYEN_PATIENT_FLOW_REQUEST';
export const RAYEN_PATIENT_FLOW_RESULT_TYPE = 'HHR_RAYEN_PATIENT_FLOW_RESULT';

export interface PatientFlowBridgeResult {
  base64: string;
  error?: string;
}

/** Fetch the official patient-flow PDF for one exact encounter. Used only to resolve a bed conflict. */
export const requestPatientFlowReport = (
  encId: string,
  timeoutMs = 30000
): Promise<PatientFlowBridgeResult> =>
  new Promise(resolve => {
    if (typeof window === 'undefined' || !/^\d+$/.test(encId)) {
      resolve({ base64: '', error: 'El episodio clínico no es válido.' });
      return;
    }
    const reqId = `patient-flow-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      if (timeoutId) clearTimeout(timeoutId);
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_PATIENT_FLOW_RESULT_TYPE || data.reqId !== reqId) return;
      cleanup();
      resolve({
        base64: typeof data.base64 === 'string' ? data.base64 : '',
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    };
    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_PATIENT_FLOW_REQUEST_TYPE, reqId, encId },
      window.location.origin
    );
    timeoutId = setTimeout(() => {
      cleanup();
      resolve({ base64: '', error: 'Tiempo de espera agotado consultando la trazabilidad.' });
    }, timeoutMs);
  });
