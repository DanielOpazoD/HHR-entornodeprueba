import {
  buildClinicalEpisodeLookupKeys,
  buildPatientPresenceSnapshot,
} from '@/domain/clinical-episode/clinicalEpisode';
import type {
  ClinicalDocumentCountsByBed,
  UnifiedBedRow,
} from '@/features/census/types/censusTableTypes';
import { normalizeRut } from '@/utils/rutUtils';

/** Lightweight projection of a clinical-document record for presence checks. */
type ClinicalDocumentPresenceRecord = {
  status: string;
  episodeKey: string;
  patientRut?: string;
};

/** Retain only badge inputs in the polling cache; full records remain repository-owned. */
export const projectClinicalDocumentPresence = (
  records: ClinicalDocumentPresenceRecord[]
): ClinicalDocumentPresenceRecord[] =>
  records.map(({ status, episodeKey, patientRut }) => ({ status, episodeKey, patientRut }));

/** Maps a bed to its patient's clinical episode key. */
export interface BedEpisodeBinding {
  bedId: string;
  episodeKey: string;
  episodeKeys?: string[];
  currentPatientRut?: string;
}

/**
 * Extracts bed-to-episode-key bindings from occupied census rows.
 * Only the main row shows a count for its own patient.
 */
export const buildBedEpisodeBindings = (unifiedRows: UnifiedBedRow[]): BedEpisodeBinding[] =>
  unifiedRows
    .filter(
      (row): row is Extract<UnifiedBedRow, { kind: 'occupied' }> =>
        row.kind === 'occupied' && !row.isSubRow
    )
    .flatMap(row => {
      const snapshot = buildPatientPresenceSnapshot(row.data, row.bed.id);
      if (!snapshot) {
        return [];
      }

      return [
        {
          bedId: snapshot.bedId,
          episodeKey: snapshot.episodeKey,
          episodeKeys: buildClinicalEpisodeLookupKeys(row.data, snapshot.episodeKey),
          currentPatientRut: snapshot.patientRut,
        },
      ];
    });

const recordMatchesPatientRut = (
  record: ClinicalDocumentPresenceRecord,
  binding: BedEpisodeBinding
): boolean => {
  const currentPatientRut = normalizeRut(binding.currentPatientRut);
  if (!currentPatientRut) {
    return true;
  }

  const documentRut = normalizeRut(record.patientRut);
  return !documentRut || documentRut === currentPatientRut;
};

export const countActiveClinicalDocumentsByBed = (
  bindings: BedEpisodeBinding[],
  records: ClinicalDocumentPresenceRecord[]
): ClinicalDocumentCountsByBed => {
  const byEpisode = new Map<string, ClinicalDocumentPresenceRecord[]>();
  for (const record of records) {
    if (record.status === 'archived') continue;
    const entries = byEpisode.get(record.episodeKey);
    if (entries) entries.push(record);
    else byEpisode.set(record.episodeKey, [record]);
  }
  const counts: Record<string, number> = {};
  for (const binding of bindings) {
    let totalCount = 0;
    // Repeated aliases must not count the same source record twice.
    const keys = new Set(binding.episodeKeys?.length ? binding.episodeKeys : [binding.episodeKey]);
    for (const key of keys) {
      for (const record of byEpisode.get(key) || []) {
        if (recordMatchesPatientRut(record, binding)) totalCount++;
      }
    }
    counts[binding.bedId] = totalCount;
  }
  return counts;
};
