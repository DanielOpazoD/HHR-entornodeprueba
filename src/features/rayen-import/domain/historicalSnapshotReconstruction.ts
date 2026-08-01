import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';
import { resolveClinicalDayBounds } from '@/utils/clinicalDayScheduleUtils';
import { normalizeRut } from '@/utils/rutUtils';
import type { ConflictEntry } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { RayenCensusSnapshot, RayenEncounter } from '../contracts/rayenSnapshot';
import { mapRayenBed } from '../mapping/bedMapping';
import { encounterWallClockInRapaNui } from '../mapping/encounterWallClock';
import {
  firstPatientFlowTimestamp,
  latestPatientFlowPlacement,
  patientRunFromFlowReport,
} from '../mapping/parsePatientFlow';
import type {
  BedTraceabilityResolverDependencies,
  PatientFlowReportResult,
} from '../bedTraceabilityResolver';
import {
  deduplicateHistoricalConflicts,
  historicalReconstructionConflict as unresolvedConflict,
} from './historicalReconstructionConflicts';
import {
  collectUnreferencedLocalOccupants,
  verifyLocalOccupantsByExactEgreso,
} from './historicalLocalEgresoEvidence';
import {
  decodePdfBase64,
  encounterAtHistoricalBed,
  recoverLocalBedFromStatisticalDischarge,
} from './historicalStatisticalDischargeRecovery';
import {
  activeBedBackedCandidates,
  invalidReportBackedConflicts,
  latestReportRowsByEpisode,
  reportBackedCandidates,
  reportClinicalStamp,
  type HistoricalCandidate,
} from './historicalAdministrativeEvidence';
import { isPavilionRecoveryLocation } from './pavilionRecoverySyncPolicy';

const MAX_PARALLEL_REPORTS = 4;
const secondBefore = (localTimestamp: string): string => {
  const parsed = new Date(`${localTimestamp}Z`);
  if (Number.isNaN(parsed.getTime())) return localTimestamp;
  return new Date(parsed.getTime() - 1000).toISOString().slice(0, 19);
};
const mapWithConcurrency = async <T, R>(
  values: T[],
  worker: (value: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(MAX_PARALLEL_REPORTS, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(values[index]);
      }
    }
  );
  await Promise.all(runners);
  return results;
};
type ReconstructionEntry =
  | { encounter: RayenEncounter; conflict?: never }
  | { encounter?: never; conflict: ConflictEntry };

interface HistoricalClinicalCribCandidate {
  candidate: HistoricalCandidate;
  currentParentBedId: string;
}

const mappedPrincipalBedId = (encounter: RayenEncounter): string | null =>
  encounter.verifiedBedPlacement?.bedId ??
  mapRayenBed({
    room: encounter.room,
    bed: encounter.bed,
    service: encounter.service,
  }).bedId;

const activePrincipalEncountersByBed = (
  snapshot: RayenCensusSnapshot
): ReadonlyMap<string, RayenEncounter[]> => {
  const result = new Map<string, RayenEncounter[]>();
  for (const encounter of snapshot.encounters) {
    if (encounter.clinicalCribParentBedId) continue;
    const bedId = mappedPrincipalBedId(encounter);
    if (!bedId) continue;
    const occupants = result.get(bedId) ?? [];
    occupants.push(encounter);
    result.set(bedId, occupants);
  }
  return result;
};

const clinicalCribAtHistoricalParent = (
  encounter: RayenEncounter,
  parentBedId: string
): RayenEncounter => ({
  ...encounter,
  clinicalCribParentBedId: parentBedId,
  hasMedicalDischarge: false,
  hasNurseDischarge: false,
  dischargeDatetime: undefined,
  isDead: false,
  verifiedBedPlacement: undefined,
});

export interface HistoricalSnapshotReconstruction {
  /** Point-in-time placements proven by one official patient-flow PDF per episode. */
  snapshot: RayenCensusSnapshot;
  /** Episodes that remain visible for manual review instead of being projected from today's bed. */
  conflicts: ConflictEntry[];
}

interface HistoricalSnapshotDependencies extends BedTraceabilityResolverDependencies {
  lookupEgresos?: (targets: EgresoLookupTarget[]) => Promise<EgresoLookupResult[]>;
  fetchDischargeReport?: (encounterId: string) => Promise<PatientFlowReportResult>;
}

const recoverLocalBedFromDischarge = async (
  candidate: HistoricalCandidate,
  cutoff: string,
  dependencies: HistoricalSnapshotDependencies,
  extractText: (buffer: ArrayBuffer) => Promise<string>
): Promise<ReconstructionEntry | null> => {
  const recovered = await recoverLocalBedFromStatisticalDischarge(
    candidate,
    cutoff,
    dependencies.fetchDischargeReport,
    extractText
  );
  if (!recovered) return null;
  if ('encounter' in recovered) return recovered;
  return { conflict: unresolvedConflict(candidate.encounter, recovered.reason) };
};

/** Rebuilds a supported historical census at its nursing cutoff from exact Rayen evidence. */
export const reconstructHistoricalSnapshotAtClose = async (
  censusDay: string,
  liveSnapshot: RayenCensusSnapshot,
  record: DailyRecord,
  reportRows: EgresoReportRow[],
  dependencies: HistoricalSnapshotDependencies
): Promise<HistoricalSnapshotReconstruction> => {
  const { nextDay, nightEnd } = resolveClinicalDayBounds(censusDay);
  const cutoff = secondBefore(`${nextDay}T${nightEnd}:00`);
  const eligible: HistoricalCandidate[] = [];
  const eligibleClinicalCribs: HistoricalClinicalCribCandidate[] = [];
  const conflicts: ConflictEntry[] = [];

  // The report describes a later administrative location, not necessarily the placement at this
  // historical cutoff. Patient-flow evidence below decides whether P-R1/P-R2 must be omitted.
  const scopedReportRows = reportRows;
  const reportByEpisode = latestReportRowsByEpisode(scopedReportRows);
  conflicts.push(...invalidReportBackedConflicts(scopedReportRows, reportByEpisode));
  const liveEncounterIds = new Set(liveSnapshot.encounters.map(item => item.encounterId));
  // A current P-R1/P-R2 placement does not prove where the patient was at a historical cutoff.
  // Keep the episode as traceability input and exclude it only after resolving that past placement.
  const eligibleLiveEncounters = liveSnapshot.encounters;
  const activeAssignmentIds = new Set(
    (liveSnapshot.activeBedAssignments ?? []).map(item => item.encounterId)
  );
  const unreferencedLocal = collectUnreferencedLocalOccupants(
    record,
    new Set([...liveEncounterIds, ...reportByEpisode.keys(), ...activeAssignmentIds])
  );
  const exactLocalEgresos = await verifyLocalOccupantsByExactEgreso(
    unreferencedLocal,
    dependencies.lookupEgresos
  );
  for (const occupant of exactLocalEgresos.unresolved) {
    conflicts.push(
      unresolvedConflict(
        occupant.encounter,
        occupant.isClinicalCrib
          ? 'la cuna RN requiere conservar su vínculo materno.'
          : occupant.encounter.encounterId
            ? 'el episodio local no aparece en Ficha Médico ni en el reporte administrativo.'
            : 'el ocupante local no tiene un episodio clínico verificable.'
      )
    );
  }
  const candidates: HistoricalCandidate[] = [
    ...eligibleLiveEncounters.map(encounter => ({
      encounter,
      reportRow: reportByEpisode.get(encounter.encounterId),
    })),
    ...reportBackedCandidates(record, reportByEpisode, liveEncounterIds),
    ...activeBedBackedCandidates(
      record,
      liveSnapshot.activeBedAssignments ?? [],
      new Set([...liveEncounterIds, ...reportByEpisode.keys()])
    ),
    ...exactLocalEgresos.verified.map(item => ({
      encounter: item.encounter,
      localBedId: item.bedId,
      exactEgresoVerified: true,
      exactDischargeAt: item.dischargeAt,
    })),
  ];
  for (const {
    encounter,
    reportRow,
    localBedId,
    exactEgresoVerified,
    exactDischargeAt,
  } of candidates) {
    if (reportRow && normalizeRut(reportRow.run) !== normalizeRut(encounter.run)) {
      conflicts.push(
        unresolvedConflict(
          encounter,
          'el RUN de Ficha Médico contradice el reporte administrativo.'
        )
      );
      continue;
    }
    const dischargeStamp = reportRow ? reportClinicalStamp(reportRow) : null;
    if (dischargeStamp && dischargeStamp.iso <= censusDay) {
      // This episode had already left by the reconstructed close; the report is later applied as
      // the authoritative movement, but it must not remain in the point-in-time occupancy.
      continue;
    }
    if (exactDischargeAt && exactDischargeAt <= cutoff) continue;
    const admission = encounterWallClockInRapaNui(encounter.admissionDatetime);
    if (!admission && !reportRow && !exactEgresoVerified) {
      conflicts.push(unresolvedConflict(encounter, 'la fecha de ingreso no es verificable.'));
      continue;
    }
    if (admission && admission > cutoff) continue;
    if (!/^\d+$/.test(encounter.encounterId) || !normalizeRut(encounter.run)) {
      conflicts.push(unresolvedConflict(encounter, 'la identidad del episodio es incompleta.'));
      continue;
    }
    if (encounter.clinicalCribParentBedId) {
      if (!liveEncounterIds.has(encounter.encounterId)) {
        conflicts.push(
          unresolvedConflict(encounter, 'la cuna RN requiere conservar su vínculo materno.')
        );
        continue;
      }
      eligibleClinicalCribs.push({
        candidate: {
          encounter,
          reportRow,
          localBedId,
          exactEgresoVerified,
          exactDischargeAt,
        },
        currentParentBedId: encounter.clinicalCribParentBedId,
      });
      continue;
    }
    eligible.push({
      encounter,
      reportRow,
      localBedId,
      exactEgresoVerified,
      exactDischargeAt,
    });
  }

  const extractText = dependencies.extractText ?? extractPdfTextFromBuffer;
  const entries = await mapWithConcurrency(eligible, async candidate => {
    const { encounter } = candidate;
    try {
      const report: PatientFlowReportResult = await dependencies.fetchReport(encounter.encounterId);
      if (!report.base64 || report.error) {
        const recovered = await recoverLocalBedFromDischarge(
          candidate,
          cutoff,
          dependencies,
          extractText
        );
        if (recovered) return recovered;
        return {
          conflict: unresolvedConflict(
            encounter,
            report.error || 'no se obtuvo el informe de trazabilidad.'
          ),
        } satisfies ReconstructionEntry;
      }
      const text = await extractText(decodePdfBase64(report.base64));
      if (patientRunFromFlowReport(text) !== normalizeRut(encounter.run)) {
        return {
          conflict: unresolvedConflict(encounter, 'el RUN del informe no coincide.'),
        } satisfies ReconstructionEntry;
      }
      const placement = latestPatientFlowPlacement(text, { notAfter: cutoff });
      if (!placement) {
        const firstMovementAt = firstPatientFlowTimestamp(text);
        if (firstMovementAt && firstMovementAt > cutoff) return null;
        const recovered = await recoverLocalBedFromDischarge(
          candidate,
          cutoff,
          dependencies,
          extractText
        );
        if (recovered) return recovered;
        return {
          conflict: unresolvedConflict(
            encounter,
            'no existe una ubicación inequívoca antes del cierre del turno.'
          ),
        } satisfies ReconstructionEntry;
      }
      if (!placement.bedId && isPavilionRecoveryLocation(placement.sourceBedLabel)) return null;
      if (!placement.bedId) {
        return {
          conflict: unresolvedConflict(
            encounter,
            'la ubicación al cierre no corresponde a una cama hospitalaria reconocida.'
          ),
        } satisfies ReconstructionEntry;
      }
      return {
        encounter: encounterAtHistoricalBed(
          encounter,
          'patient-flow-report',
          placement.bedId,
          placement.changedAt
        ),
      } satisfies ReconstructionEntry;
    } catch {
      return {
        conflict: unresolvedConflict(encounter, 'falló la lectura del informe de trazabilidad.'),
      } satisfies ReconstructionEntry;
    }
  });

  const encounters: RayenEncounter[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.encounter) encounters.push(entry.encounter);
    else conflicts.push(entry.conflict);
  }

  // A physical crib has no independent HHR bed: it must follow the same mother whose current
  // association was verified by Gestion de Camas. Resolve principals first, then project the RN
  // onto the mother's proven historical bed. This keeps a mother + newborn admission atomic and
  // independent from the order in which Ficha Medico returned both encounters.
  const livePrincipalsByBed = activePrincipalEncountersByBed({
    ...liveSnapshot,
    encounters: eligibleLiveEncounters,
  });
  const reconstructedPrincipalsByEpisode = new Map(
    encounters.map(encounter => [encounter.encounterId, encounter] as const)
  );
  for (const { candidate, currentParentBedId } of eligibleClinicalCribs) {
    const { encounter } = candidate;
    const currentPrincipals = livePrincipalsByBed.get(currentParentBedId) ?? [];
    if (currentPrincipals.length !== 1) {
      conflicts.push(
        unresolvedConflict(
          encounter,
          `la cuna RN no identifica de forma inequívoca a su madre en ${currentParentBedId}.`
        )
      );
      continue;
    }
    const reconstructedMother = reconstructedPrincipalsByEpisode.get(
      currentPrincipals[0].encounterId
    );
    if (!reconstructedMother) {
      conflicts.push(
        unresolvedConflict(
          encounter,
          'la cama de la madre no pudo confirmarse al cierre del turno.'
        )
      );
      continue;
    }
    const historicalParentBedId = mappedPrincipalBedId(reconstructedMother);
    const acceptsClinicalCrib = mapRayenBed({
      clinicalCribParentBedId: historicalParentBedId ?? undefined,
    }).isClinicalCrib;
    if (!historicalParentBedId || !acceptsClinicalCrib) {
      conflicts.push(
        unresolvedConflict(
          encounter,
          'la cama histórica de la madre no admite una cuna RN vinculada.'
        )
      );
      continue;
    }
    encounters.push(clinicalCribAtHistoricalParent(encounter, historicalParentBedId));
  }

  return {
    snapshot: { ...liveSnapshot, encounters, isComplete: false },
    conflicts: deduplicateHistoricalConflicts(conflicts),
  };
};
