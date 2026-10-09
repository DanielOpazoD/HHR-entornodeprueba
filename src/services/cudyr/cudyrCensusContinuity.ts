import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { cudyrReferenceInstant } from '@/domain/cudyr/cudyrDailyPlacement';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';

/** Fill only bounded gaps of the same episode/bed. Never copy scores or manual exclusions.
 * Admission alone does not prove continued presence; two census observations are required.
 * A missing day's population remains unapproved until documentary census reconciliation.
 */
export const applyCudyrCensusContinuity = (
  data: CudyrReportDataset,
  reconstructedDates: ReadonlySet<string> = new Set()
): CudyrReportDataset => {
  const rows = [...data.rows];
  const cutoffs = new Map<string, string | null>();
  const episodes = new Map<string, typeof rows>();
  for (const row of data.rows) {
    if (!row.clinicalEpisodeId || row.contextSource === 'eloisa_monthly_report') continue;
    episodes.set(row.clinicalEpisodeId, [...(episodes.get(row.clinicalEpisodeId) || []), row]);
  }
  for (const [episode, own] of episodes) {
    const sorted = [...own].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < sorted.length; i++) {
      const before = sorted[i - 1],
        after = sorted[i];
      const gap = (Date.parse(after.date) - Date.parse(before.date)) / 86400000;
      if (
        gap < 2 ||
        gap > 7 ||
        before.resolvedSystemDeparture ||
        after.resolvedSystemDeparture ||
        before.exclusion ||
        after.exclusion ||
        before.eligibility === 'por_revisar' ||
        after.eligibility === 'por_revisar' ||
        before.correction?.actualDischarge ||
        after.correction?.actualDischarge ||
        before.admissionEvidenceConflict ||
        after.admissionEvidenceConflict ||
        before.rut !== after.rut ||
        before.bedId.replace(/\s/g, '').toUpperCase() !==
          after.bedId.replace(/\s/g, '').toUpperCase() ||
        before.modality !== after.modality ||
        before.group !== after.group ||
        before.modality !== 'hospitalizacion' ||
        !before.hospitalStayAdmissionAt ||
        before.hospitalStayAdmissionAt !== after.hospitalStayAdmissionAt
      )
        continue;
      for (let offset = 1; offset < gap; offset++) {
        const date = new Date(Date.parse(before.date) + offset * 86400000)
          .toISOString()
          .slice(0, 10);
        if (
          (!reconstructedDates.has(date) &&
            data.coverage.find(day => day.date === date)?.state !== 'sin_censo') ||
          date < data.from ||
          date > data.to ||
          rows.some(r => r.date === date && r.clinicalEpisodeId === episode) ||
          resolveCudyrPendingStatus(date, new Date(data.generatedAt)).phase !== 'overdue' ||
          data.exclusions?.some(e => e.date === date && e.clinicalEpisodeId === episode)
        )
          continue;
        if (!cutoffs.has(date)) cutoffs.set(date, cudyrReferenceInstant(date));
        const referenceAt = cutoffs.get(date);
        if (
          !referenceAt ||
          Date.parse(referenceAt) - Date.parse(before.hospitalStayAdmissionAt) < 8 * 3600000
        )
          continue;
        rows.push({
          ...before,
          key: `${date}:${episode}:continuity`,
          date,
          authorityDate: before.date,
          contextSource: 'hhr_census_continuity',
          referenceAt,
          eligibility: 'elegible',
          eligibilityReason:
            'Estadía continua respaldada por censos anteriores y posteriores del mismo episodio y cama.',
          evaluation: null,
          evaluationCount: 0,
          evaluationCapturedAt: undefined,
          monthlyEvidence: undefined,
          verifiedContext: undefined,
          exclusion: undefined,
          cudyrStatus: 'sin_captura',
          captureId: '',
          captureActor: '',
          sourceRunId: '',
          lastCaptureAt: '',
          lastPersistedAt: '',
          dailyCudyrSavedAt: '',
          dailyCudyrSavedBy: '',
          movements: [],
          resolvedSystemDeparture: false,
          applicationPending: false,
          warnings: [
            `Contexto recuperado entre los censos ${before.date} y ${after.date}; no se copia el CUDYR.`,
          ],
        });
      }
    }
  }
  return { ...data, rows };
};
