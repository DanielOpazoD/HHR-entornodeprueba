import type { CudyrReconciliationFile } from '@/types/domain/cudyrReconciliation';

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
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./cudyrSupplement.worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(new Error('Lectura cancelada.'));
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new Error('El archivo excedió el tiempo de lectura.'));
    }, 10000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    worker.onerror = () => {
      finish();
      reject(new Error('No se pudo leer el archivo.'));
    };
    worker.onmessage = (event: MessageEvent<CudyrReconciliationFile & { error?: string }>) => {
      finish();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve({ ...event.data, name: file.name, sha256 });
    };
    worker.postMessage({ buffer, kind }, [buffer]);
  });
};
