import type { CudyrComparisonItem } from '@/types/domain/cudyrReconciliation';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
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
export const buildCudyrReviewEvidence = async (
  data: CudyrReportDataset,
  items: CudyrComparisonItem[],
  sources: CudyrReviewSource[]
): Promise<Record<string, CudyrReviewEvidence>> => {
  // Conservatively invalidate the month's decisions when any observed clinical context changes.
  const content = JSON.stringify(
    canonical({
      from: data.from,
      to: data.to,
      rows: [...data.rows].sort((a, b) => a.key.localeCompare(b.key)),
      coverage: data.coverage,
      issues: data.issues,
      items: [...items].sort((a, b) => a.key.localeCompare(b.key)),
    })
  );
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  const contextHash = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(
    ''
  );
  return Object.fromEntries(
    items.map(item => [
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
    ])
  );
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
