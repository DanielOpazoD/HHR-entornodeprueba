import { getNextDay } from '@/utils/clinicalDayUtils';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import type { CudyrSupplementPatient } from '@/types/domain/cudyrSupplement';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { cudyrIdentity } from './cudyrSourceIdentity';

/** Compare instants, not ISO spellings: UTC and an explicit local offset may be identical. */
export const cudyrSourceAdmissionInstant = (rows: CudyrReportRow[]): number | null => {
  if (rows.some(r => r.admissionEvidenceConflict)) return null;
  const instants = new Set(
    rows.flatMap(r =>
      r.hospitalAdmissionAt
        ? [
            /(Z|[+-]\d{2}:\d{2})$/.test(r.hospitalAdmissionAt)
              ? Date.parse(r.hospitalAdmissionAt)
              : NaN,
          ]
        : []
    )
  );
  const instant = [...instants][0];
  return instants.size === 1 && Number.isFinite(instant) ? instant : null;
};

/** CMA/UEA have an episode admission even when no hospital-stay admission exists. */
export const cudyrSourceNonHospitalAdmission = (rows: CudyrReportRow[]) => {
  if (
    !rows.length ||
    rows.some(
      r =>
        r.admissionEvidenceConflict || r.hospitalAdmissionAt || !['cma', 'uea'].includes(r.modality)
    )
  )
    return null;
  const dates = new Set(rows.map(r => r.admissionDate).filter(Boolean));
  const date = [...dates][0];
  if (
    dates.size !== 1 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    // clinical-clock-allow instant-calendar-slice: date passed the YYYY-MM-DD check; this UTC round trip rejects nonexistent calendar dates.
    new Date(date).toISOString().slice(0, 10) !== date
  )
    return null;
  const times = new Set(rows.map(r => r.admissionTime).filter(Boolean));
  const time = [...times][0] || '';
  if (times.size > 1 || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return null;
  if (rows.some(r => date > getNextDay(r.date) || (date > r.date && (!time || time >= '08:00'))))
    return null;
  return { iso: date, hhmm: time };
};

/** Export-only context. Never creates monthly evidence or changes eligibility/results. */
export const resolveCudyrSourceEpisode = (
  reportId: string,
  month: string,
  patient: CudyrSupplementPatient,
  allPatients: CudyrSupplementPatient[],
  rows: CudyrReportRow[]
) => {
  const linked = rows.filter(
    r =>
      r.monthlyEvidence?.reportId === reportId && r.monthlyEvidence.sourceRow === patient.sourceRow
  );
  let candidates = linked;
  const boundary = !linked.length;
  if (boundary) {
    // A day-1-only source can belong to the preceding month, outside the selected census.
    // Require the actual day-1 departure, full identity and one source row/episode.
    const first = `${month}-01`;
    const dates = patient.days.filter(d => d.originalValue.trim()).map(d => d.sourceDate);
    if (
      !patient.document.trim() ||
      !patient.patientName.trim() ||
      !dates.length ||
      dates.some(d => d !== first)
    )
      return null;
    const identity = cudyrIdentity(patient.document, patient.patientName);
    if (allPatients.filter(p => cudyrIdentity(p.document, p.patientName) === identity).length !== 1)
      return null;
    candidates = rows.filter(r => cudyrIdentity(r.rut, r.patientName) === identity);
    const admission = cudyrSourceAdmissionInstant(candidates);
    if (
      admission === null ||
      calendarStampInClinicalTimeZone(new Date(admission)).iso >= first ||
      candidates.some(r => r.correction) ||
      candidates.some(r =>
        r.movements.some(
          m =>
            m.clinicalEpisodeId === r.clinicalEpisodeId &&
            m.source === 'gestion_camas' &&
            ['discharges', 'transfers'].includes(m.section) &&
            m.date !== first
        )
      ) ||
      !candidates.some(
        r =>
          r.resolvedSystemDeparture &&
          r.date === first &&
          r.movements.some(
            m =>
              m.clinicalEpisodeId === r.clinicalEpisodeId &&
              m.date === first &&
              m.source === 'gestion_camas' &&
              ['discharges', 'transfers'].includes(m.section)
          )
      )
    )
      return null;
  }
  const episodes = new Set(candidates.map(r => r.clinicalEpisodeId));
  if (
    !candidates.length ||
    episodes.size !== 1 ||
    episodes.has('') ||
    candidates.some(r => r.monthlyEvidence?.state === 'conflict')
  )
    return null;
  const episode = candidates[0].clinicalEpisodeId;
  if (
    rows.some(
      r =>
        r.clinicalEpisodeId === episode &&
        r.monthlyEvidence?.reportId === reportId &&
        r.monthlyEvidence.sourceRow !== patient.sourceRow
    )
  )
    return null;
  const own = rows.filter(r => r.clinicalEpisodeId === episode);
  if (
    boundary &&
    own.some(
      r =>
        cudyrIdentity(r.rut, r.patientName) !== cudyrIdentity(patient.document, patient.patientName)
    )
  )
    return null;
  return { own, episode, boundary };
};
