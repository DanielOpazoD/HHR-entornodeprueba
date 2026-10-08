import type { SavedCudyrReview, CudyrReviewSource } from '@/types/domain/cudyrReview';
import type { CudyrReconciliationFile } from '@/types/domain/cudyrReconciliation';
import type { ArchivedCudyrSupplement } from './cudyrSupplementService';

/** A source set is explicit: never substitute a newer or similarly named file. */
export const cudyrReviewSourceSets = (records: SavedCudyrReview[], from: string, to: string) => {
  const sets = new Map<string, CudyrReviewSource[]>();
  for (const record of records) {
    if (record.evidence.from !== from || record.evidence.to !== to) continue;
    const sources = [...record.evidence.sources].sort((a, b) => a.kind.localeCompare(b.kind));
    const key = JSON.stringify(sources.map(s => [s.kind, s.sha256]));
    if (!sets.has(key)) sets.set(key, sources);
  }
  return [...sets].map(([key, sources]) => ({ key, sources }));
};
export const resolveCudyrReviewSources = (
  sources: CudyrReviewSource[],
  reports: ArchivedCudyrSupplement[],
  files: CudyrReconciliationFile[],
  month: string
) => {
  const category = sources.find(s => s.kind === 'categories');
  const archive = reports.find(r => r.month === month && r.file.sha256 === category?.sha256);
  const matching = files.filter(file =>
    sources.some(s => s.kind === file.kind && s.sha256 === file.sha256)
  );
  return {
    archiveId: archive?.id || '',
    files: matching.filter(file => !archive || file.kind !== 'categories'),
    missing: sources.filter(
      source =>
        !(source.kind === 'categories' && archive) &&
        !matching.some(file => file.kind === source.kind && file.sha256 === source.sha256)
    ),
  };
};
