import type { CudyrSupplementMatrix } from '@/types/domain/cudyrSupplement';
import type { ArchivedCudyrSupplement } from './cudyrSupplementService';

export interface CudyrSourceSheet {
  month: string;
  reportId?: string;
  /** Export-only aliases for the same verified source binary; never persisted to HHR. */
  equivalentReportIds?: string[];
  file: ArchivedCudyrSupplement['file'];
  matrix: CudyrSupplementMatrix & {
    merges: string[];
    widths: Array<number | undefined>;
    heights: Array<number | undefined>;
    formats: Record<string, string>;
  };
}
