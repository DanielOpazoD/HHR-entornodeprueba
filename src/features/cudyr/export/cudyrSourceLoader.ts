import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import type { CudyrSourceSheet } from './cudyrSourceTypes';
import { getNextDay } from '@/utils/clinicalDayUtils';
import { guardAuthoringSession } from '@/services/storage/authoringSession';
import {
  loadCudyrSupplements,
  type ArchivedCudyrSupplement,
} from '@/services/cudyr/cudyrSupplementService';
import { callCudyrFunction } from '@/services/cudyr/cudyrFunctionsCall';
import { readInCudyrWorker } from '@/services/cudyr/cudyrWorkerRead';

export const selectCudyrSourceReports = (
  data: CudyrReportDataset,
  reports: ArchivedCudyrSupplement[]
) => {
  const used = new Set(
    data.rows.flatMap(row => (row.monthlyEvidence ? [row.monthlyEvidence.reportId] : []))
  );
  if ([...used].some(id => !reports.some(report => report.id === id)))
    throw new Error(
      'Falta un informe original utilizado en este período. Actualice antes de descargar.'
    );
  const month = data.from.slice(0, 7);
  const current = reports
    .filter(report => report.month === month)
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  const selected = reports.filter(report => used.has(report.id));
  if (!selected.some(report => report.month === month) && current[0]) selected.push(current[0]);
  const unique = new Map<string, ArchivedCudyrSupplement & { equivalentReportIds: string[] }>();
  for (const report of selected.sort(
    (a, b) => a.month.localeCompare(b.month) || a.importedAt.localeCompare(b.importedAt)
  )) {
    const duplicate = unique.get(report.file.sha256);
    if (duplicate) {
      if (duplicate.month !== report.month)
        throw new Error('El mes del informe de Eloísa no coincide entre copias del archivo.');
      duplicate.equivalentReportIds.push(report.id);
    } else {
      unique.set(report.file.sha256, { ...report, equivalentReportIds: [report.id] });
    }
  }
  return [...unique.values()];
};

const readSourceMatrix = (
  buffer: ArrayBuffer,
  signal: AbortSignal
): Promise<CudyrSourceSheet['matrix']> =>
  readInCudyrWorker(
    { buffer, kind: 'workbook' },
    signal,
    'No se pudo leer el informe original.',
    (data: { kind?: string; matrix?: CudyrSourceSheet['matrix']; error?: string }) => {
      if (data.kind === 'workbook' && data.matrix) return data.matrix;
      throw new Error(data.error || 'Informe original no válido.');
    }
  );

export const loadCudyrSourceSheets = async (data: CudyrReportDataset, signal: AbortSignal) => {
  const guard = guardAuthoringSession({ signal });
  const { check } = guard;
  check();
  const reports = await loadCudyrSupplements(data.from, getNextDay(data.to), signal);
  check();
  const selected = selectCudyrSourceReports(data, reports);
  const sources: CudyrSourceSheet[] = [];
  for (const archive of selected) {
    const file = await callCudyrFunction<ArchivedCudyrSupplement['file'] & { base64: string }>(
      'readCudyrHistory',
      { kind: 'monthly-supplement-file', id: archive.id },
      guard
    );
    if (
      file.sha256 !== archive.file.sha256 ||
      typeof file.base64 !== 'string' ||
      file.base64.length > 349528
    )
      throw new Error('No se pudo verificar el informe original.');
    const buffer = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0)).buffer;
    sources.push({
      month: archive.month,
      reportId: archive.id,
      equivalentReportIds: archive.equivalentReportIds,
      file,
      matrix: await readSourceMatrix(buffer, signal),
    });
  }
  check();
  return sources;
};
