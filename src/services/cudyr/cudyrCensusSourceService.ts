import { callCudyrArchive, supplementMonths } from './cudyrSupplementService';
import type { CudyrCensusSource, ArchivedCudyrCensus } from '@/types/domain/cudyrCensusEvidence';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
export const loadCudyrCensusSources = async (from: string, to: string, signal: AbortSignal) => {
  const generation = getSessionGeneration(),
    owner = getStoredSessionOwnerKey();
  const check = () => {
    signal.throwIfAborted();
    if (generation !== getSessionGeneration() || owner !== getStoredSessionOwnerKey())
      throw new Error('La sesión cambió.');
  };
  const result: ArchivedCudyrCensus[] = [];
  for (const month of supplementMonths(from, to)) {
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      check();
      const page: { reports: ArchivedCudyrCensus[]; nextCursor: string | null } =
        await callCudyrArchive('readCudyrHistory', {
          kind: 'daily-census-sources',
          month,
          ...(cursor ? { cursor } : {}),
        });
      check();
      result.push(...page.reports);
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('Paginación censal incompleta.');
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  return result;
};
export const saveCudyrCensusSource = (
  source: CudyrCensusSource,
  base64: string,
  observedAt: string
) =>
  callCudyrArchive<{ persisted: boolean }>('archiveCudyrHistory', {
    kind: 'import-daily-census-source',
    confirmed: true,
    source,
    base64,
    observedAt,
  });
export const readCudyrCensusFile = async (
  base64: string,
  signal: AbortSignal
): Promise<CudyrCensusSource> => {
  signal.throwIfAborted();
  const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./cudyrSupplement.worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(new Error('Consulta cancelada.'));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error('Tiempo de lectura agotado.'));
    }, 10000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => {
      finish();
      reject(new Error('No se pudo leer el censo.'));
    };
    worker.onmessage = event => {
      finish();
      if (event.data.kind === 'census' && event.data.report) resolve(event.data.report);
      else reject(new Error(event.data.error || 'Censo no reconocido.'));
    };
    worker.postMessage({ buffer, kind: 'census' }, [buffer]);
  });
};
