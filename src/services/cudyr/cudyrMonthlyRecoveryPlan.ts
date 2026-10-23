import { getNextDay } from '@/utils/clinicalDayUtils';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { cudyrArchiveCoverage } from './cudyrArchiveCoverage';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';

export const monthlyRecoveryPeriod = (month: string) => {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Mes inválido.');
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const next = getNextDay(last);
  return { month, from: `${month}-01`, last, next, reportMonths: [month, next.slice(0, 7)] };
};

/** A running month has closed nights too. Never query future/open nights as final evidence. */
export const monthlyRecoveryWindow = (month: string, now = new Date()) => {
  const period = monthlyRecoveryPeriod(month);
  let last = '';
  for (let day = period.from; day <= period.last; day = getNextDay(day)) {
    if (resolveCudyrPendingStatus(day, now).phase !== 'overdue') break;
    last = day;
  }
  return last ? { ...period, last, next: getNextDay(last) } : null;
};

export const pendingCudyrRecoveryPlan = (data: CudyrReportDataset, now: Date) => {
  if (
    (data.readIncomplete ?? data.issues.length > 0) ||
    data.coverage.some(day => day.state === 'error')
  )
    throw new Error(
      'No se pudo verificar el archivo de HHR. Reintente antes de consultar Eloísa. ' +
        data.issues.slice(0, 3).join(' ')
    );
  const coverage = data.officialSnapshot ? [] : cudyrArchiveCoverage({ ...data, issues: [] }, now);
  const days = coverage.filter(d => d.state === 'pending');
  const dates = days.map(day => day.date);
  const complete = new Set(coverage.filter(d => d.state === 'complete').map(d => d.date));
  // Neighbor evidence can establish the previous night's census, but verified days stay untouched.
  const censusDates = [...new Set(dates.flatMap(date => [date, getNextDay(date)]))]
    .filter(date => !complete.has(date))
    .sort();
  const reportMonths = [
    ...new Set(dates.flatMap(date => [date.slice(0, 7), getNextDay(date).slice(0, 7)])),
  ].sort();
  return { dates, censusDates, reportMonths };
};
