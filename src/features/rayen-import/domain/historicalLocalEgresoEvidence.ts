import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';
import { isSameForeignDocument, isValidRut, normalizeRut } from '@/utils/rutUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import { encounterWallClockInRapaNui } from '../mapping/encounterWallClock';
import { historicalEncounterFromLocal } from './historicalEncounterFromLocal';
import { isPavilionRecoveryLocation } from './pavilionRecoverySyncPolicy';
import type { PatientFlowReportResult } from '../bedTraceabilityResolver';
import { parseStatisticalDischargeEvidence } from '../mapping/parseStatisticalDischargeReport';
import { decodePdfBase64 } from './historicalStatisticalDischargeRecovery';

interface IndividualDischargeProof {
  fetchDischargeReport?: (encounterId: string) => Promise<PatientFlowReportResult>;
  extractText?: (buffer: ArrayBuffer) => Promise<string>;
}

export interface LocalHistoricalOccupant {
  encounter: RayenEncounter;
  bedId: string;
  isClinicalCrib: boolean;
}

export interface VerifiedLocalEgresoOccupant extends LocalHistoricalOccupant {
  exactEgresoVerified: true;
  dischargeAt: string;
}

export interface ExactLocalEgresoResolution {
  verified: VerifiedLocalEgresoOccupant[];
  unresolved: LocalHistoricalOccupant[];
}

/** Local occupants absent from today's live sources, retaining the only bed HHR may preserve. */
export const collectUnreferencedLocalOccupants = (
  record: DailyRecord,
  referencedEpisodes: ReadonlySet<string>
): LocalHistoricalOccupant[] => {
  const occupants: LocalHistoricalOccupant[] = [];
  for (const [bedId, bed] of Object.entries(record.beds)) {
    for (const entry of [
      { patient: bed, isClinicalCrib: false },
      { patient: bed.clinicalCrib, isClinicalCrib: true },
    ]) {
      const patient = entry.patient;
      if (
        !patient?.patientName?.trim() ||
        patient.isBlocked ||
        isPavilionRecoveryLocation(patient.location)
      )
        continue;
      const encounter = historicalEncounterFromLocal(
        patient,
        entry.isClinicalCrib ? bedId : undefined
      );
      if (encounter.encounterId && referencedEpisodes.has(encounter.encounterId)) continue;
      occupants.push({ encounter, bedId, isClinicalCrib: entry.isClinicalCrib });
    }
  }
  return occupants;
};

const exactVerifiedDischargeAt = async (
  occupant: LocalHistoricalOccupant,
  result: EgresoLookupResult | undefined,
  proof?: IndividualDischargeProof
): Promise<string | null> => {
  const egreso = result?.egreso;
  const isPassport = occupant.encounter.documentType === 'Pasaporte';
  const lookupDocumentMatches = isPassport
    ? isSameForeignDocument(result?.run, occupant.encounter.run)
    : normalizeRut(result?.run) === normalizeRut(occupant.encounter.run);
  if (
    !egreso ||
    result?.error ||
    result?.encounterId !== occupant.encounter.encounterId ||
    !lookupDocumentMatches ||
    egreso.hasAdministrativeDischarge === false ||
    String(egreso.id ?? occupant.encounter.encounterId) !== occupant.encounter.encounterId
  )
    return null;
  const dischargeAt = encounterWallClockInRapaNui(
    String(egreso.dateDischarge || egreso.endPeriod || '')
  );
  if (!dischargeAt || egreso.hasAdministrativeDischarge === true) return dischargeAt;
  // Sparse lookup metadata is not proof of discharge. Require the exact official PDF,
  // its document identity, complete interval, and agreement with the lookup timestamp to the printed minute.
  if (!proof?.fetchDischargeReport) return null;
  try {
    const report = await proof.fetchDischargeReport(occupant.encounter.encounterId);
    if (!report.base64 || report.error) return null;
    const evidence = parseStatisticalDischargeEvidence(
      await (proof.extractText ?? extractPdfTextFromBuffer)(decodePdfBase64(report.base64)),
      { allowForeignDocument: isPassport || !isValidRut(occupant.encounter.run) }
    );
    if (!evidence) return null;
    if (isPassport && evidence.identifierKind !== 'foreign-document') return null;
    const documentMatches =
      evidence.identifierKind === 'foreign-document'
        ? isSameForeignDocument(evidence.run, occupant.encounter.run)
        : evidence.run === normalizeRut(occupant.encounter.run);
    return documentMatches && evidence.dischargeAt.slice(0, 16) === dischargeAt.slice(0, 16)
      ? dischargeAt
      : null;
  } catch {
    return null;
  }
};

/**
 * Verifies missing local episodes against Gestión de Camas by exact ENC_ID + RUN.
 * Merely finding another hospitalization for the same RUN never authorizes reconstruction.
 */
export const verifyLocalOccupantsByExactEgreso = async (
  occupants: LocalHistoricalOccupant[],
  lookup?: (targets: EgresoLookupTarget[]) => Promise<EgresoLookupResult[]>,
  proof?: IndividualDischargeProof
): Promise<ExactLocalEgresoResolution> => {
  if (!lookup) return { verified: [], unresolved: occupants };
  const eligible = occupants.filter(
    item =>
      !item.isClinicalCrib &&
      /^\d+$/.test(item.encounter.encounterId) &&
      Boolean(
        item.encounter.documentType === 'Pasaporte'
          ? isSameForeignDocument(item.encounter.run, item.encounter.run)
          : normalizeRut(item.encounter.run)
      )
  );
  if (eligible.length === 0) return { verified: [], unresolved: occupants };

  let results: EgresoLookupResult[] = [];
  try {
    results = await lookup(
      eligible.map(item => ({
        run: item.encounter.run,
        encounterId: item.encounter.encounterId,
        ...(item.encounter.documentType === 'Pasaporte'
          ? { documentType: 'Pasaporte' as const }
          : {}),
      }))
    );
  } catch {
    return { verified: [], unresolved: occupants };
  }

  const verified: VerifiedLocalEgresoOccupant[] = [];
  const verifiedEpisodes = new Set<string>();
  for (const occupant of eligible) {
    const result = results.find(
      candidate => candidate.encounterId === occupant.encounter.encounterId
    );
    const dischargeAt = await exactVerifiedDischargeAt(occupant, result, proof);
    if (!dischargeAt) continue;
    verified.push({ ...occupant, exactEgresoVerified: true, dischargeAt });
    verifiedEpisodes.add(occupant.encounter.encounterId);
  }
  return {
    verified,
    unresolved: occupants.filter(occupant => !verifiedEpisodes.has(occupant.encounter.encounterId)),
  };
};
