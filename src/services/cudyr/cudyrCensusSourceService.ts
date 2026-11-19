import { supplementMonths } from './cudyrSupplementService';
import { callCudyrFunction } from './cudyrFunctionsCall';
import { readInCudyrWorker } from './cudyrWorkerRead';
import type { CudyrCensusSource, ArchivedCudyrCensus } from '@/types/domain/cudyrCensusEvidence';
import {
  guardAuthoringSession,
  type AuthoringSessionGuard,
} from '@/services/storage/authoringSession';
export const loadCudyrCensusSources = async (from: string, to: string, signal: AbortSignal) => {
  const guard = guardAuthoringSession({ signal });
  const result: ArchivedCudyrCensus[] = [];
  for (const month of supplementMonths(from, to)) {
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page: { reports: ArchivedCudyrCensus[]; nextCursor: string | null } =
        await callCudyrFunction(
          'readCudyrHistory',
          { kind: 'daily-census-sources', month, ...(cursor ? { cursor } : {}) },
          guard
        );
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
  observedAt: string,
  guard: AuthoringSessionGuard
) =>
  callCudyrFunction<{ persisted: boolean }>(
    'archiveCudyrHistory',
    { kind: 'import-daily-census-source', confirmed: true, source, base64, observedAt },
    guard
  );
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
