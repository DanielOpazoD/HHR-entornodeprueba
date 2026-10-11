import type {
  ArchiveCudyrHistoryRequest,
  ArchiveCudyrHistoryResult,
} from '@/types/domain/cudyrHistory';

export const assertCudyrArchiveAcknowledged = (
  request: ArchiveCudyrHistoryRequest,
  result: ArchiveCudyrHistoryResult
): void => {
  if (
    !result?.success ||
    !result.persisted ||
    !result.captureReceiptId ||
    result.results?.length !== request.evaluations.length
  ) {
    throw new Error('El servidor no confirmó el archivo completo de la captura CUDYR.');
  }
};
