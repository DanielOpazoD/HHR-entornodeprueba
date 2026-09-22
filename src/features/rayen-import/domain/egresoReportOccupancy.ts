import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import {
  officialPatientIdentityKey,
  officialPatientTypedIdentitiesEqual,
  type OfficialPatientDocumentType,
} from './officialPatientIdentifier';

export interface OccupiedBedEvidence {
  bedId: string;
  patientName: string;
  rut?: string;
  documentType?: OfficialPatientDocumentType;
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

export const occupiedBedsByRun = (record: DailyRecord): Map<string, OccupiedBedEvidence> => {
  const byRun = new Map<string, OccupiedBedEvidence>();
  for (const [bedId, patient] of Object.entries(record.beds)) {
    if (!patient?.patientName?.trim() || patient.isBlocked) continue;
    const run = officialPatientIdentityKey(patient.rut, patient.documentType);
    const key = patient.clinicalEpisodeId ? `episode:${patient.clinicalEpisodeId}` : run;
    if (key)
      byRun.set(key, {
        bedId,
        patientName: patient.patientName,
        rut: patient.rut,
        documentType: patient.documentType,
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
  episodeId?: string,
  documentType?: OfficialPatientDocumentType
): OccupiedBedEvidence | undefined =>
  (episodeId ? index.get(`episode:${episodeId}`) : undefined) ??
  [...index.values()].find(entry => episodeId && entry.clinicalEpisodeId === episodeId) ??
  (officialPatientIdentityKey(run, documentType)
    ? [...index.values()].find(entry =>
        officialPatientTypedIdentitiesEqual(entry.rut, entry.documentType, run, documentType)
      )
    : undefined);

export const occupiedClinicalCribsByRun = (
  record: DailyRecord
): Map<string, OccupiedClinicalCrib> => {
  const byRun = new Map<string, OccupiedClinicalCrib>();
  for (const [parentBedId, parent] of Object.entries(record.beds)) {
    const patient = parent?.clinicalCrib;
    if (!patient?.patientName?.trim() || patient.isBlocked) continue;
    const run = officialPatientIdentityKey(patient.rut, patient.documentType);
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
  parentBedId?: string,
  documentType?: OfficialPatientDocumentType
): OccupiedClinicalCrib | undefined =>
  (episodeId ? index.get(`episode:${episodeId}`) : undefined) ??
  [...index.values()].find(entry => episodeId && entry.patient.clinicalEpisodeId === episodeId) ??
  (officialPatientIdentityKey(run, documentType)
    ? [...index.values()].find(entry =>
        officialPatientTypedIdentitiesEqual(
          entry.patient.rut,
          entry.patient.documentType,
          run,
          documentType
        )
      )
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
              crib.parentBedId,
              crib.patient.documentType
            )
          )
      )
      .map(crib => crib.source.encounterId)
  );
};
