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
import { normalizeRut } from '@/utils/rutUtils';
import type { EgresoLookupResult } from '../contracts/egresoLookup';

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
      const read = async (timeoutMs: number) => {
        counters.requests += 1;
        const result = await requestPatientFlowReport(encId, timeoutMs);
        if (isRayenTimeoutMessage(result.error)) counters.timeouts += 1;
        return result;
      };
      const first = await read(isHistoricalDay ? 15_000 : 30_000);
      // Coalesced by the run-scoped cache. Retry only a timeout, once, for the same episode.
      return isRayenTimeoutMessage(first.error) ? read(30_000) : first;
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
    // Gestión de Camas reads each target serially (RUN and maternal RUN). A month's
    // population cannot share one 30-second bridge deadline. Bound each request and
    // parallelism, preserving a slot per identity even when one request is incomplete.
    const batchSize = 4;
    const results = new Array<EgresoLookupResult>(targets.length);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(2, Math.ceil(targets.length / batchSize)) }, async () => {
        while (cursor < targets.length) {
          const start = cursor;
          cursor += batchSize;
          const batch = targets.slice(start, start + batchSize);
          counters.requests += 1;
          const response = await requestEgresoLookup(batch).catch(() => []);
          batch.forEach((target, index) => {
            const run = typeof target === 'string' ? target : target.run;
            const encounterId = typeof target === 'string' ? '' : target.encounterId;
            const result = response[index];
            const matches =
              result &&
              normalizeRut(result.run) === normalizeRut(run) &&
              (!encounterId || result.encounterId === encounterId);
            results[start + index] = matches
              ? result
              : { run, encounterId, error: 'No se pudo completar la consulta de este egreso.' };
          });
        }
      })
    );
    return results;
  };

  const lookupHospitalizations = async (patientRun: string) => {
    const { requestRayenHospitalizationEpisodes } =
      await import('../bridge/hospitalizationReportsBridge');
    counters.requests += 1;
    return requestRayenHospitalizationEpisodes({ patientRun }, 30_000);
  };
  return {
    fetchPatientFlowReport,
    fetchStatisticalDischarge,
    lookupEgresos,
    lookupHospitalizations,
  };
};
