import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import type { CudyrSourceSheet } from './cudyrSourceTypes';
import { getNextDay } from '@/utils/clinicalDayUtils';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import {
  callCudyrArchive,
  loadCudyrSupplements,
  type ArchivedCudyrSupplement,
} from './cudyrSupplementService';

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
): Promise<CudyrSourceSheet['matrix']> => {
  signal.throwIfAborted();
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
      reject(new Error('Tiempo de lectura del informe agotado.'));
    }, 10000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => {
      finish();
      reject(new Error('No se pudo leer el informe original.'));
    };
    worker.onmessage = event => {
      finish();
      if (event.data.kind === 'workbook' && event.data.matrix) resolve(event.data.matrix);
      else reject(new Error(event.data.error || 'Informe original no válido.'));
    };
    worker.postMessage({ buffer, kind: 'workbook' }, [buffer]);
  });
};

export const loadCudyrSourceSheets = async (data: CudyrReportDataset, signal: AbortSignal) => {
  const generation = getSessionGeneration(),
    owner = getStoredSessionOwnerKey();
  const check = () => {
    signal.throwIfAborted();
    if (generation !== getSessionGeneration() || owner !== getStoredSessionOwnerKey())
      throw new Error('La sesión cambió.');
  };
  check();
  const reports = await loadCudyrSupplements(data.from, getNextDay(data.to), signal);
  check();
  const selected = selectCudyrSourceReports(data, reports);
  const sources: CudyrSourceSheet[] = [];
  for (const archive of selected) {
    check();
    const file = await callCudyrArchive<ArchivedCudyrSupplement['file'] & { base64: string }>(
      'readCudyrHistory',
      { kind: 'monthly-supplement-file', id: archive.id }
    );
    check();
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
