import type { LegacyNullNormalizationReport } from './zod/legacyNormalization';

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

export interface DailyRecordParseReport {
  nullNormalization: LegacyNullNormalizationReport;
  salvagedBeds: string[];
  droppedDischargeItems: number;
  droppedTransferItems: number;
  droppedCmaItems: number;
  /** Eventos del historial de sincronización que no pudieron salvarse en la ruta de reparación. */
  droppedRayenSyncEvents: number;
}

export interface PatientDataParseReport {
  nullNormalization: LegacyNullNormalizationReport;
  usedFallback: boolean;
}

export const hasStructuralRepairs = (
  report: DailyRecordParseReport | PatientDataParseReport
): boolean => {
  const hasNullRepairs =
    report.nullNormalization.replacedNullCount > 0 ||
    report.nullNormalization.droppedArrayEntriesCount > 0;

  if ('usedFallback' in report) {
    return hasNullRepairs || report.usedFallback;
  }

  return (
    hasNullRepairs ||
    report.salvagedBeds.length > 0 ||
    report.droppedDischargeItems > 0 ||
    report.droppedTransferItems > 0 ||
    report.droppedCmaItems > 0 ||
    report.droppedRayenSyncEvents > 0
  );
};
