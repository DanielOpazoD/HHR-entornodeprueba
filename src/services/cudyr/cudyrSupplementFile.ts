import type { CudyrSupplementParseResult } from '@/types/domain/cudyrSupplement';
export const readCudyrSupplementFile = async (file: File, signal: AbortSignal) => {
  if (!/\.(xls|xlsx)$/i.test(file.name) || file.size > 262144 || file.size < 8)
    throw new Error('Seleccione un XLS/XLSX de hasta 256 KiB.');
  const buffer = await file.arrayBuffer();
  signal.throwIfAborted();
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const result = await new Promise<CudyrSupplementParseResult>((resolve, reject) => {
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
    worker.onerror = () => {
      finish();
      reject(new Error('No se pudo iniciar la lectura del archivo.'));
    };
    worker.onmessage = (
      event: MessageEvent<{ result?: CudyrSupplementParseResult; error?: string }>
    ) => {
      finish();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error || 'Archivo no válido.'));
    };
    worker.postMessage(buffer, [buffer]);
  });
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
