import type { CudyrSupplementParseResult } from '@/types/domain/cudyrSupplement';
import { readInCudyrWorker } from './cudyrWorkerRead';

export const readCudyrSupplementFile = async (file: File, signal: AbortSignal) => {
  if (!/\.(xls|xlsx)$/i.test(file.name) || file.size > 262144 || file.size < 8)
    throw new Error('Seleccione un XLS/XLSX de hasta 256 KiB.');
  const buffer = await file.arrayBuffer();
  signal.throwIfAborted();
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const result = await readInCudyrWorker(
    buffer,
    signal,
    'No se pudo iniciar la lectura del archivo.',
    (data: { result?: CudyrSupplementParseResult; error?: string }) => {
      if (data.result) return data.result;
      throw new Error(data.error || 'Archivo no válido.');
    }
  );
  if (!result.ok)
    throw new Error(
      result.issues
        .slice(0, 3)
        .map(i => `Fila ${i.row}: ${i.message}`)
        .join(' ')
    );
  return {
    report: result.report,
    file: { name: file.name, base64 },
    operationId: crypto.randomUUID(),
  };
};
