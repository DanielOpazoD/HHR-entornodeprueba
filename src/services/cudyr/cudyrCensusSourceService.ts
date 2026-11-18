import { callCudyrArchive, supplementMonths } from './cudyrSupplementService';
import { readInCudyrWorker } from './cudyrWorkerRead';
import type { CudyrCensusSource, ArchivedCudyrCensus } from '@/types/domain/cudyrCensusEvidence';
import { guardAuthoringSession } from '@/services/storage/authoringSession';
export const loadCudyrCensusSources = async (from: string, to: string, signal: AbortSignal) => {
  const { check } = guardAuthoringSession({ signal });
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
  const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
  return readInCudyrWorker(
    { buffer, kind: 'census' },
    signal,
    'No se pudo leer el censo.',
    (data: { kind?: string; report?: CudyrCensusSource; error?: string }) => {
      if (data.kind === 'census' && data.report) return data.report;
      throw new Error(data.error || 'Censo no reconocido.');
    }
  );
};
