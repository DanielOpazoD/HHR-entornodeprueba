import { cudyrApplicationSourceDate } from './cudyrMonthlyProjection';
import { createCudyrIdentityResolver } from './cudyrNameReconciliation';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import type { ArchivedCudyrSupplement } from './cudyrSupplementService';
import { compareCudyrMonth } from './cudyrMonthlyComparison';
import { getNextDay } from '@/utils/clinicalDayUtils';

export interface CudyrMonthlyCheck {
  key: string;
  patientName: string;
  date: string;
  result: string;
  state: 'found' | 'empty' | 'incomplete';
  detail: string;
  needsReview: boolean;
}
/** Results are source statements, not new clinical observations or changes to eligibility. */
export const verifyCudyrMonthlySources = (
  data: CudyrReportDataset,
  sources: ArchivedCudyrSupplement[]
) => {
  const identity = createCudyrIdentityResolver(
    data,
    sources.map(s => s.report)
  );
  const nextDay = getNextDay(data.to);
  const checks: CudyrMonthlyCheck[] = [];
  for (const archive of sources) {
    const report = archive.report;
    const comparison = compareCudyrMonth(data, report, undefined, identity);
    for (const patient of report.patients) {
      const own = data.rows.filter(
        r =>
          identity(r.rut, r.patientName) === identity(patient.document, patient.patientName) ||
          Boolean(
            r.verifiedContext &&
            r.monthlyEvidence?.reportId === archive.id &&
            r.monthlyEvidence.sourceRow === patient.sourceRow
          )
      );
      for (const day of patient.days) {
        // The next report is retained whole; only day 1 participates in this month's boundary check.
        if (
          !(day.sourceDate > data.from && day.sourceDate <= nextDay) &&
          !own.some(r => cudyrApplicationSourceDate(r.evaluation?.recordedAt) === day.sourceDate)
        )
          continue;
        const match = comparison.find(
          c => c.key === `category:${patient.sourceRow}:${day.sourceDay}`
        );
        const linked = own.find(
          r =>
            r.monthlyEvidence?.reportId === archive.id &&
            r.monthlyEvidence.sourceDate === day.sourceDate &&
            (r.monthlyEvidence.sourceRow === undefined ||
              r.monthlyEvidence.sourceRow === patient.sourceRow) &&
            r.monthlyEvidence.state === 'found' &&
            r.clinicalEpisodeId
        );
        if (day.category) {
          checks.push({
            key: `${archive.id}:${patient.sourceRow}:${day.sourceDay}`,
            patientName: patient.patientName,
            date: day.sourceDate,
            result: day.category,
            state: 'found',
            needsReview: !linked && match?.status !== 'compatible',
            detail:
              linked || match?.status === 'compatible'
                ? 'Coincidencia con HHR; se conserva su turno.'
                : 'Categoría recuperada del informe; episodio o turno por cotejar.',
          });
          continue;
        }
        // Do not count blank cells outside the observed stay. No inferred episode from shared RN RUTs.
        const context = own.filter(
          r =>
            (getNextDay(r.date) === day.sourceDate && !r.monthlyEvidence) ||
            (r.monthlyEvidence?.reportId === archive.id &&
              r.monthlyEvidence.sourceDate === day.sourceDate &&
              r.monthlyEvidence.sourceRow === patient.sourceRow)
        );
        if (!context.length) continue;
        const shared = data.rows.some(
          r =>
            r.rut.replace(/[.\s-]/g, '').toUpperCase() ===
              patient.document.replace(/[.\s-]/g, '').toUpperCase() &&
            identity(r.rut, r.patientName) !== identity(patient.document, patient.patientName)
        );
        const duplicated =
          report.patients.filter(
            p =>
              identity(p.document, p.patientName) ===
              identity(patient.document, patient.patientName)
          ).length > 1;
        const reviewedLink =
          context.length === 1 &&
          (context[0].verifiedContext ||
            context[0].monthlyEvidence?.linkMethod === 'episode_timeline') &&
          context[0].monthlyEvidence?.state === 'absent';
        const ambiguous =
          !reviewedLink &&
          (context.some(r => r.monthlyEvidence?.state === 'conflict') ||
            !patient.document ||
            new Set(context.map(r => r.clinicalEpisodeId).filter(Boolean)).size !== 1 ||
            context.some(r => !r.clinicalEpisodeId) ||
            shared ||
            duplicated);
        checks.push({
          key: `${archive.id}:${patient.sourceRow}:${day.sourceDay}`,
          patientName: patient.patientName,
          date: day.sourceDate,
          result: day.originalValue || '—',
          state: ambiguous ? 'incomplete' : 'empty',
          needsReview: ambiguous,
          detail: ambiguous
            ? 'Identidad o episodio sin resolver.'
            : 'No registrado para esta celda consultada; la elegibilidad determina si cuenta en el cumplimiento.',
        });
      }
    }
  }
  // Include census patients absent from the report: absence of the whole patient is not a negative cell.
  for (const row of data.rows) {
    if (
      row.monthlyEvidence &&
      row.monthlyEvidence.state !== 'conflict' &&
      sources.some(s => s.id === row.monthlyEvidence?.reportId)
    )
      continue;
    if (
      sources.some(
        s =>
          s.report.month ===
            (cudyrApplicationSourceDate(row.evaluation?.recordedAt) || getNextDay(row.date)).slice(
              0,
              7
            ) &&
          s.report.patients.some(
            p =>
              identity(p.document, p.patientName) === identity(row.rut, row.patientName) &&
              p.days.some(
                d =>
                  d.sourceDate ===
                  (cudyrApplicationSourceDate(row.evaluation?.recordedAt) || getNextDay(row.date))
              )
          )
      )
    )
      continue;
    checks.push({
      key: `hhr:${row.key}`,
      patientName: row.patientName,
      date: row.date,
      result: row.evaluation?.category || '—',
      state: 'incomplete',
      needsReview: true,
      detail:
        'Sin fila identificada en el informe mensual. Se conserva el resultado HHR y su elegibilidad.',
    });
  }
  return {
    checks,
    censusVerified: data.coverage.filter(d => d.censusVerification?.state === 'verified').length,
    daysAvailable: data.coverage.filter(d => d.state === 'disponible').length,
    expectedDays: Number(data.to.slice(8)),
    censusIncomplete:
      data.issues.length > 0 ||
      new Set(data.coverage.filter(d => d.state === 'disponible').map(d => d.date)).size !==
        Number(data.to.slice(8)),
    unresolved: checks.filter(c => c.needsReview).length,
  };
};
