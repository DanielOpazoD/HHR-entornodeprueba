import { requestEgresoLookup } from '../bridge/rayenImportBridge';
import { requestPatientFlowReport } from '../bridge/patientFlowBridge';
import { requestStatisticalDischargeEvidence } from '../bridge/statisticalDischargeEvidenceBridge';
import {
  RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
  type RayenExtensionHealthCheck,
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
  const readExtensionHealth = async (): Promise<RayenExtensionHealthCheck> => {
    // Evidence reads are blocking sync work, not a passive status check. Share both attempts
    // across callers, but never interpret a missing/failed handshake as a missing capability.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      counters.requests += 1;
      try {
        const health = await requestRayenExtensionHealth(RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS);
        if (isRayenTimeoutMessage(health.error)) counters.timeouts += 1;
        if (health.report && !health.error) return health;
      } catch (error) {
        if (isRayenTimeoutMessage(error)) counters.timeouts += 1;
      }
    }
    return {
      report: null,
      error:
        'No se pudo verificar temporalmente la extensión Eloísa tras dos intentos. Vuelve a intentar la sincronización.',
    };
  };

  let extensionHealth: ReturnType<typeof requestRayenExtensionHealth> | null = null;
  const getExtensionHealth = () => {
    if (!extensionHealth) {
      extensionHealth = readExtensionHealth().then(health => {
        // Keep verified capabilities for this run; a later stage may retry a failed handshake.
        if (!health.report) extensionHealth = null;
        return health;
      });
    }
    return extensionHealth;
  };

  const fetchPatientFlowReport = createPatientFlowRequestCache(
    async encId => {
      const health = await getExtensionHealth();
      if (!health.report) return { base64: '', error: health.error };
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
    if (!health.report) return { base64: '', error: health.error };
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
