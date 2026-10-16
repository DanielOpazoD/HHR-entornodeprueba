import { isValidRut } from '@/utils/rutUtils';
import { cudyrDocumentKey, cudyrFullNameKey } from './cudyrSourceIdentity';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import type { ArchivedCudyrSupplement } from './cudyrSupplementService';
import { monthlySourceIsFinal } from './cudyrMonthlyProjection';
import { composeRayenGivenNames } from '@/utils/eloisaPersonName';
import { createCudyrIdentityResolver, cudyrMatchesCensusName } from './cudyrNameReconciliation';
import { getNextDay } from '@/utils/clinicalDayUtils';

/** Reuse an already proven source-row/episode association for its empty cells.
 * Never infer a patient, episode, stay or result from an empty cell alone.
 */
export const applyCudyrMonthlyAbsenceLinks = (
  data: CudyrReportDataset,
  sources: ArchivedCudyrSupplement[]
): CudyrReportDataset => {
  const now = new Date(data.generatedAt);
  const identity = createCudyrIdentityResolver(
    data,
    sources.map(s => s.report)
  );
  const rows = data.rows.map(row => ({ ...row, warnings: [...row.warnings] }));
  const latest = new Map<string, ArchivedCudyrSupplement>();
  for (const source of sources) {
    if (!monthlySourceIsFinal(source, data.from, now)) continue;
    const prior = latest.get(source.month);
    if (
      !prior ||
      Date.parse(source.capture!.observedAt) > Date.parse(prior.capture!.observedAt) ||
      (Date.parse(source.capture!.observedAt) === Date.parse(prior.capture!.observedAt) &&
        Date.parse(source.importedAt) > Date.parse(prior.importedAt))
    )
      latest.set(source.month, source);
  }
  for (const source of latest.values()) {
    const bindings = new Map<number, string>();
    for (const patient of source.report.patients) {
      if (!patient.document.trim()) continue;
      const positives = patient.days.filter(
        day => day.category && day.sourceDate > data.from && day.sourceDate <= getNextDay(data.to)
      );
      if (!positives.length) continue;
      const anchors = positives.map(day =>
        rows.filter(
          row =>
            row.clinicalEpisodeId &&
            row.monthlyEvidence?.reportId === source.id &&
            row.monthlyEvidence.sourceRow === patient.sourceRow &&
            row.monthlyEvidence.sourceDate === day.sourceDate &&
            row.monthlyEvidence.state === 'found' &&
            row.evaluation?.category === day.category
        )
      );
      if (anchors.some(matches => matches.length !== 1)) continue;
      const episodes = new Set(anchors.map(matches => matches[0].clinicalEpisodeId));
      if (episodes.size === 1) bindings.set(patient.sourceRow, [...episodes][0]);
    }
    for (const patient of source.report.patients) {
      const episode = bindings.get(patient.sourceRow);
      if (!episode || [...bindings.values()].filter(value => value === episode).length !== 1)
        continue;
      const id = identity(patient.document, patient.patientName);
      const own = rows.filter(row => row.clinicalEpisodeId === episode);
      if (own.some(row => identity(row.rut, row.patientName) !== id)) continue;
      for (const row of own) {
        if (row.monthlyEvidence || row.evaluation || !monthlySourceIsFinal(source, row.date, now))
          continue;
        const day = patient.days.find(cell => cell.sourceDate === getNextDay(row.date));
        if (
          !day ||
          day.state !== 'blank' ||
          day.originalValue.trim() !== '' ||
          day.category ||
          rows.filter(
            other => other.date === row.date && identity(other.rut, other.patientName) === id
          ).length !== 1
        )
          continue;
        row.monthlyEvidence = {
          reportId: source.id,
          sourceRow: patient.sourceRow,
          sourceDate: day.sourceDate,
          checkedAt: source.capture!.observedAt,
          state: 'absent',
          linkMethod: 'episode_timeline',
        };
        row.cudyrStatus = 'sin_registro_observado';
        row.warnings = row.warnings.filter(
          warning => warning !== 'Informe mensual: identidad o turno ambiguo; requiere cotejo.'
        );
      }
    }
  }
  // A complete final monthly archive contains all recorded scales. A verified census RUN
  // absent from every source identity is a true non-registration, not a failed query.
  for (const row of rows) {
    const date = getNextDay(row.date),
      source = latest.get(date.slice(0, 7));
    if (
      !source ||
      row.monthlyEvidence ||
      row.evaluation ||
      !row.clinicalEpisodeId ||
      !isValidRut(row.rut) ||
      !monthlySourceIsFinal(source, row.date, now)
    )
      continue;
    const competing = sources
      .filter(s => s.month === source.month && monthlySourceIsFinal(s, row.date, now))
      .some(s =>
        s.report.patients.some(
          p =>
            cudyrDocumentKey(p.document) === cudyrDocumentKey(row.rut) ||
            cudyrFullNameKey(composeRayenGivenNames(p.patientName)) ===
              cudyrFullNameKey(composeRayenGivenNames(row.patientName)) ||
            cudyrMatchesCensusName(p.patientName, row)
        )
      );
    if (competing) continue;
    row.monthlyEvidence = {
      reportId: source.id,
      sourceDate: date,
      checkedAt: source.capture!.observedAt,
      state: 'absent',
    };
    row.cudyrStatus = 'sin_registro_observado';
  }
  return { ...data, rows };
};
