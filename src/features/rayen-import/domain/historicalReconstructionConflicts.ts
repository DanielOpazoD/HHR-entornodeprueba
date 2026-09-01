import { normalizeRut } from '@/utils/rutUtils';
import type { ConflictEntry } from '../contracts/censusImportDiff';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import {
  composeRayenGivenNames,
  normalizeOptionalPersonName,
  toTitleCaseName,
} from '../mapping/rayenToPatientData';

// Mismo criterio de nombre que el mapeo del censo: sin él, una entrada de
// conflicto mostraba el relleno y los marcadores administrativos de Rayen
// («Jorge  Urgencias Aroca») mientras el censo ya mostraba el nombre limpio.
const encounterPatientName = (encounter: RayenEncounter): string =>
  [
    composeRayenGivenNames(encounter.firstGivenName, encounter.nextGivenNames),
    toTitleCaseName(encounter.firstFamilyName),
    normalizeOptionalPersonName(encounter.secondFamilyName),
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

export const historicalReconstructionConflict = (
  encounter: RayenEncounter,
  reason: string
): ConflictEntry => {
  const patientName = encounterPatientName(encounter);
  return {
    bedId: null,
    rut: encounter.run,
    patientName,
    code: 'historical-reconstruction',
    reason: `No se reconstruyó ${patientName || 'un episodio'} para la fecha solicitada: ${reason}`,
    source: encounter,
  };
};

const conflictKey = (conflict: ConflictEntry): string =>
  normalizeRut(conflict.rut) ||
  String(conflict.source?.encounterId ?? '').trim() ||
  (conflict.patientName ?? '').trim().toLocaleUpperCase('es-CL');

/** Keep one actionable review item per patient when two incomplete sources describe the same case. */
export const deduplicateHistoricalConflicts = (conflicts: ConflictEntry[]): ConflictEntry[] => {
  const unique = new Map<string, ConflictEntry>();
  for (const conflict of conflicts) {
    const key = conflictKey(conflict);
    if (!key) continue;
    const previous = unique.get(key);
    const previousHasEpisode = /^\d+$/.test(previous?.source?.encounterId ?? '');
    const currentHasEpisode = /^\d+$/.test(conflict.source?.encounterId ?? '');
    if (!previous || (!previousHasEpisode && currentHasEpisode)) unique.set(key, conflict);
  }
  return [...unique.values()];
};
