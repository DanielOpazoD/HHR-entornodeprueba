import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff, HistoricalRecoveryDay } from '../contracts/censusImportDiff';
import { isHistoricalCensusSyncDay } from './historicalCensusSync';
import { previousCensusDate } from './previousCensusContinuity';
import {
  hasMissingHistoricalRecoveryWork,
  isHistoricalRecoveryPartialCandidate,
} from './historicalRecoveryCompatibility';
const nextIsoDay = (day: string): string =>
  new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** A blank signed census is still closed; an occupied or previously synced day is not a gap. */
export const isHistoricalRecoveryGap = (record: DailyRecord | null): boolean =>
  !record ||
  (!record.medicalSignature &&
    !Object.values(record.medicalSignatureByScope ?? {}).some(Boolean) &&
    !record.rayenSync &&
    !record.rayenSyncHistory?.length &&
    !record.discharges.length &&
    !record.transfers.length &&
    !record.cma.length &&
    Object.values(record.beds).every(
      bed =>
        !bed.patientName?.trim() &&
        !bed.clinicalCrib?.patientName?.trim() &&
        !bed.isBlocked &&
        !bed.clinicalCrib?.isBlocked
    ));

/** Find the latest gap even when yesterday was already synchronized; bounded to seven days. */
export const findHistoricalRecoveryStart = async (
  selectedDate: string,
  port: Pick<DailyRecordRepositoryPort, 'getAuthoritativeForDate'>,
  now: Date
): Promise<string> => {
  let start = selectedDate;
  for (
    let day = previousCensusDate(selectedDate);
    isHistoricalCensusSyncDay(day, now);
    day = previousCensusDate(day)
  ) {
    const record = await port.getAuthoritativeForDate(day);
    if (record && record.date !== day)
      throw new Error('La fecha del censo histórico no corresponde.');
    if (!isHistoricalRecoveryGap(record) && !isHistoricalRecoveryPartialCandidate(record)) {
      if (start < selectedDate) break;
      continue;
    }
    start = day;
  }
  return start;
};

export const planHistoricalRecovery = async ({
  dateStart,
  selectedDate,
  port,
  buildEmpty,
  reconstruct,
  canWrite,
}: {
  dateStart: string;
  selectedDate: string;
  port: Pick<DailyRecordRepositoryPort, 'getAuthoritativeForDate' | 'getLocalForDateWithMeta'>;
  buildEmpty: (day: string) => DailyRecord;
  reconstruct: (record: DailyRecord) => Promise<CensusImportDiff>;
  canWrite: (day: string) => boolean;
}): Promise<HistoricalRecoveryDay[]> => {
  const plans: HistoricalRecoveryDay[] = [];
  // Defensive bound as evidence bundles are external input. No arbitrary historical writes.
  if (dateStart >= selectedDate) return plans;
  const span = (Date.parse(selectedDate) - Date.parse(dateStart)) / 86_400_000;
  if (!Number.isInteger(span) || span > 7) throw new Error('Intervalo de recuperación inválido.');
  for (let day = dateStart; day < selectedDate; day = nextIsoDay(day)) {
    const [record, local] = await Promise.all([
      port.getAuthoritativeForDate(day),
      port.getLocalForDateWithMeta(day),
    ]);
    if (local.hasPendingWrites || local.hasPendingWritesForDate || local.writeState !== 'none') {
      throw new Error(
        `El censo del ${day} tiene cambios locales pendientes. Resuélvelos antes de recuperar días.`
      );
    }
    if (record && record.date !== day)
      throw new Error('La fecha del censo histórico no corresponde.');
    const isGap = isHistoricalRecoveryGap(record);
    const isPartial = isHistoricalRecoveryPartialCandidate(record);
    if (!isGap && !isPartial) continue;
    // A partial record already contains deterministic movements. Reconstructing from it would
    // deduplicate the evidence and hide the still-missing structural placement.
    const diff = await reconstruct(isPartial ? buildEmpty(day) : (record ?? buildEmpty(day)));
    const plan: HistoricalRecoveryDay = {
      day,
      recordExists: !!record,
      isSigned: false,
      withinEditingWindow: canWrite(day),
      admissions: diff.admissions.filter(admission => !admission.isCma),
      reportEgresos: (diff.reportEgresos ?? []).filter(row => row.correctedDay === day),
      conflicts: [
        ...diff.conflicts,
        ...diff.admissions
          .filter(admission => admission.isCma)
          .map(admission => ({
            bedId: admission.bedId,
            rut: admission.patient.rut,
            patientName: admission.patient.patientName,
            code: 'historical-reconstruction' as const,
            reason: 'El ingreso CMA requiere revisar su disposición en el censo de esa fecha.',
          })),
      ],
    };
    if (record && isPartial && !hasMissingHistoricalRecoveryWork(record, plan)) continue;
    plans.push(plan);
  }
  return plans;
};

export const hasRecoverableHistory = (day: HistoricalRecoveryDay): boolean =>
  day.withinEditingWindow &&
  !day.isSigned &&
  (day.admissions.length > 0 || day.reportEgresos.length > 0);

/** A recovered movement/placement must not remain listed a second time as an omitted correction. */
export const removeCorrectionsCoveredByRecovery = (
  diff: CensusImportDiff,
  recovery: readonly HistoricalRecoveryDay[]
): CensusImportDiff['previousDayEdits'] =>
  diff.previousDayEdits?.filter(edit => {
    const day = recovery.find(
      candidate => candidate.day === edit.day && hasRecoverableHistory(candidate)
    );
    if (!day) return true;
    if (edit.reason === 'discharge-day-correction') {
      const episodes = new Set(day.reportEgresos.map(row => row.encounterId).filter(Boolean));
      const candidates = [
        ...diff.discharges.filter(row => row.correctedDay === edit.day).map(row => row.encounterId),
        ...(diff.reportEgresos ?? [])
          .filter(row => row.correctedDay === edit.day)
          .map(row => row.encounterId),
      ];
      return !candidates.length || !candidates.every(id => !!id && episodes.has(id));
    }
    const subjects = edit.admissionSubjects ?? [];
    return (
      !subjects.length ||
      !subjects.every(subject => {
        const admission = day.admissions.find(row => row.bedId === subject.bedId);
        const patient =
          subject.kind === 'clinical-crib' ? admission?.patient.clinicalCrib : admission?.patient;
        return (
          !!subject.clinicalEpisodeId && patient?.clinicalEpisodeId === subject.clinicalEpisodeId
        );
      })
    );
  });
