import { requestViaBridgeChannel } from '@/services/transport/extensionRequestChannel';
import type { ClinicalReadErrorCode } from '@/types/domain/rayenSync';
import { decodeClinicalReadFailure } from '../contracts/clinicalReadError';

export const RAYEN_PATIENT_FLOW_REQUEST_TYPE = 'HHR_RAYEN_PATIENT_FLOW_REQUEST';
export const RAYEN_PATIENT_FLOW_RESULT_TYPE = 'HHR_RAYEN_PATIENT_FLOW_RESULT';

export interface PatientFlowBridgeResult {
  base64: string;
  error?: string;
  errorCode?: ClinicalReadErrorCode;
}

/** Fetch the official patient-flow PDF for one exact encounter. Used only to resolve a bed conflict. */
export const requestPatientFlowReport = (
  encId: string,
  timeoutMs = 30000
): Promise<PatientFlowBridgeResult> => {
  if (typeof window === 'undefined' || !/^\d+$/.test(encId)) {
    return Promise.resolve({ base64: '', error: 'El episodio clínico no es válido.' });
  }
  return requestViaBridgeChannel<PatientFlowBridgeResult>({
    prefix: 'patient-flow',
    requestType: RAYEN_PATIENT_FLOW_REQUEST_TYPE,
    resultType: RAYEN_PATIENT_FLOW_RESULT_TYPE,
    payload: { encId },
    timeoutMs,
    onTimeout: () => ({
      base64: '',
      error: 'Tiempo de espera agotado consultando la trazabilidad.',
    }),
    mapResult: data => ({
      base64: typeof data.base64 === 'string' ? data.base64 : '',
      ...decodeClinicalReadFailure(data),
    }),
  });
};
