import type { CudyrReportDataset, CudyrReportRow } from '@/types/domain/cudyrReport';
import type { CudyrSupplementReport } from '@/types/domain/cudyrSupplement';
import { previousCensusIsoDay } from '@/domain/evaluationScales/importedCudyr';
import { resolveClinicalDayForDateTime } from '@/utils/clinicalDayAdmissionUtils';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';
import { cudyrDocumentKey, cudyrIdentity } from './cudyrSourceIdentity';

const sourceDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINICAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const recordedDay = (row: CudyrReportRow) => {
  const at = row.evaluation?.recordedAt;
  return at && /elo[ií]sa/i.test(row.evaluation!.source) && Number.isFinite(Date.parse(at))
    ? sourceDay.format(new Date(at))
    : '';
};

/** Links only positive cells of repeated identities in the requested period.
 * The census supplies episodes and daily context; categories never select an episode.
 * Missing census rows, blanks and eligibility are not reconstructed here.
 */
export const resolveRepeatedMonthlyEpisodes = (
  data: CudyrReportDataset,
  report: CudyrSupplementReport,
  resolveIdentity = cudyrIdentity
): Map<number, string> => {
  const links = new Map<number, string>();
  const original = data.rows.filter(r => r.contextSource !== 'eloisa_monthly_report');
  const groups = new Map<string, typeof report.patients>();
  for (const patient of report.patients) {
    const key = resolveIdentity(patient.document, patient.patientName);
    groups.set(key, [...(groups.get(key) || []), patient]);
  }
  for (const [identity, patients] of groups) {
    if (patients.length < 2 || !patients[0].document.trim()) continue;
    const document = cudyrDocumentKey(patients[0].document);
    // Shared maternal documents / conflicting identities need explicit evidence.
    if (
      original.some(
        r =>
          cudyrDocumentKey(r.rut) === document && resolveIdentity(r.rut, r.patientName) !== identity
      ) ||
      report.patients.some(
        p =>
          cudyrDocumentKey(p.document) === document &&
          resolveIdentity(p.document, p.patientName) !== identity
      )
    )
      continue;
    const own = original.filter(r => resolveIdentity(r.rut, r.patientName) === identity);
    if (!own.length || own.some(r => !r.clinicalEpisodeId || r.admissionEvidenceConflict)) continue;
    const positiveDates = patients.flatMap(p =>
      p.days.filter(d => d.category).map(d => d.sourceDate)
    );
    // Even equal categories on overlapping dates cannot prove which source row owns the stay.
    if (new Set(positiveDates).size !== positiveDates.length) continue;
    const episodes = new Map<string, CudyrReportRow[]>();
    for (const row of own)
      episodes.set(row.clinicalEpisodeId, [...(episodes.get(row.clinicalEpisodeId) || []), row]);
    const timelines = [...episodes].flatMap(([episode, rows]) => {
      if (
        original.some(
          r => r.clinicalEpisodeId === episode && resolveIdentity(r.rut, r.patientName) !== identity
        )
      )
        return [];
      const admissions = new Set(rows.map(r => `${r.admissionDate}T${r.admissionTime}`));
      const first = rows[0];
      if (
        admissions.size !== 1 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(first.admissionDate) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(first.admissionTime)
      )
        return [];
      const start = resolveClinicalDayForDateTime(first.admissionDate, first.admissionTime);
      const dates = rows.map(r => r.date).sort();
      const departures = rows
        .filter(r => r.resolvedSystemDeparture)
        .map(r => r.date)
        .sort();
      const end = departures[0] || dates[dates.length - 1];
      if (!start || start > dates[0] || end < dates[dates.length - 1]) return [];
      return [{ episode, start, end, rows }];
    });
    const proposed = new Map<number, string>();
    for (const patient of patients) {
      const dates = patient.days
        .filter(d => d.category)
        .map(cell => {
          const exact = own.filter(r => recordedDay(r) === cell.sourceDate);
          return exact.length === 1 ? exact[0].date : previousCensusIsoDay(cell.sourceDate);
        })
        .filter(date => date >= data.from && date <= data.to);
      if (!dates.length) continue;
      const candidates = timelines.filter(
        t =>
          dates.every(date => date >= t.start && date <= t.end) &&
          dates.some(date => t.rows.some(r => r.date === date))
      );
      if (candidates.length !== 1) continue;
      const candidate = candidates[0];
      // Any competing episode observed on a target day invalidates the inferred link.
      if (
        dates.some(date =>
          own.some(r => r.date === date && r.clinicalEpisodeId !== candidate.episode)
        )
      )
        continue;
      proposed.set(patient.sourceRow, candidate.episode);
    }
    for (const [row, episode] of proposed)
      if ([...proposed.values()].filter(value => value === episode).length === 1)
        links.set(row, episode);
  }
  return links;
};
