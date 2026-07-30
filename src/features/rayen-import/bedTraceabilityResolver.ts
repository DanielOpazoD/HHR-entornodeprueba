import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';
import type { CensusImportDiff } from './contracts/censusImportDiff';
import type { DailyRecord, PatientData } from './contracts/rayenDomainContracts';
import type { RayenCensusSnapshot, RayenEncounter } from './contracts/rayenSnapshot';
import type { EgresoLookupResult } from './contracts/egresoLookup';
import { toIsoCensusDay } from './domain/censusDayPolicy';
import {
  isDischargedEncounter as isClosed,
  isOccupiedCensusPatient as isOccupied,
} from './domain/censusReconciliationPredicates';
import { latestPatientFlowMovement, patientRunFromFlowReport } from './mapping/parsePatientFlow';
import {
  absoluteInstantInRapaNui,
  encounterWallClockInRapaNui,
} from './mapping/encounterWallClock';
import { normalizeRut } from '@/utils/rutUtils';
import { historicalEncounterFromLocal } from './domain/historicalEncounterFromLocal';

export interface PatientFlowReportResult {
  base64: string;
  error?: string;
}

export interface BedTraceabilityResolverDependencies {
  fetchReport: (encounterId: string) => Promise<PatientFlowReportResult>;
  extractText?: (buffer: ArrayBuffer) => Promise<string>;
}

const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const findExactEncounter = (
  occupant: PatientData,
  encounters: RayenEncounter[]
): RayenEncounter | undefined => {
  if (occupant.clinicalEpisodeId) {
    return encounters.find(encounter => encounter.encounterId === occupant.clinicalEpisodeId);
  }
  const rut = normalizeRut(occupant.rut);
  if (!rut) return undefined;
  const matches = encounters.filter(encounter => normalizeRut(encounter.run) === rut);
  return matches.length === 1 ? matches[0] : undefined;
};

/**
 * Adds official bed-placement evidence only for a closed encounter that is actively blocking an
 * admission. Missing, malformed or contradictory reports leave the original conflict untouched.
 */
export const resolveOccupiedBedTraceability = async (
  current: DailyRecord,
  snapshot: RayenCensusSnapshot,
  diff: CensusImportDiff,
  dependencies: BedTraceabilityResolverDependencies
): Promise<RayenCensusSnapshot> => {
  const placementCutoff = absoluteInstantInRapaNui(snapshot.capturedAt);
  const censusDay = toIsoCensusDay(current.date);
  if (!placementCutoff || !censusDay) return snapshot;
  const effectiveCutoff = [placementCutoff, `${censusDay}T23:59:59`].sort()[0];
  const candidates = new Map<string, RayenEncounter>();
  for (const conflict of diff.conflicts) {
    if (conflict.code !== 'occupied-local-bed' || !conflict.bedId) continue;
    const occupant = current.beds[conflict.bedId];
    if (!isOccupied(occupant)) continue;
    const encounter = findExactEncounter(occupant, snapshot.encounters);
    if (
      !encounter ||
      encounter.verifiedBedPlacement ||
      !isClosed(encounter) ||
      !/^\d+$/.test(encounter.encounterId)
    )
      continue;
    candidates.set(encounter.encounterId, encounter);
  }
  if (candidates.size === 0) return snapshot;

  const extractText = dependencies.extractText ?? extractPdfTextFromBuffer;
  const evidence = new Map<string, NonNullable<RayenEncounter['verifiedBedPlacement']>>();
  await Promise.all(
    [...candidates.keys()].map(async encounterId => {
      try {
        const encounter = candidates.get(encounterId);
        const admissionCutoff = encounterWallClockInRapaNui(encounter?.admissionDatetime);
        if (!encounter || !admissionCutoff) return;
        const report = await dependencies.fetchReport(encounterId);
        if (!report.base64 || report.error) return;
        const reportText = await extractText(base64ToArrayBuffer(report.base64));
        const reportRun = patientRunFromFlowReport(reportText);
        const encounterRun = normalizeRut(encounter.run);
        if (!reportRun || !encounterRun || reportRun !== encounterRun) return;
        const movement = latestPatientFlowMovement(reportText, {
          notBefore: admissionCutoff,
          notAfter: effectiveCutoff,
        });
        if (!movement) return;
        evidence.set(encounterId, {
          source: 'patient-flow-report',
          bedId: movement.bedId,
          changedAt: movement.changedAt,
        });
      } catch {
        // Fail closed: the occupied-bed conflict remains reviewable and no placement is invented.
      }
    })
  );
  if (evidence.size === 0) return snapshot;

  return {
    ...snapshot,
    encounters: snapshot.encounters.map(encounter => {
      const verifiedBedPlacement = evidence.get(encounter.encounterId);
      return verifiedBedPlacement ? { ...encounter, verifiedBedPlacement } : encounter;
    }),
  };
};

export interface BedTraceabilityChainResult {
  snapshot: RayenCensusSnapshot;
  diff: CensusImportDiff;
}

const lookupConfirmsActiveEpisode = (
  results: EgresoLookupResult[],
  episodeId: string,
  rut: string
): boolean => {
  const normalizedRut = normalizeRut(rut);
  const exact = results.find(
    result =>
      String(result.encounterId ?? '').trim() === episodeId &&
      Boolean(normalizedRut) &&
      normalizeRut(result.run) === normalizedRut
  );
  return Boolean(
    exact?.egreso &&
    exact.egreso.hasAdministrativeDischarge === false &&
    exact.egreso.hasMedicalDischarge === false &&
    (exact.egreso.hasNurseDischarge === false || exact.egreso.hasNursingDischarge === false) &&
    exact.egreso.hasNurseDischarge !== true &&
    exact.egreso.hasNursingDischarge !== true &&
    !String(exact.egreso.dateDischarge || exact.egreso.endPeriod || '').trim()
  );
};

/**
 * Recovers an exact local episode omitted by the active Ficha snapshot when its official flow
 * report still proves a physical HHR placement and the exact administrative lookup explicitly
 * confirms that the episode has neither clinical nor administrative discharge at capture time.
 * This keeps identity episode-first and turns an actual CMA-to-ward correction into a bed move,
 * without treating the bed label itself as patient identity.
 */
export const recoverMissingSnapshotPlacements = async (
  current: DailyRecord,
  snapshot: RayenCensusSnapshot,
  diff: CensusImportDiff,
  lookupResults: EgresoLookupResult[],
  dependencies: BedTraceabilityResolverDependencies,
  replan: (snapshot: RayenCensusSnapshot) => CensusImportDiff
): Promise<BedTraceabilityChainResult> => {
  const captureCutoff = absoluteInstantInRapaNui(snapshot.capturedAt);
  if (!captureCutoff) return { snapshot, diff };
  const candidates = diff.pendingAdministrativeDischarges.flatMap(entry => {
    const encounterId = String(entry.encounterId ?? '').trim();
    if (entry.signal !== 'missing-from-ficha' || !/^\d+$/.test(encounterId)) return [];
    const patient = current.beds[entry.bedId];
    if (
      !isOccupied(patient) ||
      patient.clinicalEpisodeId?.trim() !== encounterId ||
      !lookupConfirmsActiveEpisode(lookupResults, encounterId, patient.rut)
    ) {
      return [];
    }
    return [{ patient, encounterId }];
  });
  if (candidates.length === 0) return { snapshot, diff };

  const extractText = dependencies.extractText ?? extractPdfTextFromBuffer;
  const recovered = (
    await Promise.all(
      candidates.map(async ({ patient, encounterId }): Promise<RayenEncounter | undefined> => {
        try {
          const report = await dependencies.fetchReport(encounterId);
          if (!report.base64 || report.error) return;
          const text = await extractText(base64ToArrayBuffer(report.base64));
          const expectedRut = normalizeRut(patient.rut);
          if (!expectedRut || patientRunFromFlowReport(text) !== expectedRut) return;
          const localEncounter = historicalEncounterFromLocal(patient);
          const admissionCutoff = encounterWallClockInRapaNui(localEncounter.admissionDatetime);
          const movement = latestPatientFlowMovement(text, {
            ...(admissionCutoff ? { notBefore: admissionCutoff } : {}),
            notAfter: captureCutoff,
          });
          if (!movement) return;
          return {
            ...localEncounter,
            encounterId,
            hasMedicalDischarge: false,
            hasNurseDischarge: false,
            dischargeDatetime: undefined,
            verifiedBedPlacement: {
              source: 'patient-flow-report',
              bedId: movement.bedId,
              changedAt: movement.changedAt,
            },
          };
        } catch {
          // Keep the original pending-discharge review when evidence is unavailable or ambiguous.
        }
        return undefined;
      })
    )
  ).filter((encounter): encounter is RayenEncounter => Boolean(encounter));
  if (recovered.length === 0) return { snapshot, diff };
  const recoveredIds = new Set(recovered.map(encounter => encounter.encounterId));
  const resolvedSnapshot = {
    ...snapshot,
    encounters: [
      ...snapshot.encounters.filter(encounter => !recoveredIds.has(encounter.encounterId)),
      ...recovered,
    ],
  };
  return { snapshot: resolvedSnapshot, diff: replan(resolvedSnapshot) };
};

/** Resolves newly exposed closed-patient blockers in bounded rounds, never refetching proven episodes. */
export const resolveOccupiedBedTraceabilityChain = async (
  current: DailyRecord,
  snapshot: RayenCensusSnapshot,
  initialDiff: CensusImportDiff,
  dependencies: BedTraceabilityResolverDependencies,
  replan: (snapshot: RayenCensusSnapshot) => CensusImportDiff
): Promise<BedTraceabilityChainResult> => {
  let resolvedSnapshot = snapshot;
  let diff = initialDiff;
  for (let pass = 0; pass < snapshot.encounters.length; pass += 1) {
    const nextSnapshot = await resolveOccupiedBedTraceability(
      current,
      resolvedSnapshot,
      diff,
      dependencies
    );
    if (nextSnapshot === resolvedSnapshot) break;
    resolvedSnapshot = nextSnapshot;
    diff = replan(resolvedSnapshot);
  }
  return { snapshot: resolvedSnapshot, diff };
};
