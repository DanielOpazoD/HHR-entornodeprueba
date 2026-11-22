import type { SyslabHospitalizationReports } from '@/features/laboratory/hospitalization-reports';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { countPendingInRange, pendingReportDays } from './clinicalExplorerDownloadScope';
import { buildLabDayRows, parseColumnKey, type LabDayRow } from './clinicalExplorerLabModel';
import {
  outcome,
  pluralCount,
  type DownloadRange,
  type PartOutcome,
} from './clinicalExplorerDownloadContracts';

/** What the Syslab read of the stay ended in, as the laboratory hook reports it. */
export type LabSettlement =
  | { kind: 'failed'; problem: string }
  | { kind: 'empty' }
  /** `pendingDays`: ISO day of each report Syslab has not delivered yet ('' when unknown). */
  | { kind: 'ready'; analysis: LabAnalysisData; pendingDays: string[] };

type LabRead = Pick<
  SyslabHospitalizationReports,
  'phase' | 'message' | 'analysis' | 'exams' | 'pendingLinks' | 'refreshing'
>;

/** Null while Syslab is still being asked; then how the read ended. A failure is never «sin informes». */
export const settleLabRead = (lab: LabRead): LabSettlement | null => {
  switch (lab.phase) {
    case 'checking':
    case 'listing':
    case 'reading':
      return null;
    case 'login-required':
      return {
        kind: 'failed',
        problem:
          'Syslab pide iniciar sesión. Inicia sesión desde Laboratorio y vuelve a intentarlo.',
      };
    case 'unavailable':
    case 'error':
      return { kind: 'failed', problem: lab.message || 'No se pudo leer Syslab.' };
    // A cached list or report set being renewed may lack the newest reports: wait for it.
    case 'empty':
      return lab.refreshing ? null : { kind: 'empty' };
    case 'ready':
      return lab.analysis && !lab.refreshing
        ? {
            kind: 'ready',
            analysis: lab.analysis,
            pendingDays: pendingReportDays(lab.exams, lab.pendingLinks),
          }
        : null;
  }
};

export const labProgressText = (
  lab: Pick<SyslabHospitalizationReports, 'phase' | 'progress'>
): string => {
  if (lab.phase === 'checking') return 'Comprobando la sesión de Syslab…';
  if (lab.phase === 'reading') {
    return lab.progress
      ? `Leyendo informes de Syslab (${lab.progress.completed} de ${lab.progress.total})…`
      : 'Leyendo informes de Syslab…';
  }
  return 'Consultando Syslab…';
};

/** One Syslab report (one order): its stamp and every result, in clinical order. */
export interface LabReportGroup {
  columnKey: string;
  dayIso: string;
  time: string;
  rows: LabDayRow[];
}

/** The results the explorer shows, of the reports inside the range, oldest first. */
export const buildLabReportGroups = (
  analysis: LabAnalysisData,
  range: DownloadRange
): LabReportGroup[] => {
  const days = new Set<string>();
  for (const columns of Object.values(analysis.comparison)) {
    for (const columnKey of Object.keys(columns)) {
      const when = parseColumnKey(columnKey);
      if (when && when.dayIso >= range.from && when.dayIso <= range.to) days.add(when.dayIso);
    }
  }
  const groups = new Map<string, LabReportGroup>();
  for (const dayIso of [...days].sort()) {
    for (const row of buildLabDayRows(analysis, dayIso)) {
      const group = groups.get(row.columnKey) ?? {
        columnKey: row.columnKey,
        dayIso,
        time: row.time,
        rows: [],
      };
      group.rows.push(row);
      groups.set(row.columnKey, group);
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.dayIso.localeCompare(b.dayIso) ||
      a.time.localeCompare(b.time) ||
      a.columnKey.localeCompare(b.columnKey)
  );
};

export const describeRange = (range: DownloadRange): string =>
  range.from === range.to
    ? `del ${formatDateDDMMYYYY(range.from)}`
    : `del ${formatDateDDMMYYYY(range.from)} al ${formatDateDDMMYYYY(range.to)}`;

/** Either the outcome without a PDF to write, or the reports to write it with. */
export const planLabPart = (
  settlement: LabSettlement,
  range: DownloadRange
):
  | { outcome: PartOutcome }
  | { groups: LabReportGroup[]; summary: string; notes: string[]; partialProblem?: string } => {
  if (settlement.kind === 'failed') {
    return { outcome: outcome('failed', 'No incluidos', { problem: settlement.problem }) };
  }
  const empty = `Sin informes de Syslab ${describeRange(range)}.`;
  if (settlement.kind === 'empty') return { outcome: outcome('empty', empty) };
  const groups = buildLabReportGroups(settlement.analysis, range);
  // Only reports of the chosen days are missing results of this download.
  const pending = countPendingInRange(settlement.pendingDays, range);
  const notes = pending
    ? [
        `Syslab aún no entrega resultados de ${pluralCount(pending, 'informe', 'informes')}; no van incluidos.`,
      ]
    : [];
  if (groups.length === 0 && !pending) {
    return { outcome: outcome('empty', empty, { notes }) };
  }
  if (groups.length === 0) {
    return {
      outcome: outcome('failed', 'No incluidos', {
        problem: `Syslab aún no entrega resultados de ${pluralCount(pending, 'informe', 'informes')} ${describeRange(range)}.`,
      }),
    };
  }
  return {
    groups,
    summary: `${pluralCount(groups.length, 'informe', 'informes')} ${describeRange(range)}`,
    notes,
    // Reports still pending at Syslab are missing results: the person decides, as with a failure.
    ...(pending
      ? {
          partialProblem: `${pending === 1 ? 'Falta' : 'Faltan'} ${pluralCount(pending, 'informe', 'informes')} que Syslab aún no entrega.`,
        }
      : {}),
  };
};
