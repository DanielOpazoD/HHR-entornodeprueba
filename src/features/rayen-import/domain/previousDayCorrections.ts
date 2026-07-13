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
import { reportEgresoEntry, reportEgresoPatient } from './applyCensusImportDiff';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type {
  CensusImportDiff,
  PreviousDayEdit,
  DischargeEntry,
} from '../contracts/censusImportDiff';

/** ~48h nurse editing window (mirrors firestore.rules isWithinEditingWindow); admin bypasses it. */
export const canWritePreviousDay = (day: string, isAdmin: boolean): boolean =>
  isAdmin || Date.now() - new Date(`${day}T00:00:00`).getTime() < 172_800_000;

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
): Promise<PreviousDayEdit[]> => {
  const days = previousDays(diff, censusDay);
  if (days.length === 0) return [];
  const records = new Map<string, DailyRecord | null>();
  await Promise.all(
    days.map(async day => {
      records.set(day, await port.getForDate(day));
    })
  );
  return planPreviousDayEdits(diff, censusDay, {
    recordExists: day => !!records.get(day),
    isSigned: day =>
      Boolean(
        (records.get(day) as { medicalSignature?: unknown } | null | undefined)?.medicalSignature
      ),
    withinEditingWindow: day => canWritePreviousDay(day, isAdmin),
  });
};

export const fileCrossDayCorrections = async (
  port: DailyRecordRepositoryPort,
  baseRecord: DailyRecord,
  diff: CensusImportDiff,
  censusDay: string,
  isAdmin: boolean,
  makeId: () => string
): Promise<void> => {
  const byDay = new Map<string, CrossDayEntry[]>();
  const add = (
    day: string | undefined,
    entry: DischargeEntry,
    patient: PatientData | undefined
  ): void => {
    if (!day || day >= censusDay || !canWritePreviousDay(day, isAdmin) || !patient) return;
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
    const next = applyCrossDayDiff(record, entries, { idFactory: makeId });
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
