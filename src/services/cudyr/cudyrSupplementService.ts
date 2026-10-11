import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { CudyrSupplementReport } from '@/types/domain/cudyrSupplement';
export interface ArchivedCudyrSupplement {
  id: string;
  contentId: string;
  bytesVerified?: boolean;
  month: string;
  report: CudyrSupplementReport;
  importedAt: string;
  importedBy: { uid: string; name: string; email: string; role: string };
  verification: 'user_imported';
  capture?: { source: 'extension_monthly_report'; observedAt: string };
  file: { name: string; sha256: string; byteLength: number };
}
export const callCudyrArchive = async <T>(endpoint: string, request: unknown): Promise<T> => {
  const runtime = await defaultFunctionsRuntime.getRegionalFunctions('southamerica-east1');
  return (await httpsCallable<unknown, T>(runtime, endpoint, { timeout: 20000 })(request)).data;
};
export const importCudyrSupplement = (request: {
  operationId: string;
  capture?: { source: 'extension_monthly_report'; observedAt: string };
  file: { name: string; base64: string };
  report: CudyrSupplementReport;
}) =>
  callCudyrArchive<{ persisted: boolean; id: string; status: string; captureStored?: boolean }>(
    'archiveCudyrHistory',
    {
      ...request,
      kind: 'import-monthly-supplement',
      schemaVersion: 1,
      confirmed: true,
    }
  );
export const supplementMonths = (from: string, to: string) => {
  const months: string[] = [];
  let current = from.slice(0, 7);
  while (current <= to.slice(0, 7) && months.length < 3) {
    months.push(current);
    const [year, month] = current.split('-').map(Number);
    current = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`;
  }
  return months;
};
export const loadCudyrSupplements = async (from: string, to: string, signal: AbortSignal) => {
  const generation = getSessionGeneration(),
    owner = getStoredSessionOwnerKey();
  const check = () => {
    signal.throwIfAborted();
    if (generation !== getSessionGeneration() || owner !== getStoredSessionOwnerKey())
      throw new Error('La sesión cambió.');
  };
  const reports: ArchivedCudyrSupplement[] = [];
  for (const month of supplementMonths(from, to)) {
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      check();
      const result: { reports: ArchivedCudyrSupplement[]; nextCursor: string | null } =
        await callCudyrArchive('readCudyrHistory', {
          kind: 'monthly-supplements',
          month,
          limit: 5,
          ...(cursor ? { cursor } : {}),
        });
      check();
      reports.push(...result.reports);
      cursor = result.nextCursor;
      if (cursor && seen.has(cursor))
        throw new Error('La lectura del archivo no avanzó. Vuelva a consultar.');
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  return reports;
};
