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

const recordMatchesBinding = (
  record: ClinicalDocumentPresenceRecord,
  binding: BedEpisodeBinding
): boolean => {
  if (record.status === 'archived') {
    return false;
  }

  const episodeKeys = binding.episodeKeys?.length ? binding.episodeKeys : [binding.episodeKey];
  return episodeKeys.includes(record.episodeKey) && recordMatchesPatientRut(record, binding);
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
  const result: Record<string, boolean> = {};
  bindings.forEach(b => {
    if (records) {
      result[b.bedId] = records.some(record => recordMatchesBinding(record, b));
      return;
    }

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
  const result: Record<string, ClinicalDocumentPresenceInfo> = {};

  bindings.forEach(b => {
    const matchingRecords = (records || []).filter(record => recordMatchesBinding(record, b));
    const totalCount = matchingRecords.length;
    const draftCount = matchingRecords.filter(record => record.status === 'draft').length;
    result[b.bedId] = {
      present: totalCount > 0,
      totalCount,
      draftCount,
    };
  });

  return result;
};
