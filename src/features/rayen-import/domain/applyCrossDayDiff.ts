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
} from './applyCensusImportDiff';

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

/** Stable id so a re-sync merges instead of duplicating (see mergeMovementArrayById). */
const crossDayMovementId = (entry: DischargeEntry, day: string): string =>
  `rayen-egreso:${normalizeRut(entry.rut)}:${day}`;

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
  const ctx: Required<ApplyContext> = {
    idFactory: context.idFactory,
    now: context.now ?? new Date(),
  };
  const day = targetRecord.date;
  const discharges: DischargeData[] = [...targetRecord.discharges];
  const transfers: TransferData[] = [...targetRecord.transfers];
  const cma: CMAData[] = [...targetRecord.cma];
  const seen = new Set([...discharges, ...transfers, ...cma].map(movement => movement.id));
  let applied = 0;

  for (const { entry, patient } of entries) {
    const id = crossDayMovementId(entry, day);
    if (seen.has(id)) continue; // already filed on this day — idempotent
    seen.add(id);

    if (entry.kind === 'cma') {
      const record = buildCma(patient, entry, ctx);
      cma.push({ ...record, id, dischargeTime: entry.correctedTime || record.dischargeTime });
    } else if (entry.kind === 'traslado') {
      const record = buildTransfer(patient, entry, targetRecord, ctx);
      transfers.push({ ...record, id, time: entry.correctedTime || record.time });
    } else {
      const record = buildDischarge(patient, entry, targetRecord, ctx);
      discharges.push({ ...record, id, time: entry.correctedTime || record.time });
    }
    applied += 1;
  }

  return { record: { ...targetRecord, discharges, transfers, cma }, applied };
};
