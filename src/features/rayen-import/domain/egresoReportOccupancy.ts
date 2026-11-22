import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import {
  documentKeyBeforeLetterRule,
  isSameDocumentBeforeLetterRule,
  normalizeRut,
} from '@/utils/rutUtils';
import { recordedOutcomeEpisodeId } from './censusDischargeHistory';

export interface OccupiedBedEvidence {
  bedId: string;
  patientName: string;
  rut?: string;
  clinicalEpisodeId?: string;
  admissionDate?: string;
  admissionTime?: string;
  location?: string;
}

export interface OccupiedClinicalCrib {
  parentBedId: string;
  parent: DailyRecord['beds'][string];
  patient: DailyRecord['beds'][string];
}

/** The principal bed a document ends in under this plan: its move, admission or current bed. */
export const indexPrincipalBeds =
  (diff: CensusImportDiff, occupied: ReadonlyMap<string, OccupiedBedEvidence>) =>
  (document: string): string | undefined => {
    const sameDocument = (rut?: string) => isSameDocumentBeforeLetterRule(rut, document);
    return (
      diff.moves.findLast(entry => sameDocument(entry.rut))?.toBedId ??
      diff.admissions.findLast(entry => sameDocument(entry.patient.rut))?.bedId ??
      (normalizeRut(document)
        ? [...occupied.values()].findLast(current => sameDocument(current.rut))?.bedId
        : undefined)
    );
  };

export const hasRecordedDifferentEpisode = (
  record: DailyRecord,
  run: string,
  activeEpisode: string
): boolean => {
  return (
    Boolean(activeEpisode) &&
    [...(record.discharges ?? []), ...(record.cma ?? []), ...(record.transfers ?? [])].some(
      movement =>
        isSameDocumentBeforeLetterRule(movement.rut, run) &&
        Boolean(movement.clinicalEpisodeId) &&
        movement.clinicalEpisodeId !== activeEpisode
    )
  );
};

export const collectRecordedMovementRuns = (record: DailyRecord): Set<string> => {
  const runs = new Set<string>();
  const add = (rut?: string): void => {
    const run = normalizeRut(rut);
    if (run) runs.add(run);
  };
  for (const movement of [
    ...(record.discharges ?? []),
    ...(record.cma ?? []),
    ...(record.transfers ?? []),
  ]) {
    add(movement.rut);
  }
  return runs;
};

export const hasRecordedMovement = (
  record: DailyRecord,
  run: string,
  encounterId?: string
): boolean => {
  return [...(record.discharges ?? []), ...(record.cma ?? []), ...(record.transfers ?? [])].some(
    movement =>
      !movement.deletedAt &&
      (encounterId
        ? recordedOutcomeEpisodeId(movement) === encounterId
        : isSameDocumentBeforeLetterRule(movement.rut, run))
  );
};

export const occupiedBedsByRun = (record: DailyRecord): Map<string, OccupiedBedEvidence> => {
  const byRun = new Map<string, OccupiedBedEvidence>();
  for (const [bedId, patient] of Object.entries(record.beds)) {
    if (!patient?.patientName?.trim() || patient.isBlocked) continue;
    const run = documentKeyBeforeLetterRule(patient.rut);
    const key = patient.clinicalEpisodeId ? `episode:${patient.clinicalEpisodeId}` : run;
    if (key)
      byRun.set(key, {
        bedId,
        patientName: patient.patientName,
        rut: patient.rut,
        clinicalEpisodeId: patient.clinicalEpisodeId,
        admissionDate: patient.admissionDate,
        admissionTime: patient.admissionTime,
        location: patient.location,
      });
  }
  return byRun;
};

export const findOccupiedBed = (
  index: ReadonlyMap<string, OccupiedBedEvidence>,
  run?: string,
  episodeId?: string
): OccupiedBedEvidence | undefined =>
  (episodeId ? index.get(`episode:${episodeId}`) : undefined) ??
  [...index.values()].find(entry => episodeId && entry.clinicalEpisodeId === episodeId) ??
  (normalizeRut(run)
    ? [...index.values()].find(entry => isSameDocumentBeforeLetterRule(entry.rut, run))
    : undefined);

export const occupiedClinicalCribsByRun = (
  record: DailyRecord
): Map<string, OccupiedClinicalCrib> => {
  const byRun = new Map<string, OccupiedClinicalCrib>();
  for (const [parentBedId, parent] of Object.entries(record.beds)) {
    const patient = parent?.clinicalCrib;
    if (!patient?.patientName?.trim() || patient.isBlocked) continue;
    const run = documentKeyBeforeLetterRule(patient.rut);
    const key = patient.clinicalEpisodeId
      ? `episode:${patient.clinicalEpisodeId}`
      : run || `parent:${parentBedId}`;
    byRun.set(key, { parentBedId, parent, patient });
  }
  return byRun;
};

export const findOccupiedClinicalCrib = (
  index: ReadonlyMap<string, OccupiedClinicalCrib>,
  run?: string,
  episodeId?: string,
  parentBedId?: string
): OccupiedClinicalCrib | undefined =>
  (episodeId ? index.get(`episode:${episodeId}`) : undefined) ??
  [...index.values()].find(entry => episodeId && entry.patient.clinicalEpisodeId === episodeId) ??
  (normalizeRut(run)
    ? [...index.values()].find(entry => isSameDocumentBeforeLetterRule(entry.patient.rut, run))
    : undefined) ??
  (parentBedId ? index.get(`parent:${parentBedId}`) : undefined) ??
  [...index.values()].find(entry => parentBedId && entry.parentBedId === parentBedId);

export const unchangedClinicalCribEpisodes = (
  diff: CensusImportDiff,
  occupied: ReadonlyMap<string, OccupiedClinicalCrib>
): Set<string> => {
  const plannedEpisodes = new Set(
    [
      ...diff.admissions,
      ...diff.updates,
      ...diff.moves,
      ...diff.pendingAdministrativeDischarges,
      ...diff.conflicts,
    ]
      .map(entry => entry.source?.encounterId)
      .filter(Boolean)
  );
  return new Set(
    (diff.activeClinicalCribs ?? [])
      .filter(
        crib =>
          !plannedEpisodes.has(crib.source.encounterId) &&
          Boolean(
            findOccupiedClinicalCrib(
              occupied,
              crib.patient.rut,
              crib.source.encounterId,
              crib.parentBedId
            )
          )
      )
      .map(crib => crib.source.encounterId)
  );
};
