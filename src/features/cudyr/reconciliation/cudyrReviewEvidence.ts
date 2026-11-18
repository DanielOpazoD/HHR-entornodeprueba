import type { CudyrComparisonItem } from '@/types/domain/cudyrReconciliation';
import type { CudyrReportRow, CudyrReportDataset } from '@/types/domain/cudyrReport';
import type {
  CudyrReviewEvidence,
  CudyrReviewSource,
  SavedCudyrReview,
} from '@/types/domain/cudyrReview';

// Stable property ordering: refresh timestamps are excluded, clinically relevant context is not.
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)])
    );
  return value;
};
const documentKey = (value: string) => value.replace(/[.\s-]/g, '').toUpperCase();

// Recapturing the same clinical evidence must not invalidate a human decision.
// Keep source application dates, authors, daily eligibility and discharge corrections.
const clinicalContext = (row: CudyrReportRow) => {
  const context = { ...row };
  for (const key of [
    'lastCaptureAt',
    'lastPersistedAt',
    'captureActor',
    'captureId',
    'sourceRunId',
    'dailyCudyrSavedAt',
    'dailyCudyrSavedBy',
  ] as const)
    delete (context as Partial<CudyrReportRow>)[key];
  return context;
};

export const buildCudyrReviewEvidence = async (
  data: CudyrReportDataset,
  items: CudyrComparisonItem[],
  sources: CudyrReviewSource[]
): Promise<Record<string, CudyrReviewEvidence>> => {
  const entries = await Promise.all(
    items.map(async item => {
      const document = documentKey(item.document);
      const candidates = new Set(item.candidateKeys);
      const direct = data.rows.filter(
        row => candidates.has(row.key) || (document && documentKey(row.rut) === document)
      );
      // Include the whole matching episode, even a contradictory document on another day.
      // A shared RN identifier or new admission must continue to trigger a review.
      const episodes = new Set(direct.map(row => row.clinicalEpisodeId).filter(Boolean));
      const rows = data.rows.filter(
        row =>
          direct.includes(row) || (row.clinicalEpisodeId && episodes.has(row.clinicalEpisodeId))
      );
      const content = JSON.stringify(
        canonical({
          scope: 'case-v1',
          from: data.from,
          to: data.to,
          rows: rows.map(clinicalContext).sort((a, b) => a.key.localeCompare(b.key)),
          // An incomplete month may hide another admission. Keep coverage states, not sync clocks.
          coverage: data.coverage
            .map(({ date, state }) => ({ date, state }))
            .sort((a, b) => a.date.localeCompare(b.date)),
          issues: [...data.issues].sort(),
          items: items
            .filter(
              other =>
                other.key === item.key || (document && documentKey(other.document) === document)
            )
            .map(other => ({ ...other, candidateKeys: [...other.candidateKeys].sort() }))
            .sort((a, b) => a.key.localeCompare(b.key)),
        })
      );
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
      const contextHash = Array.from(new Uint8Array(bytes), b =>
        b.toString(16).padStart(2, '0')
      ).join('');
      return [
        item.key,
        {
          sources: [...sources].sort((a, b) => a.kind.localeCompare(b.kind)),
          from: data.from,
          to: data.to,
          contextHash,
          patientName: item.patientName,
          document: item.document,
          sourceDate: item.sourceDate,
          sourceValue: item.sourceValue,
        },
      ] as const;
    })
  );
  return Object.fromEntries(entries);
};
export const isCurrentCudyrReview = (review: SavedCudyrReview, evidence?: CudyrReviewEvidence) =>
  Boolean(
    evidence &&
    review.evidence.contextHash === evidence.contextHash &&
    review.evidence.from === evidence.from &&
    review.evidence.to === evidence.to &&
    JSON.stringify(review.evidence.sources.map(s => [s.kind, s.sha256])) ===
      JSON.stringify(evidence.sources.map(s => [s.kind, s.sha256]))
  );
