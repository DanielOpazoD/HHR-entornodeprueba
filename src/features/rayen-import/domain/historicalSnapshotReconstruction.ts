import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';
import { resolveClinicalDayBounds } from '@/utils/clinicalDayScheduleUtils';
import { normalizeRut } from '@/utils/rutUtils';
import type { ConflictEntry } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { RayenCensusSnapshot, RayenEncounter } from '../contracts/rayenSnapshot';
import { encounterWallClockInRapaNui } from '../mapping/encounterWallClock';
import {
  firstPatientFlowTimestamp,
  latestPatientFlowMovement,
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
  invalidReportBackedConflicts,
  latestReportRowsByEpisode,
  reportBackedCandidates,
  reportClinicalStamp,
  type HistoricalCandidate,
} from './historicalAdministrativeEvidence';

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
  const conflicts: ConflictEntry[] = [];

  const reportByEpisode = latestReportRowsByEpisode(reportRows);
  conflicts.push(...invalidReportBackedConflicts(reportRows, reportByEpisode));
  const liveEncounterIds = new Set(liveSnapshot.encounters.map(item => item.encounterId));
  const unreferencedLocal = collectUnreferencedLocalOccupants(
    record,
    new Set([...liveEncounterIds, ...reportByEpisode.keys()])
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
          ? 'la cuna clínica requiere conservar su vínculo materno.'
          : occupant.encounter.encounterId
            ? 'el episodio local no aparece en Ficha Médico ni en el reporte administrativo.'
            : 'el ocupante local no tiene un episodio clínico verificable.'
      )
    );
  }
  const candidates: HistoricalCandidate[] = [
    ...liveSnapshot.encounters.map(encounter => ({
      encounter,
      reportRow: reportByEpisode.get(encounter.encounterId),
    })),
    ...reportBackedCandidates(record, reportByEpisode, liveEncounterIds),
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
      conflicts.push(
        unresolvedConflict(encounter, 'la cuna clínica requiere conservar su vínculo materno.')
      );
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
      const movement = latestPatientFlowMovement(text, { notAfter: cutoff });
      if (!movement) {
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
      return {
        encounter: encounterAtHistoricalBed(
          encounter,
          'patient-flow-report',
          movement.bedId,
          movement.changedAt
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

  return {
    snapshot: { ...liveSnapshot, encounters, isComplete: false },
    conflicts: deduplicateHistoricalConflicts(conflicts),
  };
};
