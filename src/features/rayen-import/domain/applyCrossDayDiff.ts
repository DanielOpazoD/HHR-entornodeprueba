/**
 * Cross-day writer for discharge-day corrections (Capability A of "conciliar contra el egreso
 * oficial"). When the official "Alta Administrativa" report puts a discharge on an EARLIER island day
 * than the census day being synced, its movement record belongs to that previous day's record — this
 * appends it there.
 *
 * Pure + idempotent: the movement id is DETERMINISTIC (`rayen-egreso:{rut}:{day}`), so re-running a
 * sync unions instead of duplicating (movements merge by id — see `mergeMovementArrayById`). It only
 * APPENDS a movement; it never touches beds on the historical day, where the patient already occupied
 * a bed. Reuses the same movement builders as `applyCensusImportDiff`, overriding the id and the time
 * (the corrected island time from the report) so the record shapes never drift.
 */

import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { DischargeData, TransferData, CMAData } from '@/types/domain/movements';
import type { DischargeEntry } from '../contracts/censusImportDiff';
import {
  buildDischarge,
  buildTransfer,
  buildCma,
  type ApplyContext,
  type ResolvedApplyContext,
} from './applyCensusImportDiff';

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

/**
 * Stable id so a re-sync merges instead of duplicating (see mergeMovementArrayById). PatientData.rut
 * defaults to '', so a blank RUT falls back to the bed — otherwise two blank-RUT discharges on the
 * same day would collapse to one id and silently drop a movement.
 */
const crossDayMovementId = (entry: DischargeEntry, day: string): string => {
  const rut = normalizeRut(entry.rut);
  return `rayen-egreso:${rut || `bed-${entry.bedId}`}:${day}`;
};

/** A patient filed on a previous day: the discharge entry + the patient snapshot (from today's bed). */
export interface CrossDayEntry {
  entry: DischargeEntry;
  patient: PatientData;
}

export interface CrossDayResult {
  record: DailyRecord;
  applied: number;
}

/**
 * Append each entry's movement record to `targetRecord` (an earlier day's record) with the corrected
 * island time and a deterministic id. Returns the next record + how many were newly appended (entries
 * already present for that day are skipped, so it is safe to re-run).
 */
export const applyCrossDayDiff = (
  targetRecord: DailyRecord,
  entries: CrossDayEntry[],
  context: ApplyContext
): CrossDayResult => {
  const ctx: ResolvedApplyContext = {
    idFactory: context.idFactory,
    now: context.now ?? new Date(),
    actor: context.actor,
    syncRunId: context.syncRunId,
  };
  const day = targetRecord.date;
  const discharges: DischargeData[] = [...targetRecord.discharges];
  const transfers: TransferData[] = [...targetRecord.transfers];
  const cma: CMAData[] = [...targetRecord.cma];
  const existing = [...discharges, ...transfers, ...cma];
  const seen = new Set(existing.map(movement => movement.id));
  // Also index by patient RUT: a discharge the nurse (or a prior path) already recorded that day has
  // a DIFFERENT id than our deterministic one, so id-only dedup would append a SECOND egreso for the
  // same patient. Skip by RUT too, so a patient already egresado that day is never double-counted.
  const seenRuts = new Set(existing.map(movement => normalizeRut(movement.rut)).filter(Boolean));
  let applied = 0;

  for (const { entry, patient } of entries) {
    const id = crossDayMovementId(entry, day);
    const rut = normalizeRut(entry.rut);
    if (seen.has(id) || (rut && seenRuts.has(rut))) continue; // already recorded (by id or by patient)
    seen.add(id);
    if (rut) seenRuts.add(rut);
    const movementContext: ResolvedApplyContext = { ...ctx, idFactory: () => id };

    if (entry.kind === 'cma') {
      const record = buildCma(patient, entry, movementContext);
      cma.push({ ...record, dischargeTime: entry.correctedTime || record.dischargeTime });
    } else if (entry.kind === 'traslado') {
      const record = buildTransfer(patient, entry, targetRecord, movementContext);
      transfers.push({ ...record, time: entry.correctedTime || record.time });
    } else {
      const record = buildDischarge(patient, entry, targetRecord, movementContext);
      discharges.push({ ...record, time: entry.correctedTime || record.time });
    }
    applied += 1;
  }

  return { record: { ...targetRecord, discharges, transfers, cma }, applied };
};
