import { requestEgresoLookup } from '../bridge/rayenImportBridge';
import { requestPatientFlowReport } from '../bridge/patientFlowBridge';
import { requestStatisticalDischargeEvidence } from '../bridge/statisticalDischargeEvidenceBridge';
import {
  requestRayenExtensionHealth,
  supportsPatientFlowReport,
  supportsStatisticalDischargeEvidence,
} from '../bridge/extensionHealthBridge';
import { createPatientFlowRequestCache } from '../domain/patientFlowRequestCache';
import { isRayenTimeoutMessage } from '../domain/rayenSyncPerformance';

interface EvidenceCounters {
  requests: number;
  cacheHits: number;
  timeouts: number;
}

export const createRayenSnapshotEvidenceClient = (
  isHistoricalDay: boolean,
  counters: EvidenceCounters
) => {
  let extensionHealth: ReturnType<typeof requestRayenExtensionHealth> | null = null;
  const getExtensionHealth = () => {
    if (!extensionHealth) {
      counters.requests += 1;
      extensionHealth = requestRayenExtensionHealth();
    }
    return extensionHealth;
  };

  const fetchPatientFlowReport = createPatientFlowRequestCache(
    async encId => {
      const health = await getExtensionHealth();
      if (!supportsPatientFlowReport(health.report)) {
        return { base64: '', error: 'La extensión instalada no admite trazabilidad de camas.' };
      }
      counters.requests += 1;
      const result = await requestPatientFlowReport(encId, isHistoricalDay ? 15_000 : 30_000);
      if (isRayenTimeoutMessage(result.error)) counters.timeouts += 1;
      return result;
    },
    {
      onHit: () => {
        counters.cacheHits += 1;
      },
    }
  );

  const fetchStatisticalDischarge = async (encId: string) => {
    const health = await getExtensionHealth();
    if (!supportsStatisticalDischargeEvidence(health.report)) {
      return {
        base64: '',
        error: 'La extensión instalada no admite lectura del egreso individual.',
      };
    }
    counters.requests += 1;
    const result = await requestStatisticalDischargeEvidence(encId);
    if (isRayenTimeoutMessage(result.error)) counters.timeouts += 1;
    return result;
  };

  const lookupEgresos = async (targets: Parameters<typeof requestEgresoLookup>[0]) => {
    if (targets.length === 0) return [];
    counters.requests += 1;
    return requestEgresoLookup(targets);
  };

  return { fetchPatientFlowReport, fetchStatisticalDischarge, lookupEgresos };
};
