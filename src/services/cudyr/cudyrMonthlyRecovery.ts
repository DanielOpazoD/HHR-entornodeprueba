import { loadCudyrReport } from './cudyrReportLoader';
import { verifyCudyrMonthlySources } from './cudyrMonthlyVerification';
import {
  loadCudyrCensusSources,
  saveCudyrCensusSource,
  readCudyrCensusFile,
} from './cudyrCensusSourceService';
import { getNextDay } from '@/utils/clinicalDayUtils';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { requestViaBridgeChannel } from '@/services/transport/extensionRequestChannel';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { readCudyrSupplementFile } from './cudyrSupplementFile';
import {
  importCudyrSupplement,
  loadCudyrSupplements,
  type ArchivedCudyrSupplement,
} from './cudyrSupplementService';

export const monthlyRecoveryPeriod = (month: string) => {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Mes inválido.');
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10);
  return { month, from: `${month}-01`, last, next, reportMonths: [month, next.slice(0, 7)] };
};

type SourceReport = { month: string; base64: string; capturedAt: string };
const fetchReport = (month: string, signal: AbortSignal, censusDate?: string) =>
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

export interface MonthlyRecoveryProgress {
  reportMonth: string;
  status: 'reading' | 'reused' | 'saved' | 'failed';
}
export interface MonthlyRecoveryResult {
  verificationResult?: ReturnType<typeof verifyCudyrMonthlySources>;
  verificationError?: string;
  reports: ArchivedCudyrSupplement[];
  recovered: number;
  reused: number;
  failures: string[];
  /** Documentary reports alone never establish a complete episode query or absence. */
  verification: 'documentary';
}
const dependencies = {
  fetchReport,
  readFile: readCudyrSupplementFile,
  save: importCudyrSupplement,
  load: loadCudyrSupplements,
  readCensus: loadCudyrReport,
};

/** Explicit action only. Each server-acknowledged source report is the resumable checkpoint. */
export const recoverCudyrMonthlyReports = async (
  month: string,
  signal: AbortSignal,
  onProgress: (progress: MonthlyRecoveryProgress) => void,
  ports: typeof dependencies & {
    census?: {
      load: typeof loadCudyrCensusSources;
      save: typeof saveCudyrCensusSource;
      readFile: typeof readCudyrCensusFile;
    };
  } = {
    ...dependencies,
    census: {
      load: loadCudyrCensusSources,
      save: saveCudyrCensusSource,
      readFile: readCudyrCensusFile,
    },
  },
  now = new Date()
): Promise<MonthlyRecoveryResult> => {
  const period = monthlyRecoveryPeriod(month);
  if (resolveCudyrPendingStatus(period.last, now).phase !== 'overdue')
    throw new Error('El mes sigue abierto hasta las 11:59 del primer día del mes siguiente.');
  const owner = getStoredSessionOwnerKey(),
    generation = getSessionGeneration();
  const check = () => {
    signal.throwIfAborted();
    if (owner !== getStoredSessionOwnerKey() || generation !== getSessionGeneration())
      throw new Error('La sesión cambió.');
  };
  check();
  // Failed Firebase reads abort: never replace an unknown archive with an assumed empty one.
  const archived = await ports.load(period.from, period.next, signal);
  check();
  const result: MonthlyRecoveryResult = {
    reports: [...archived],
    recovered: 0,
    reused: 0,
    failures: [],
    verification: 'documentary',
  };
  if (ports.census) {
    const existing = await ports.census.load(period.from, period.next, signal);
    check();
    for (let date = period.from; date <= period.next; date = getNextDay(date)) {
      check();
      const reusable = existing.some(
        a =>
          a.date === date &&
          [a.observedAt, a.importedAt].every(
            t =>
              Number.isFinite(Date.parse(t)) &&
              Date.parse(t) <= now.getTime() &&
              resolveCudyrPendingStatus(date > period.last ? period.last : date, new Date(t))
                .phase === 'overdue'
          )
      );
      if (reusable) {
        onProgress({ reportMonth: date, status: 'reused' });
        continue;
      }
      onProgress({ reportMonth: date, status: 'reading' });
      try {
        const source = await ports.fetchReport(date.slice(0, 7), signal, date);
        check();
        const parsed = await ports.census.readFile(source.base64, signal);
        check();
        if (parsed.date !== date) throw new Error('Censo de otra fecha.');
        const saved = await ports.census.save(parsed, source.base64, source.capturedAt);
        check();
        if (!saved.persisted) throw new Error('Guardado censal no confirmado.');
        onProgress({ reportMonth: date, status: 'saved' });
      } catch (e) {
        check();
        result.failures.push(date);
        onProgress({ reportMonth: date, status: 'failed' });
        if (!(e instanceof Error)) throw e;
      }
    }
  }
  for (const reportMonth of period.reportMonths) {
    check();
    // Only an explicit extension receipt after this target month's closing is reusable here.
    const existing = archived.find(
      r =>
        r.month === reportMonth &&
        r.capture?.source === 'extension_monthly_report' &&
        Date.parse(r.capture.observedAt) <= now.getTime() &&
        Date.parse(r.importedAt) <= now.getTime() &&
        resolveCudyrPendingStatus(period.last, new Date(r.capture.observedAt)).phase ===
          'overdue' &&
        resolveCudyrPendingStatus(period.last, new Date(r.importedAt)).phase === 'overdue'
    );
    if (existing) {
      result.reused++;
      onProgress({ reportMonth, status: 'reused' });
      continue;
    }
    onProgress({ reportMonth, status: 'reading' });
    try {
      const source = await ports.fetchReport(reportMonth, signal);
      check();
      const bytes = Uint8Array.from(atob(source.base64), c => c.charCodeAt(0));
      const parsed = await ports.readFile(
        new File([bytes], `Categorizacion_${reportMonth}.xls`),
        signal
      );
      check();
      if (parsed.report.month !== reportMonth)
        throw new Error('El informe corresponde a otro mes.');
      const saved = await ports.save({
        ...parsed,
        capture: { source: 'extension_monthly_report', observedAt: source.capturedAt },
      });
      check();
      if (!saved.persisted || !saved.captureStored)
        throw new Error('El servidor no confirmó el respaldo para reanudar.');
      result.recovered++;
      onProgress({ reportMonth, status: 'saved' });
    } catch (error) {
      check();
      result.failures.push(reportMonth);
      onProgress({ reportMonth, status: 'failed' });
      // Preserve other checkpoints; a failure never becomes a negative clinical result.
      if (!(error instanceof Error)) throw error;
    }
  }
  check();
  const reports = await ports.load(period.from, period.next, signal);
  check();
  // Only source reports with final capture receipts are eligible for the source-cell check.
  result.reports = period.reportMonths.flatMap(reportMonth => {
    const candidates = reports.filter(
      r =>
        r.month === reportMonth &&
        r.capture?.source === 'extension_monthly_report' &&
        Number.isFinite(Date.parse(r.capture.observedAt)) &&
        Date.parse(r.capture.observedAt) <= Date.now() &&
        resolveCudyrPendingStatus(period.last, new Date(r.capture.observedAt)).phase ===
          'overdue' &&
        resolveCudyrPendingStatus(period.last, new Date(r.importedAt)).phase === 'overdue'
    );
    return candidates
      .sort(
        (a, b) =>
          Date.parse(b.capture!.observedAt) - Date.parse(a.capture!.observedAt) ||
          b.importedAt.localeCompare(a.importedAt)
      )
      .slice(0, 1);
  });
  try {
    const census = await ports.readCensus(period.from, period.last, signal);
    check();
    result.verificationResult = verifyCudyrMonthlySources(census, result.reports);
  } catch {
    check(); // Cancellation/session changes still invalidate this caller.
    result.verificationError =
      'Fuentes guardadas. Falta completar la conciliación; puede reintentar.';
  }
  return result;
};
