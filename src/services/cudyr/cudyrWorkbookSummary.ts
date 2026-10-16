import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import { cudyrReportTotals } from './cudyrReportModel';
import { CATEGORIES } from './cudyrWorkbookSections';
import type { CategoryCounts } from './cudyrSummary';

export const cudyrWorkbookSummary = (rows: CudyrReportRow[]) => {
  const totals = cudyrReportTotals(rows);
  // Adapter for the original workbook formula layout only. "uti" is not a classification rule.
  const counts: CategoryCounts = {
    uti: Object.fromEntries(
      CATEGORIES.map(cat => [cat, totals.categories[cat].intermedia])
    ) as CategoryCounts['uti'],
    media: Object.fromEntries(
      CATEGORIES.map(cat => [cat, totals.categories[cat].media])
    ) as CategoryCounts['media'],
  };
  return {
    counts,
    utiTotal: Object.values(counts.uti).reduce((a, b) => a + b, 0),
    mediaTotal: Object.values(counts.media).reduce((a, b) => a + b, 0),
    occupiedCount: totals.eligible,
    categorizedCount: totals.categorized,
  };
};
