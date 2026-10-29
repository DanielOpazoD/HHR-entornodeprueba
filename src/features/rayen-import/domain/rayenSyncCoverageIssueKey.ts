import type { RayenSyncCoverageIssue } from '@/types/domain/rayenSync';

export const rayenSyncCoverageIssueKey = (
  { bedId, source, reason, cudyrRecovery }: RayenSyncCoverageIssue,
  episodeId?: string
): string =>
  JSON.stringify([
    bedId,
    episodeId ?? '',
    source,
    reason,
    cudyrRecovery?.targetDate,
    cudyrRecovery?.kind,
  ]);
