import type { CudyrSupplementMatrix } from '@/types/domain/cudyrSupplement';
import type { ArchivedCudyrSupplement } from './cudyrSupplementService';

export interface CudyrSourceSheet {
  month: string;
  reportId?: string;
  file: ArchivedCudyrSupplement['file'];
  matrix: CudyrSupplementMatrix & {
    merges: string[];
    widths: Array<number | undefined>;
    heights: Array<number | undefined>;
    formats: Record<string, string>;
  };
}
