import {
  guardAuthoringSession,
  type AuthoringSessionGuard,
} from '@/services/storage/authoringSession';
import { callCudyrFunction } from './cudyrFunctionsCall';
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
export const importCudyrSupplement = (
  request: {
    operationId: string;
    capture?: { source: 'extension_monthly_report'; observedAt: string };
    file: { name: string; base64: string };
    report: CudyrSupplementReport;
  },
  guard: AuthoringSessionGuard
) =>
  callCudyrFunction<{ persisted: boolean; id: string; status: string; captureStored?: boolean }>(
    'archiveCudyrHistory',
    {
      ...request,
      kind: 'import-monthly-supplement',
      schemaVersion: 1,
      confirmed: true,
    },
    guard
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
  const guard = guardAuthoringSession({ signal });
  const reports: ArchivedCudyrSupplement[] = [];
  for (const month of supplementMonths(from, to)) {
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const result: { reports: ArchivedCudyrSupplement[]; nextCursor: string | null } =
        await callCudyrFunction(
          'readCudyrHistory',
          { kind: 'monthly-supplements', month, limit: 5, ...(cursor ? { cursor } : {}) },
          guard
        );
      reports.push(...result.reports);
      cursor = result.nextCursor;
      if (cursor && seen.has(cursor))
        throw new Error('La lectura del archivo no avanzó. Vuelva a consultar.');
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  return reports;
};
