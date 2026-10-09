import type { CudyrReportDataset, CudyrReportDayCoverage } from '@/types/domain/cudyrReport';
import type { CudyrVerifiedContext } from './cudyrVerifiedContext';
import { cudyrArchiveCoverage } from './cudyrArchiveCoverage';

export interface CudyrCensusApproval {
  policyVersion: 1 | 2;
  days: Array<{ date: string; fingerprint: string }>;
  approvedAt: string;
  approvedBy: { uid: string; name: string };
  reason: string;
}

export const cudyrCensusAccepted = (day?: CudyrReportDayCoverage) =>
  day?.censusVerification?.state === 'verified' || Boolean(day?.reconstructionApproval);

// Bind the human approval to the reconstructed clinical contents, not volatile read timestamps.
export const cudyrDayFingerprint = async (data: CudyrReportDataset, date: string) => {
  const coverage = data.coverage.find(d => d.date === date);
  const day = {
    date,
    state: coverage?.state,
    censusVerification: coverage?.censusVerification,
    documentaryReconstruction: coverage?.documentaryReconstruction,
  };
  const rows = data.rows
    .filter(r => r.date === date)
    .map(r => ({
      ...r,
      ...(r.verifiedContext ? { verifiedContext: { ...r.verifiedContext, revision: 0 } } : {}),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      2,
      date,
      rows,
      day,
      data.observations,
      data.captures,
      data.corrections,
      data.dischargeAudit,
      data.exclusions || [],
    ])
  );
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

const legacyDayFingerprint = async (data: CudyrReportDataset, date: string) => {
  const rows = data.rows
    .filter(r => r.date === date)
    .map(r => [
      r.key,
      r.clinicalEpisodeId,
      r.patientName,
      r.rut,
      r.documentType,
      r.admissionDate,
      r.admissionTime,
      r.hospitalAdmissionAt || '',
      r.bedId,
      r.bedName,
      r.group,
      r.modality,
      r.eligibility,
      r.eligibilityReason,
      r.resolvedSystemDeparture || false,
      r.cudyrStatus,
      r.evaluation,
      r.exclusion || null,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const bytes = new TextEncoder().encode(JSON.stringify([1, date, rows]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

export const prepareCudyrCensusApproval = async (data: CudyrReportDataset) => {
  const month = data.from.slice(0, 7);
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0))
    .toISOString()
    .slice(0, 10);
  const days = cudyrArchiveCoverage(data, new Date());
  if (
    data.from !== month + '-01' ||
    data.to !== last ||
    data.issues.length ||
    days.some(d => d.state !== 'complete') ||
    data.coverage.length !== days.length ||
    data.coverage.some(d => d.state !== 'disponible') ||
    data.rows.some(r => r.eligibility === 'por_revisar')
  )
    throw new Error('Complete las verificaciones del mes antes de aprobar la reconstrucción.');
  return Promise.all(
    days.map(async ({ date }) => ({
      date,
      fingerprint: await cudyrDayFingerprint(data, date),
    }))
  );
};

/** Acceptance does not rewrite the census-source comparison or any clinical row. */
export const applyCudyrCensusApprovals = async (
  data: CudyrReportDataset,
  reviews: CudyrVerifiedContext[]
): Promise<CudyrReportDataset> => {
  const complete = new Set(
    cudyrArchiveCoverage(data, new Date(data.generatedAt))
      .filter(day => day.state === 'complete')
      .map(day => day.date)
  );
  const unresolved = new Set(
    data.rows.filter(row => row.eligibility === 'por_revisar').map(row => row.date)
  );
  const coverage = await Promise.all(
    data.coverage.map(async day => {
      const { reconstructionApproval: _prior, ...base } = day;
      const approval = reviews.find(r => r.month === day.date.slice(0, 7))?.censusApproval;
      const expected = approval?.days.find(d => d.date === day.date);
      if (
        data.issues.length ||
        !complete.has(day.date) ||
        unresolved.has(day.date) ||
        day.state !== 'disponible' ||
        !approval ||
        ![1, 2].includes(approval?.policyVersion || 0) ||
        !expected ||
        expected.fingerprint !==
          (await (approval?.policyVersion === 1 ? legacyDayFingerprint : cudyrDayFingerprint)(
            data,
            day.date
          ))
      )
        return base;
      return {
        ...base,
        reconstructionApproval: {
          approvedAt: approval.approvedAt,
          approvedBy: approval.approvedBy.name,
          reason: approval.reason,
        },
      };
    })
  );
  return { ...data, coverage };
};
