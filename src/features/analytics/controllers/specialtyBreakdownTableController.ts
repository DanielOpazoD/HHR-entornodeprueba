import type { PatientTraceability, SpecialtyStats } from '@/types/minsalTypes';
import { calculateDischargeStayDays } from '@/utils/clinicalDayUtils';

export type SpecialtyBreakdownSortKey =
  | 'specialty'
  | 'diasOcupados'
  | 'egresos'
  | 'traslados'
  | 'fallecidos'
  | 'tasaMortalidad'
  | 'promedioDiasEstada'
  | 'cma';

export const formatStayRange = (min?: number, max?: number): string =>
  min !== undefined && max !== undefined ? `${min.toFixed(1)} - ${max.toFixed(1)} días` : '--';

export const getStayDays = (patient: PatientTraceability | undefined): number | null =>
  calculateDischargeStayDays(patient?.admissionDate, patient?.dischargeDate);

export const calculateStayAverageFromTraceability = (rows: SpecialtyStats[]): number => {
  const stayDays = rows
    .flatMap(row => (row.egresosList ?? []).map(getStayDays))
    .filter((value): value is number => value !== null);

  if (stayDays.length === 0) {
    return 0;
  }

  const totalStayDays = stayDays.reduce((sum, value) => sum + value, 0);
  return totalStayDays / stayDays.length;
};

export const getSpecialtyEventCount = (row: SpecialtyStats): number =>
  (row.diasOcupados ?? 0) +
  (row.egresos ?? 0) +
  (row.traslados ?? 0) +
  (row.fallecidos ?? 0) +
  (row.aerocardal ?? 0) +
  (row.fach ?? 0);

export const getSpecialtySortValue = (
  row: SpecialtyStats,
  sortKey: SpecialtyBreakdownSortKey
): string | number => {
  if (sortKey === 'specialty') return String(row.specialty || '');
  if (sortKey === 'cma') return 0;
  return Number(row[sortKey] ?? 0);
};
