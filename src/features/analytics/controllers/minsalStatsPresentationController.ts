import type { MinsalStatistics } from '@/features/analytics/types/minsalTypes';

interface ResolveDisplayedMinsalStatsParams {
  localStats: MinsalStatistics | null;
  remoteStats: MinsalStatistics | null | undefined;
}

/**
 * Keeps analytics KPIs and trend cards on the same statistical source.
 * Local range stats are preferred because trend data and specialty tables are
 * built from the same synchronized record set already loaded in the client.
 */
export const resolveDisplayedMinsalStats = ({
  localStats,
  remoteStats,
}: ResolveDisplayedMinsalStatsParams): MinsalStatistics | null => {
  if (localStats) {
    return localStats;
  }

  return remoteStats ?? null;
};
