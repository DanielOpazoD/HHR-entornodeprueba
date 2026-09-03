import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { OccupiedBedEvidence } from './egresoReportPolicy';
import { normalizeRut } from '@/utils/rutUtils';

type ConflictEntry = CensusImportDiff['conflicts'][number];

/**
 * Otro paciente (ingreso, traslado o conflicto con identidad) ya apunta a la cama
 * de la madre: la cuna no se promueve a cama principal sobre él.
 */
export const hasDifferentIncomingPrincipal = (
  diff: CensusImportDiff,
  parentBedId: string,
  reportedEpisode: string,
  run: string
): boolean =>
  diff.admissions.some(
    entry =>
      entry.bedId === parentBedId &&
      entry.source?.encounterId !== reportedEpisode &&
      normalizeRut(entry.patient.rut) !== run
  ) ||
  diff.moves.some(
    entry =>
      entry.toBedId === parentBedId &&
      entry.source.encounterId !== reportedEpisode &&
      normalizeRut(entry.rut) !== run
  ) ||
  diff.conflicts.some(
    entry =>
      entry.scope !== 'clinical-crib' &&
      entry.bedId === parentBedId &&
      entry.source?.encounterId !== reportedEpisode &&
      Boolean(normalizeRut(entry.source?.run ?? entry.rut))
  );

/**
 * Cierre seguro: el alta de un principal cuya cama tiene una cuna OCUPADA con un
 * conflicto pendiente (dos recién nacidos apuntando a la misma cama, cuna sin
 * confirmar) no se construye. Aplicarla vaciaba la cama entera y el RN quedaba
 * sin ningún movimiento (auditoría del 02-09). El conflicto lleva la cama, así
 * que aísla solo a ese paciente; se resuelve la cuna y se vuelve a sincronizar.
 */
export const cribConflictBlocksDischarge = (
  current: OccupiedBedEvidence,
  record: DailyRecord,
  conflictedCribParents: ReadonlySet<string>
): ConflictEntry | null => {
  if (!conflictedCribParents.has(current.bedId)) return null;
  const crib = record.beds[current.bedId]?.clinicalCrib;
  if (!crib?.patientName?.trim()) return null;
  return {
    bedId: current.bedId,
    code: 'crib-conflict-blocks-discharge',
    rut: current.rut ?? '',
    patientName: current.patientName,
    reason: `El alta de ${current.patientName} no se aplicó: la cuna de ${current.bedId} (${crib.patientName}) tiene un conflicto pendiente; resuélvelo y vuelve a sincronizar.`,
  };
};
