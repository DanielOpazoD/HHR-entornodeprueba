import { requestViaBridgeChannel } from '@/services/transport/extensionRequestChannel';
import type { PatientFlowBridgeResult } from './patientFlowBridge';

export const RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_REQUEST_TYPE =
  'HHR_RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_REQUEST';
export const RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_RESULT_TYPE =
  'HHR_RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_RESULT';

/** Reads an already-authorized exact-episode egreso PDF without downloading it to the user. */
export const requestStatisticalDischargeEvidence = (
  encId: string,
  timeoutMs = 15000
): Promise<PatientFlowBridgeResult> => {
  if (typeof window === 'undefined' || !/^\d+$/.test(encId)) {
    return Promise.resolve({ base64: '', error: 'El episodio clínico no es válido.' });
  }
  return requestViaBridgeChannel<PatientFlowBridgeResult>({
    prefix: 'statistical-evidence',
    requestType: RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_REQUEST_TYPE,
    resultType: RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_RESULT_TYPE,
    payload: { encId },
    timeoutMs,
    onTimeout: () => ({
      base64: '',
      error: 'Tiempo de espera agotado leyendo el egreso individual.',
    }),
    mapResult: data => ({
      base64: typeof data.base64 === 'string' ? data.base64 : '',
      error: typeof data.error === 'string' ? data.error : undefined,
    }),
  });
};
