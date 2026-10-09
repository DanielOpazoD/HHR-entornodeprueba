import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { getNextDay } from '@/utils/clinicalDayUtils';
import type { CudyrCaptureReceipt } from '@/types/domain/cudyrCapture';
import type { CudyrReportDataset, CudyrReportRow } from '@/types/domain/cudyrReport';

const afterClose = (day: string, timestamp: string) =>
  Number.isFinite(Date.parse(timestamp)) &&
  resolveCudyrPendingStatus(day, new Date(timestamp)).phase === 'overdue';

const hasCompleteCapture = (row: CudyrReportRow, captures: CudyrCaptureReceipt[], now: Date) => {
  const received = (value: string) =>
    Number.isFinite(Date.parse(value)) && Date.parse(value) <= now.getTime();
  if (row.monthlyEvidence?.state === 'conflict') return false;
  if (row.monthlyEvidence && ['found', 'absent'].includes(row.monthlyEvidence.state)) return true;
  if (!row.clinicalEpisodeId || row.cudyrStatus === 'guardado_pendiente') return false;
  const own = captures.filter(item => item.capture.clinicalEpisodeId === row.clinicalEpisodeId);
  return own.some(receipt => {
    const c = receipt.capture;
    if (
      !afterClose(row.date, c.observedAt) ||
      !received(c.observedAt) ||
      !received(receipt.receivedAt) ||
      !afterClose(row.date, receipt.receivedAt) ||
      c.status !== 'observed' ||
      c.metadataStatus !== 'complete'
    )
      return false;
    const parts = own.filter(
      item => item.capture.id === c.id && item.censusDate === receipt.censusDate
    );
    if (
      !Number.isInteger(c.totalParts) ||
      c.totalParts < 1 ||
      parts.some(
        item =>
          item.capture.totalParts !== c.totalParts ||
          !Number.isInteger(item.capture.part) ||
          item.capture.part < 0 ||
          item.capture.part >= c.totalParts ||
          item.capture.status !== 'observed' ||
          item.capture.metadataStatus !== 'complete' ||
          !afterClose(row.date, item.capture.observedAt) ||
          !received(item.capture.observedAt) ||
          !received(item.receivedAt) ||
          !afterClose(row.date, item.receivedAt)
      ) ||
      new Set(parts.map(item => item.capture.part)).size !== c.totalParts
    )
      return false;
    const ids = new Set(parts.flatMap(item => item.observationIds));
    if (ids.size !== c.totalEvaluations) return false;
    if (row.evaluation?.observationId) return ids.has(row.evaluation.observationId);
    // A legacy result alone is not proof that it reached the permanent archive.
    if (row.evaluation) return false;
    // A query for an unrelated later census cannot prove that this earlier night was consulted.
    return receipt.censusDate === row.date || receipt.censusDate === getNextDay(row.date);
  });
};

export interface CudyrArchiveDay {
  date: string;
  state: 'complete' | 'pending' | 'open';
  reason: string;
  censusState?: 'pending' | 'verified' | 'mismatch';
}
/** Conservative evidence of archival coverage, distinct from CUDYR compliance. No source reads. */
export const cudyrArchiveCoverage = (
  data: CudyrReportDataset,
  now = new Date()
): CudyrArchiveDay[] => {
  const days: string[] = [];
  for (let day = data.from; day <= data.to && days.length < 32; day = getNextDay(day))
    days.push(day);
  return days.map(date => {
    const result = (state: CudyrArchiveDay['state'], reason: string) => ({
      date,
      state,
      reason,
      censusState: data.coverage.find(d => d.date === date)?.censusVerification?.state,
    });
    if (resolveCudyrPendingStatus(date, now).phase !== 'overdue')
      return result('open', 'Ventana abierta hasta las 11:59 del día siguiente.');
    const day = data.coverage.find(item => item.date === date);
    if (!day || day.state !== 'disponible')
      return result(
        'pending',
        day?.state === 'error' ? 'No se pudo leer el censo.' : 'Sin censo guardado.'
      );
    if (data.issues.length) return result('pending', 'Lectura del archivo incompleta.');
    const rows = data.rows.filter(row => row.date === date);
    // Capture verification is independent of the time of the census sync and of eligibility review.
    const relevant = rows.filter(row => row.eligibility !== 'no_elegible');
    const pending = relevant.filter(row => !hasCompleteCapture(row, data.captures, now)).length;
    return pending
      ? result('pending', `${pending} casos con consulta de Eloísa pendiente o incompleta.`)
      : result(
          'complete',
          relevant.length
            ? 'CUDYR comprobados en Eloísa; resultados y ausencias incorporados.'
            : 'Censo disponible; sin pacientes que requieran CUDYR.'
        );
  });
};
