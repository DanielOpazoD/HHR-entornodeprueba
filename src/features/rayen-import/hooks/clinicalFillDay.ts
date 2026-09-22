import type { DailyRecord } from '../contracts/rayenDomainContracts';
import {
  isConfirmedRayenCensusHandoff,
  type ConfirmedRayenCensusHandoff,
} from './rayenCensusPersistenceGuard';
import { toIsoReportDate } from './reportDateHelpers';

const isValidIsoDay = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
};

/** Past records use their date; a pre-handoff calendar record keeps the frozen active shift. */
export const resolveClinicalCensusDay = (
  record: DailyRecord,
  activeClinicalDay?: string
): string => {
  const recordDay = toIsoReportDate(record);
  return activeClinicalDay && isValidIsoDay(activeClinicalDay) && activeClinicalDay < recordDay
    ? activeClinicalDay
    : recordDay;
};

export const resolveClinicalFillDay = (
  source: DailyRecord | ConfirmedRayenCensusHandoff,
  record: DailyRecord
): string =>
  resolveClinicalCensusDay(
    record,
    isConfirmedRayenCensusHandoff(source) ? source.clinicalDay : undefined
  );
