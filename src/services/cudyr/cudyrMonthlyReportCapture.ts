import { requestViaBridgeChannel } from '@/services/transport/extensionRequestChannel';
import { readCudyrSupplementFile } from './cudyrSupplementFile';
import { importCudyrSupplement } from './cudyrSupplementService';

type SourceReport = { month: string; base64: string; capturedAt: string };
export const fetchCudyrMonthlyReport = (month: string, signal: AbortSignal, censusDate?: string) =>
  requestViaBridgeChannel<SourceReport>({
    prefix: 'cudyr-month',
    requestType: 'HHR_RAYEN_MONTHLY_CUDYR_REPORT_REQUEST',
    resultType: 'HHR_RAYEN_MONTHLY_CUDYR_REPORT_RESULT',
    payload: { month, ...(censusDate ? { censusDate } : {}) },
    signal,
    timeoutMs: 40000,
    onTimeout: () => {
      throw new Error('La extensión no respondió. Actualícela o conecte Gestión de Camas.');
    },
    mapResult: data => {
      if (
        data.ok !== true ||
        data.month !== month ||
        (censusDate !== undefined && data.censusDate !== censusDate) ||
        typeof data.base64 !== 'string' ||
        data.base64.length > 349528 ||
        typeof data.capturedAt !== 'string' ||
        !Number.isFinite(Date.parse(data.capturedAt))
      )
        throw new Error(
          typeof data.error === 'string' ? data.error : 'Informe mensual incompleto.'
        );
      return { month, base64: data.base64, capturedAt: data.capturedAt };
    },
  });

export const cudyrMonthlyReportPorts = {
  fetchReport: fetchCudyrMonthlyReport,
  readFile: readCudyrSupplementFile,
  save: importCudyrSupplement,
};

export class CudyrMonthlyReportArchiveError extends Error {}

/** Archive the actual source bytes before using documentary categories in a census. */
export const captureCudyrMonthlyReport = async (
  month: string,
  signal: AbortSignal,
  check: () => void,
  ports = cudyrMonthlyReportPorts
) => {
  check();
  const source = await ports.fetchReport(month, signal);
  check();
  const bytes = Uint8Array.from(atob(source.base64), c => c.charCodeAt(0));
  const parsed = await ports.readFile(new File([bytes], `Categorizacion_${month}.xls`), signal);
  check();
  if (parsed.report.month !== month) throw new Error('El informe corresponde a otro mes.');
  let saved: Awaited<ReturnType<typeof ports.save>>;
  try {
    saved = await ports.save(
      {
        ...parsed,
        capture: { source: 'extension_monthly_report', observedAt: source.capturedAt },
      },
      check
    );
  } catch {
    check();
    throw new CudyrMonthlyReportArchiveError('No se pudo confirmar el respaldo documental.');
  }
  check();
  if (!saved.persisted || !saved.captureStored || !saved.id)
    throw new CudyrMonthlyReportArchiveError('El servidor no confirmó el respaldo para reanudar.');
  return { report: parsed.report, reportId: saved.id, capturedAt: source.capturedAt };
};
export type CapturedCudyrMonthlyReport = Awaited<ReturnType<typeof captureCudyrMonthlyReport>>;
