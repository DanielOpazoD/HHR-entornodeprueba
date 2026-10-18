import { cudyrReportCache } from './cudyrReportCache';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { loadCudyrReport } from './cudyrReportLoader';
import { verifyCudyrMonthlySources } from './cudyrMonthlyVerification';
import {
  loadCudyrCensusSources,
  saveCudyrCensusSource,
  readCudyrCensusFile,
} from './cudyrCensusSourceService';
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

import { monthlyRecoveryWindow, pendingCudyrRecoveryPlan } from './cudyrMonthlyRecoveryPlan';
export { monthlyRecoveryPeriod, monthlyRecoveryWindow } from './cudyrMonthlyRecoveryPlan';

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
  detail?: string;
}
export interface MonthlyRecoveryResult {
  through?: string;
  pendingDays?: number;
  expectedReports?: number;
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
  const startedAt = Date.now();
  const period = monthlyRecoveryWindow(month, now);
  if (!period) throw new Error('Aún no hay turnos cerrados para verificar en este mes.');
  const owner = getStoredSessionOwnerKey(),
    generation = getSessionGeneration();
  const check = () => {
    signal.throwIfAborted();
    if (owner !== getStoredSessionOwnerKey() || generation !== getSessionGeneration())
      throw new Error('La sesión cambió.');
  };
  check();
  const remember = (data: CudyrReportDataset) => {
    check();
    if (ports.readCensus === loadCudyrReport && owner && generation)
      cudyrReportCache(loadCudyrReport, `${owner}:${generation}`, true).put({
        ...data,
        loadedAt: new Date().toISOString(),
        readStartedAt: new Date(startedAt).toISOString(),
      });
  };
  // Re-read authoritative HHR state before deciding what is still missing.
  const baseline = await ports.readCensus(period.from, period.last, signal);
  check();
  const plan = pendingCudyrRecoveryPlan(baseline, now);
  const result: MonthlyRecoveryResult = {
    reports: [],
    recovered: 0,
    reused: 0,
    failures: [],
    verification: 'documentary',
    through: period.last,
    pendingDays: plan.dates.length,
    expectedReports: plan.reportMonths.length,
  };
  if (!plan.dates.length) {
    remember(baseline);
    return result;
  }
  // A closed neighboring month may already be verified too. Probe it separately so
  // the target month's official-snapshot fast path remains intact.
  if (
    plan.censusDates.includes(period.next) &&
    resolveCudyrPendingStatus(period.next, now).phase === 'overdue'
  ) {
    const neighbor = await ports.readCensus(period.next, period.next, signal);
    check();
    const neighborPlan = pendingCudyrRecoveryPlan(neighbor, now);
    if (!neighborPlan.dates.includes(period.next))
      plan.censusDates = plan.censusDates.filter(date => date !== period.next);
  }

  // Failed archive reads abort: never replace an unknown archive with an assumed empty one.
  const archived = await ports.load(period.from, period.next, signal);
  check();
  const lastPending = plan.dates.at(-1)!;
  if (ports.census) {
    const existing = await ports.census.load(period.from, period.next, signal);
    check();
    for (const date of plan.censusDates) {
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
        onProgress({
          reportMonth: date,
          status: 'failed',
          detail: e instanceof Error ? e.message : undefined,
        });
        if (!(e instanceof Error)) throw e;
      }
    }
  }
  for (const reportMonth of plan.reportMonths) {
    check();
    // Only an explicit extension receipt after the latest pending night's closing is reusable here.
    const existing = archived.find(
      r =>
        r.month === reportMonth &&
        r.capture?.source === 'extension_monthly_report' &&
        Date.parse(r.capture.observedAt) <= now.getTime() &&
        Date.parse(r.importedAt) <= now.getTime() &&
        resolveCudyrPendingStatus(lastPending, new Date(r.capture.observedAt)).phase ===
          'overdue' &&
        resolveCudyrPendingStatus(lastPending, new Date(r.importedAt)).phase === 'overdue'
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
      onProgress({
        reportMonth,
        status: 'failed',
        detail: error instanceof Error ? error.message : undefined,
      });
      // Preserve other checkpoints; a failure never becomes a negative clinical result.
      if (!(error instanceof Error)) throw error;
    }
  }
  check();
  const reports = await ports.load(period.from, period.next, signal);
  check();
  // Include receipts created during this run, without admitting future timestamps.
  const completedAt = now.getTime() + Math.max(0, Date.now() - startedAt);
  // Only source reports with final capture receipts are eligible for the source-cell check.
  result.reports = plan.reportMonths.flatMap(reportMonth => {
    const candidates = reports.filter(
      r =>
        r.month === reportMonth &&
        r.capture?.source === 'extension_monthly_report' &&
        Number.isFinite(Date.parse(r.capture.observedAt)) &&
        Date.parse(r.capture.observedAt) <= completedAt &&
        Date.parse(r.importedAt) <= completedAt &&
        resolveCudyrPendingStatus(lastPending, new Date(r.capture.observedAt)).phase ===
          'overdue' &&
        resolveCudyrPendingStatus(lastPending, new Date(r.importedAt)).phase === 'overdue'
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
    remember(census);
  } catch {
    check(); // Cancellation/session changes still invalidate this caller.
    result.verificationError =
      'Fuentes guardadas. Falta completar la conciliación; puede reintentar.';
  }
  return result;
};
