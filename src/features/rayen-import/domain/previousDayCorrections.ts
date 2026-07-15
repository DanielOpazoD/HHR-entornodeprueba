/**
 * Previous-day discharge corrections (Capability A of "conciliar contra el egreso oficial"), extracted
 * from the sync hook so the hook stays lean. A discharge whose official island day (`correctedDay`) is
 * earlier than the census day being synced belongs to that previous day's record:
 *   - `computePreviousDayEdits` lists the affected days (with existence / signed / editing-window
 *     flags) for the confirmation shown in the preview, and
 *   - `fileCrossDayCorrections` writes each movement onto its real day via a granular patch.
 * Both stay within the Firestore ~48h nurse editing window (admin bypasses), and only run after the
 * user's explicit acknowledgment in the preview.
 */

import { planPreviousDayEdits } from './planPreviousDayEdits';
import { applyCrossDayDiff, type CrossDayEntry } from './applyCrossDayDiff';
import { isOccupied, reportEgresoEntry, reportEgresoPatient } from './applyCensusImportDiff';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type {
  CensusImportDiff,
  PreviousDayEdit,
  DischargeEntry,
} from '../contracts/censusImportDiff';
import type { ReportEgreso } from '../contracts/egresoReport';

/** ~48h nurse editing window (mirrors firestore.rules isWithinEditingWindow); admin bypasses it. */
export const canWritePreviousDay = (day: string, isAdmin: boolean): boolean =>
  isAdmin || Date.now() - new Date(`${day}T00:00:00`).getTime() < 172_800_000;

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

/** True when `record` already carries an egreso (discharge/transfer/cma) for `rut` (RUT-verified). */
const recordHasEgresoForRut = (record: DailyRecord | null | undefined, rut: string): boolean => {
  const norm = normalizeRut(rut);
  if (!record || !norm) return false;
  const movements = [...record.discharges, ...record.transfers, ...record.cma];
  return movements.some(movement => normalizeRut(movement.rut) === norm);
};

/** Result of planning the previous-day corrections: the affected days + the report egresos that
 * still need to be filed (ones already consigned on their real day are dropped so the preview
 * doesn't nag about an egreso that is already there). */
export interface PreviousDayPlan {
  edits: PreviousDayEdit[];
  reportEgresos: ReportEgreso[];
}

const previousDays = (diff: CensusImportDiff, censusDay: string): string[] => [
  ...new Set(
    [...diff.discharges, ...(diff.reportEgresos ?? [])]
      .map(entry => entry.correctedDay)
      .filter((day): day is string => !!day && day < censusDay)
  ),
];

export const computePreviousDayEdits = async (
  port: DailyRecordRepositoryPort,
  diff: CensusImportDiff,
  censusDay: string,
  isAdmin: boolean
): Promise<PreviousDayPlan> => {
  const reportEgresos = diff.reportEgresos ?? [];
  const days = previousDays(diff, censusDay);
  if (days.length === 0) return { edits: [], reportEgresos };
  const records = new Map<string, DailyRecord | null>();
  await Promise.all(
    days.map(async day => {
      records.set(day, await port.getForDate(day));
    })
  );
  const alreadyDischarged = (day: string, rut: string): boolean =>
    recordHasEgresoForRut(records.get(day), rut);

  const edits = planPreviousDayEdits(diff, censusDay, {
    recordExists: day => !!records.get(day),
    isSigned: day =>
      Boolean(
        (records.get(day) as { medicalSignature?: unknown } | null | undefined)?.medicalSignature
      ),
    withinEditingWindow: day => canWritePreviousDay(day, isAdmin),
    alreadyDischarged,
  });

  // Drop a report egreso whose real (earlier) island day already holds it — the preview must not
  // list an egreso that is already consigned there ("falta el egreso de X" would be wrong).
  const cleanedReportEgresos = reportEgresos.filter(
    egreso =>
      !(
        egreso.correctedDay &&
        egreso.correctedDay < censusDay &&
        alreadyDischarged(egreso.correctedDay, egreso.run)
      )
  );

  return { edits, reportEgresos: cleanedReportEgresos };
};

export const fileCrossDayCorrections = async (
  port: DailyRecordRepositoryPort,
  baseRecord: DailyRecord,
  diff: CensusImportDiff,
  censusDay: string,
  isAdmin: boolean,
  makeId: () => string,
  provenance?: { actor?: string; syncRunId?: string }
): Promise<void> => {
  const byDay = new Map<string, CrossDayEntry[]>();
  const add = (
    day: string | undefined,
    entry: DischargeEntry,
    patient: PatientData | undefined
  ): void => {
    // isOccupied (not just `patient != null`): mirror the primary discharge loop so a blocked or
    // nameless bed is never filed to the historical day with garbage data.
    if (!day || day >= censusDay || !canWritePreviousDay(day, isAdmin) || !isOccupied(patient))
      return;
    const list = byDay.get(day) ?? [];
    list.push({ entry, patient });
    byDay.set(day, list);
  };
  // Bed-occupying discharges: the patient snapshot comes from today's bed.
  for (const entry of diff.discharges) add(entry.correctedDay, entry, baseRecord.beds[entry.bedId]);
  // Report egresos (unknown RUN, never in a bed): synthesize the entry + patient from the report row.
  for (const egreso of diff.reportEgresos ?? []) {
    add(
      egreso.correctedDay,
      {
        ...reportEgresoEntry(egreso),
        correctedDay: egreso.correctedDay,
        correctedTime: egreso.correctedTime,
      },
      reportEgresoPatient(egreso)
    );
  }
  for (const [day, entries] of byDay) {
    const record = await port.getForDate(day);
    if (!record) continue;
    const next = applyCrossDayDiff(record, entries, {
      idFactory: makeId,
      actor: provenance?.actor,
      syncRunId: provenance?.syncRunId,
    });
    if (next.applied === 0) continue;
    await patchDailyRecordWithCompatibility(
      port,
      day,
      {
        discharges: next.record.discharges,
        transfers: next.record.transfers,
        cma: next.record.cma,
      },
      { baseRecord: record }
    );
  }
};
