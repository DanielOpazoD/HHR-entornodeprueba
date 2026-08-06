import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { normalizeRut } from '@/utils/rutUtils';

type ConflictEntry = CensusImportDiff['conflicts'][number];

const sameConflict = (left: ConflictEntry, right: ConflictEntry): boolean =>
  left.bedId === right.bedId &&
  normalizeRut(left.rut) === normalizeRut(right.rut) &&
  (left.patientName ?? '').trim() === (right.patientName ?? '').trim() &&
  left.scope === right.scope &&
  left.code === right.code &&
  left.reason === right.reason &&
  left.source?.encounterId === right.source?.encounterId;

export const markReportChecked = (diff: CensusImportDiff): CensusImportDiff => {
  if (diff.pendingAdministrativeDischarges.length === 0) return diff;
  return {
    ...diff,
    pendingAdministrativeDischarges: diff.pendingAdministrativeDischarges.map(entry => ({
      ...entry,
      verification: { ...entry.verification, hospitalDischarge: 'not-detected' },
    })),
  };
};

export const appendReportConflict = (
  diff: CensusImportDiff,
  conflict: CensusImportDiff['conflicts'][number]
): CensusImportDiff => {
  if (diff.conflicts.some(entry => sameConflict(entry, conflict))) return diff;
  const conflicts = [...diff.conflicts, conflict];
  return {
    ...diff,
    conflicts,
    summary: { ...diff.summary, conflicts: conflicts.length },
  };
};

/** Keeps a failed authority lookup visible and prevents the automatic path from applying the diff. */
export const markEgresoReportUnavailable = (diff: CensusImportDiff): CensusImportDiff =>
  appendReportConflict(diff, {
    bedId: null,
    reason:
      'No se pudo consultar el informe de altas administrativas de Gestión de Camas; los egresos no están verificados.',
  });
