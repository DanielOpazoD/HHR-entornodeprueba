export const roundAnalyticsPercent = (value: number, total: number): number =>
  total > 0 ? Math.round((value / total) * 1000) / 10 : 0;

export const formatAnalyticsPercent = (value: number): string => `${value.toFixed(1)}%`;
