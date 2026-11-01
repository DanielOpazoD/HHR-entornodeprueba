import type { CudyrReconciliationFile } from '@/types/domain/cudyrReconciliation';
import { readInCudyrWorker } from './cudyrWorkerRead';

/** Local preview only: no upload, storage, source lookup or clinical mutation. */
export const readCudyrReconciliationFile = async (
  file: File,
  kind: CudyrReconciliationFile['kind'],
  signal: AbortSignal
): Promise<CudyrReconciliationFile> => {
  if (!/\.(xls|xlsx)$/i.test(file.name) || file.size > 262144 || file.size < 8)
    throw new Error('Seleccione un XLS/XLSX de hasta 256 KiB.');
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  signal.throwIfAborted();
  const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  return readInCudyrWorker(
    { buffer, kind },
    signal,
    'No se pudo leer el archivo.',
    (data: CudyrReconciliationFile & { error?: string }) => {
      if (data.error) throw new Error(data.error);
      return { ...data, name: file.name, sha256 };
    }
  );
};
