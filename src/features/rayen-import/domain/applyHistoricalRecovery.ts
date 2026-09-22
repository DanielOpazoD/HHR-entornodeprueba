import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { HistoricalRecoveryDay } from '../contracts/censusImportDiff';
import { hasRecoverableHistory } from './historicalRecovery';
import { applyHistoricalAdmissions } from './previousDayAdmissionCorrections';
import { applyCrossDayDiff } from './applyCrossDayDiff';
import { reportEgresoEntry, reportEgresoPatient } from './applyCensusImportDiff';
import { buildHistoricalAdmissionPatch } from './historicalAdmissionPatch';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  assertHistoricalRecoveryCompatible,
  historicalRecoveryActiveExtraBeds,
  historicalRecoveryAdmissionSubjects,
} from './historicalRecoveryCompatibility';
export { assertHistoricalRecoveryCompatible } from './historicalRecoveryCompatibility';

/** Sequential, resumable and authority-first; no clinical observation is invented for a past day. */
export const applyHistoricalRecoveryDays = async (
  port: DailyRecordRepositoryPort,
  plans: readonly HistoricalRecoveryDay[],
  selectedDate: string,
  canWrite: (day: string) => boolean,
  provenance: { actor?: string; syncRunId: string }
): Promise<number> => {
  const actionable = plans.filter(hasRecoverableHistory).sort((a, b) => a.day.localeCompare(b.day));
  // Validate all existing dates before the first creation/write.
  for (const plan of actionable) {
    const distance = (Date.parse(selectedDate) - Date.parse(plan.day)) / 86_400_000;
    if (!Number.isInteger(distance) || distance < 1 || distance > 7 || !canWrite(plan.day)) {
      throw new Error('La recuperación quedó fuera de la ventana de edición. Vuelve a revisarla.');
    }
    const current = await port.getAuthoritativeForDate(plan.day);
    if (current) assertHistoricalRecoveryCompatible(current, plan);
  }
  let confirmed = 0;
  for (const plan of actionable) {
    const local = await port.getLocalForDateWithMeta(plan.day);
    if (local.hasPendingWrites || local.hasPendingWritesForDate || local.writeState !== 'none') {
      throw new Error(`Hay cambios locales pendientes en ${plan.day}; la recuperación se detuvo.`);
    }
    let record = await port.getAuthoritativeForDate(plan.day);
    if (!record) {
      await port.initializeDay(plan.day); // Empty seed; never copy today's occupancy or observations.
      record = await port.getAuthoritativeForDate(plan.day);
      if (!record) throw new Error(`No se confirmó la creación del censo del ${plan.day}.`);
    }
    assertHistoricalRecoveryCompatible(record, plan);
    // Movements are separated from bed patches by the existing server authority contract.
    const movement = applyCrossDayDiff(
      record,
      plan.reportEgresos.map(row => ({
        entry: reportEgresoEntry(row),
        patient: reportEgresoPatient(row),
        isNested: row.fromClinicalCrib === true,
      })),
      { ...provenance, idFactory: () => crypto.randomUUID() }
    );
    const save = async (patch: Parameters<typeof port.updatePartialDetailed>[1]) => {
      const result = await port.updatePartialDetailed(plan.day, patch, {
        baseRecord: record!,
        requireAtomicCas: true,
        requireConfirmedRecord: true,
        requireRemoteAuthorityFirst: true,
      });
      if (
        isDailyRecordWriteRejectedResult(result) ||
        !result.updatedRemotely ||
        !result.confirmedRecord
      ) {
        throw result.blockingError ?? new Error(`No se confirmó la recuperación del ${plan.day}.`);
      }
      record = result.confirmedRecord;
      assertHistoricalRecoveryCompatible(record, plan);
    };
    if (movement.applied)
      await save({
        discharges: movement.record.discharges,
        transfers: movement.record.transfers,
        cma: movement.record.cma,
      });
    const admissions = applyHistoricalAdmissions(record, historicalRecoveryAdmissionSubjects(plan));
    if (admissions.omitted.length)
      throw new Error(`Cambió una cama del ${plan.day}; vuelve a revisar.`);
    const patch = Object.fromEntries(
      Object.entries(buildHistoricalAdmissionPatch(record, admissions.record)).filter(
        ([path, value]) => {
          const current = path
            .split('.')
            .reduce<unknown>(
              (node, key) =>
                node && typeof node === 'object'
                  ? (node as Record<string, unknown>)[key]
                  : undefined,
              record
            );
          return JSON.stringify(current) !== JSON.stringify(value);
        }
      )
    );
    const activeExtraBeds = historicalRecoveryActiveExtraBeds(admissions.record);
    if (activeExtraBeds.length !== (record.activeExtraBeds ?? []).length) {
      patch.activeExtraBeds = activeExtraBeds;
    }
    if (Object.keys(patch).length) {
      await save(patch as Parameters<typeof port.updatePartialDetailed>[1]);
    }
    confirmed += 1;
  }
  return confirmed;
};
