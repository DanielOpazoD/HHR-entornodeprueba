import type { PatientFlowBridgeResult } from './patientFlowBridge';

export const RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_REQUEST_TYPE =
  'HHR_RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_REQUEST';
export const RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_RESULT_TYPE =
  'HHR_RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_RESULT';

/** Reads an already-authorized exact-episode egreso PDF without downloading it to the user. */
export const requestStatisticalDischargeEvidence = (
  encId: string,
  timeoutMs = 15000
): Promise<PatientFlowBridgeResult> =>
  new Promise(resolve => {
    if (typeof window === 'undefined' || !/^\d+$/.test(encId)) {
      resolve({ base64: '', error: 'El episodio clínico no es válido.' });
      return;
    }
    const reqId = `statistical-evidence-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
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
      if (
        !data ||
        data.type !== RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_RESULT_TYPE ||
        data.reqId !== reqId
      )
        return;
      cleanup();
      resolve({
        base64: typeof data.base64 === 'string' ? data.base64 : '',
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    };
    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_REQUEST_TYPE, reqId, encId },
      window.location.origin
    );
    timeoutId = setTimeout(() => {
      cleanup();
      resolve({ base64: '', error: 'Tiempo de espera agotado leyendo el egreso individual.' });
    }, timeoutMs);
  });
