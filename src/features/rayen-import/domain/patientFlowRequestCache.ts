import type { PatientFlowReportResult } from '../bedTraceabilityResolver';

type PatientFlowReportReader = (encounterId: string) => Promise<PatientFlowReportResult>;

/**
 * Reuses one valid official traceability report inside a single synchronization run.
 *
 * Failed or empty reads are deliberately evicted so a later reconciliation stage can retry the
 * extension. The cache must remain request-scoped: keeping it between runs could hide a newer bed
 * movement from Eloisa.
 */
export const createPatientFlowRequestCache = (
  readReport: PatientFlowReportReader,
  observers: { onHit?: () => void; onMiss?: () => void } = {}
): PatientFlowReportReader => {
  const requests = new Map<string, Promise<PatientFlowReportResult>>();

  return encounterId => {
    const existing = requests.get(encounterId);
    if (existing) {
      observers.onHit?.();
      return existing;
    }

    observers.onMiss?.();
    const request = readReport(encounterId).then(
      result => {
        if (!result.base64 || result.error) requests.delete(encounterId);
        return result;
      },
      error => {
        requests.delete(encounterId);
        throw error;
      }
    );
    requests.set(encounterId, request);
    return request;
  };
};
