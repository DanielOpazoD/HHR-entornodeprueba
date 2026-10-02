/**
 * Clinical Document Presence Controller
 *
 * Pure logic that maps clinical-document records to per-bed presence
 * indicators. Used by the census table to show which patients have
 * active records and to display count badges in the
 * orbital quick-action launcher.
 *
 * Data flow:
 *   unifiedRows → buildBedEpisodeBindings → episodeKeys
 *   Firestore query (by episodeKeys) → ClinicalDocumentPresenceRecord[]
 *   records → buildClinicalDocumentPresenceByBed (boolean per bed)
 *   records → buildClinicalDocumentPresenceInfoByBed (counts per bed)
 */

import {
  buildClinicalEpisodeLookupKeys,
  buildPatientPresenceSnapshot,
} from '@/application/patient-flow/clinicalEpisode';
import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/** Per-bed record presence with counts for badge display. */
export interface ClinicalDocumentPresenceInfo {
  /** Whether the patient has at least one active (non-archived) record. */
  present: boolean;
  /** Total number of active (non-archived) documents. */
  totalCount: number;
  /** Number of documents still in draft status. */
  draftCount: number;
}

// ---------------------------------------------------------------------------
// Bed → Episode bindings
// ---------------------------------------------------------------------------

/**
 * Extracts bed-to-episode-key bindings from occupied census rows.
 * Sub-rows (clinical cribs) are excluded since they share the
 * parent bed's episode.
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

const normalizePatientRut = (rut?: string): string =>
  String(rut || '')
    .replace(/[^0-9kK]/g, '')
    .toUpperCase();

const recordMatchesPatientRut = (
  record: ClinicalDocumentPresenceRecord,
  binding: BedEpisodeBinding
): boolean => {
  const currentPatientRut = normalizePatientRut(binding.currentPatientRut);
  if (!currentPatientRut) {
    return true;
  }

  const documentRut = normalizePatientRut(record.patientRut);
  return !documentRut || documentRut === currentPatientRut;
};

// ---------------------------------------------------------------------------
// Active episode keys (boolean presence)
// ---------------------------------------------------------------------------

/**
 * Returns the set of episode keys that have at least one active
 * (non-archived) clinical-document record.
 */
export const buildActiveClinicalDocumentEpisodeKeys = (
  records: ClinicalDocumentPresenceRecord[] | undefined
): Set<string> =>
  new Set(
    (records || []).filter(record => record.status !== 'archived').map(record => record.episodeKey)
  );

/**
 * Maps each bed to a boolean indicating whether its patient has
 * at least one active clinical-document record.
 */
export const buildClinicalDocumentPresenceByBed = (
  bindings: BedEpisodeBinding[],
  activeEpisodeKeys: Set<string>,
  records?: ClinicalDocumentPresenceRecord[]
): Record<string, boolean> => {
  if (records) return buildClinicalDocumentPresenceProjection(bindings, records).byBedId;
  const result: Record<string, boolean> = {};
  bindings.forEach(b => {
    const episodeKeys = b.episodeKeys?.length ? b.episodeKeys : [b.episodeKey];
    result[b.bedId] = episodeKeys.some(episodeKey => activeEpisodeKeys.has(episodeKey));
  });

  return result;
};

// ---------------------------------------------------------------------------
// Document counts (badge display)
// ---------------------------------------------------------------------------

/**
 * Maps each bed to detailed document presence info including counts.
 * Used to populate badges in the orbital quick-action launcher.
 */
export const buildClinicalDocumentPresenceInfoByBed = (
  bindings: BedEpisodeBinding[],
  records: ClinicalDocumentPresenceRecord[] | undefined
): Record<string, ClinicalDocumentPresenceInfo> => {
  return buildClinicalDocumentPresenceProjection(bindings, records).infoByBedId;
};

/** One request-local index serves both badges; no persistent clinical cache. */
export const buildClinicalDocumentPresenceProjection = (
  bindings: BedEpisodeBinding[],
  records: ClinicalDocumentPresenceRecord[] | undefined
): {
  byBedId: Record<string, boolean>;
  infoByBedId: Record<string, ClinicalDocumentPresenceInfo>;
} => {
  const byEpisode = new Map<string, ClinicalDocumentPresenceRecord[]>();
  for (const record of records || []) {
    if (record.status === 'archived') continue;
    const entries = byEpisode.get(record.episodeKey);
    if (entries) entries.push(record);
    else byEpisode.set(record.episodeKey, [record]);
  }
  const byBedId: Record<string, boolean> = {};
  const infoByBedId: Record<string, ClinicalDocumentPresenceInfo> = {};
  for (const binding of bindings) {
    let totalCount = 0;
    let draftCount = 0;
    // Repeated aliases must not count the same source record twice.
    const keys = new Set(binding.episodeKeys?.length ? binding.episodeKeys : [binding.episodeKey]);
    for (const key of keys) {
      for (const record of byEpisode.get(key) || []) {
        if (!recordMatchesPatientRut(record, binding)) continue;
        totalCount++;
        if (record.status === 'draft') draftCount++;
      }
    }
    byBedId[binding.bedId] = totalCount > 0;
    infoByBedId[binding.bedId] = { present: totalCount > 0, totalCount, draftCount };
  }
  return { byBedId, infoByBedId };
};
