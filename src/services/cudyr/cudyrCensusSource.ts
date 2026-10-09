import type { ArchivedCudyrCensus } from '@/types/domain/cudyrCensusEvidence';
import type { CudyrReportDataset, CudyrReportRow } from '@/types/domain/cudyrReport';
import { cudyrNameKey, isEloisaCudyr } from './cudyrMonthlyProjection';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { resolveClinicalDayForDateTime } from '@/utils/clinicalDayAdmissionUtils';
import { getNextDay } from '@/utils/clinicalDayUtils';

export { parseCudyrCensusSource } from './cudyrCensusParser';

const overnightAdmission = (row: CudyrReportRow, date: string) =>
  !row.admissionEvidenceConflict &&
  row.admissionDate === getNextDay(date) &&
  /^([01]\d|2[0-3]):[0-5]\d$/.test(row.admissionTime || '') &&
  resolveClinicalDayForDateTime(row.admissionDate, row.admissionTime) === date;
const activeSource = (source?: ArchivedCudyrCensus) =>
  source?.source.patients.filter(p => !p.discharged && !p.transferred && !p.deceased) || [];
const counts = (names: string[]) => {
  const result = new Map<string, number>();
  for (const name of names) result.set(name, (result.get(name) || 0) + 1);
  return result;
};

/** Compare calendar reports with HHR clinical days. No patient or episode is created by name. */
export const applyCudyrCensusEvidence = (
  data: CudyrReportDataset,
  archives: ArchivedCudyrCensus[]
): CudyrReportDataset => {
  const now = Date.parse(data.generatedAt);
  const sourcesByDate = new Map<string, ArchivedCudyrCensus[]>();
  for (const archive of archives) {
    if (!archive.source || archive.source.date !== archive.date) continue;
    if (
      ![archive.observedAt, archive.importedAt].every(
        t => Number.isFinite(Date.parse(t)) && Date.parse(t) <= now
      )
    )
      continue;
    const own = sourcesByDate.get(archive.date) || [];
    own.push(archive);
    sourcesByDate.set(archive.date, own);
  }
  for (const sources of sourcesByDate.values())
    sources.sort(
      (a, b) =>
        Date.parse(b.observedAt) - Date.parse(a.observedAt) ||
        b.importedAt.localeCompare(a.importedAt)
    );
  const sourceFor = (calendarDate: string, clinicalDate: string) =>
    sourcesByDate
      .get(calendarDate)
      ?.find(a =>
        [a.observedAt, a.importedAt].every(
          t => resolveCudyrPendingStatus(clinicalDate, new Date(t)).phase === 'overdue'
        )
      );
  const unlinkedByDay = new Map<string, number>();
  for (const row of data.rows)
    if (row.contextSource === 'eloisa_monthly_report' && row.evaluation)
      unlinkedByDay.set(row.date, (unlinkedByDay.get(row.date) || 0) + 1);
  const rowsByDay = new Map<string, CudyrReportRow[]>();
  for (const row of data.rows) {
    if (row.resolvedSystemDeparture || row.contextSource === 'eloisa_monthly_report') continue;
    const own = rowsByDay.get(row.date) || [];
    own.push(row);
    rowsByDay.set(row.date, own);
  }
  return {
    ...data,
    coverage: data.coverage.map(day => {
      const source = sourceFor(day.date, day.date);
      if (!source)
        return {
          ...day,
          censusVerification: {
            state: 'pending' as const,
            missing: 0,
            extra: 0,
            reason: 'Falta contrastar los pacientes con el censo histórico de Eloísa.',
          },
        };
      const actual = rowsByDay.get(day.date) || [];
      const unlinkedResults = unlinkedByDay.get(day.date) || 0;
      const actualCounts = counts(actual.map(r => cudyrNameKey(r.patientName)));
      const expectedCounts = counts(activeSource(source).map(p => cudyrNameKey(p.name)));
      const following = sourceFor(getNextDay(day.date), day.date);
      const nextCounts = counts(activeSource(following).map(p => cudyrNameKey(p.name)));
      let matched = 0,
        nightShiftMatched = 0,
        resultBacked = 0,
        extra = 0,
        missing = 0;
      const duplicate = [...actualCounts.values(), ...expectedCounts.values()].some(n => n > 1);
      for (const row of actual) {
        const name = cudyrNameKey(row.patientName);
        if (actualCounts.get(name) !== 1) {
          extra++;
          continue;
        }
        if (expectedCounts.get(name) === 1) {
          matched++;
          continue;
        }
        // Appearance on D+1 alone is not enough: daily admission must prove ownership of night D.
        if (
          !expectedCounts.has(name) &&
          overnightAdmission(row, day.date) &&
          nextCounts.get(name) === 1
        ) {
          nightShiftMatched++;
          continue;
        }
        // A positive source result supports this HHR patient's presence, but cannot prove that
        // the calendar census enumerates every patient (nor that a missing result was not applied).
        if (
          row.evaluation &&
          isEloisaCudyr(row.evaluation.source) &&
          row.monthlyEvidence?.state === 'found' &&
          row.clinicalEpisodeId &&
          row.rut
        ) {
          resultBacked++;
        } else extra++;
      }
      for (const [name, count] of expectedCounts) {
        if (actualCounts.get(name) === 1 && count === 1) continue;
        missing += count;
      }
      const verified =
        day.state === 'disponible' &&
        !missing &&
        !extra &&
        !duplicate &&
        !resultBacked &&
        !unlinkedResults &&
        !data.issues?.length;
      const parts = [
        ...(unlinkedResults
          ? [`${unlinkedResults} CUDYR oficiales sin asociación al censo HHR`]
          : []),
        `${matched} coincidencias del día`,
        ...(nightShiftMatched
          ? [`${nightShiftMatched} diferencias explicadas por turno nocturno`]
          : []),
        ...(resultBacked
          ? [
              `${resultBacked} casos HHR respaldados por CUDYR de Eloísa, ausentes del censo calendario`,
            ]
          : []),
        ...(missing ? [`${missing} pacientes del informe sin correspondencia en HHR`] : []),
        ...(extra ? [`${extra} casos HHR pendientes de cotejo`] : []),
        ...(duplicate ? ['nombres repetidos: asociación no concluyente'] : []),
      ];
      if (resultBacked) parts.push('El informe censal no acredita por sí solo toda la población');
      return {
        ...day,
        censusVerification: {
          state: verified ? ('verified' as const) : ('mismatch' as const),
          reportId: source.id,
          reportIds: [source.id, ...(nightShiftMatched && following ? [following.id] : [])],
          missing,
          extra,
          matched,
          nightShiftMatched,
          resultBacked,
          unlinkedResults,
          reason: parts.join(' · ') + '.',
        },
      };
    }),
  };
};
