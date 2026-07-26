import { normalizeRut } from '@/utils/rutUtils';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import type { PatientFlowReportResult } from '../bedTraceabilityResolver';
import {
  confirmsHospitalizationAt,
  hasUnitTransferAtOrBefore,
  parseStatisticalDischargeEvidence,
} from '../mapping/parseStatisticalDischargeReport';

type HistoricalBedSource = 'patient-flow-report' | 'statistical-discharge-interval';

interface StatisticalRecoveryInput {
  encounter: RayenEncounter;
  localBedId?: string;
  exactEgresoVerified?: boolean;
}

export type StatisticalRecoveryResult = { encounter: RayenEncounter } | { reason: string } | null;

export const decodePdfBase64 = (base64: string): ArrayBuffer => {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

export const encounterAtHistoricalBed = (
  encounter: RayenEncounter,
  source: HistoricalBedSource,
  bedId: string,
  changedAt: string
): RayenEncounter => ({
  ...encounter,
  hasMedicalDischarge: false,
  hasNurseDischarge: false,
  dischargeDatetime: undefined,
  isDead: false,
  verifiedBedPlacement: { source, bedId, changedAt },
});

/** Preserves a known local bed only when the exact discharge proves the interval and no transfer. */
export const recoverLocalBedFromStatisticalDischarge = async (
  candidate: StatisticalRecoveryInput,
  cutoff: string,
  fetchReport: ((encounterId: string) => Promise<PatientFlowReportResult>) | undefined,
  extractText: (buffer: ArrayBuffer) => Promise<string>
): Promise<StatisticalRecoveryResult> => {
  if (!candidate.exactEgresoVerified || !candidate.localBedId || !fetchReport) return null;
  try {
    const report = await fetchReport(candidate.encounter.encounterId);
    if (!report.base64 || report.error) return null;
    const text = await extractText(decodePdfBase64(report.base64));
    const evidence = parseStatisticalDischargeEvidence(text);
    if (!evidence) return { reason: 'el egreso individual no pudo verificarse.' };
    if (evidence.run !== normalizeRut(candidate.encounter.run)) {
      return { reason: 'el RUN del egreso individual no coincide.' };
    }
    if (!confirmsHospitalizationAt(evidence, cutoff)) {
      return { reason: 'el egreso individual no confirma hospitalización al cierre del turno.' };
    }
    if (hasUnitTransferAtOrBefore(evidence, cutoff)) {
      return {
        reason:
          'el egreso registra un traslado previo al cierre y no permite conservar la cama local.',
      };
    }
    return {
      encounter: encounterAtHistoricalBed(
        candidate.encounter,
        'statistical-discharge-interval',
        candidate.localBedId,
        evidence.admissionAt
      ),
    };
  } catch {
    return null;
  }
};
