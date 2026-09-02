/**
 * Data Maintenance Service
 *
 * Provides functionality for manual JSON export and import of daily records.
 * This allows administrators to have local backups and restore data by month.
 */

import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import { saveDetailed as saveDailyRecordDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { logAuditEvent } from './auditService';
import { getCurrentUserEmail } from './utils/auditUtils';
import { parseDailyRecordWithDefaultsReport } from '@/schemas/zodSchemas';
import { dataMaintenanceLogger } from '@/services/admin/adminLoggers';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import {
  DATA_MAINTENANCE_MONTH_NAMES,
  downloadJsonBackup,
  hydrateRangeRecords,
  resolveMonthDateRange,
  resolveYearToDateFileSuffix,
  resolveYearToDateRange,
} from '@/services/admin/dataMaintenanceSupport';

export interface MonthBackup {
  version: string;
  exportDate: string;
  year: number;
  month: number;
  recordCount: number;
  records: DailyRecord[];
}

export interface YearToDateBackup {
  version: string;
  exportDate: string;
  year: number;
  throughDate: string;
  recordCount: number;
  records: DailyRecord[];
}

export interface BackupImportResult {
  success: number;
  failed: number;
  repaired: number;
  outcome: 'clean' | 'repaired' | 'partial' | 'blocked';
}

export interface DataMaintenanceExportResult {
  status: 'success' | 'failed';
  reason: 'no_records' | 'unknown';
  userSafeMessage: string;
  recordCount: number;
}

const toDataMaintenanceOutcome = (
  result: DataMaintenanceExportResult
): ApplicationOutcome<DataMaintenanceExportResult | null> =>
  result.status === 'success'
    ? createApplicationSuccess(result, [], {
        reason: result.reason,
        userSafeMessage: result.userSafeMessage,
      })
    : createApplicationFailed(
        null,
        [
          {
            kind: result.reason === 'no_records' ? 'not_found' : 'unknown',
            message: result.userSafeMessage,
            userSafeMessage: result.userSafeMessage,
            severity: 'warning',
          },
        ],
        {
          reason: result.reason,
          userSafeMessage: result.userSafeMessage,
          severity: 'warning',
        }
      );

const exportMonthRecordsInternal = async (
  year: number,
  month: number
): Promise<DataMaintenanceExportResult> => {
  try {
    const { startDate, endDate } = resolveMonthDateRange(year, month);
    const records = await hydrateRangeRecords(startDate, endDate);

    if (records.length === 0) {
      return {
        status: 'failed',
        reason: 'no_records',
        userSafeMessage: 'No hay registros para exportar en este período.',
        recordCount: 0,
      };
    }

    const backup: MonthBackup = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      year,
      month,
      recordCount: records.length,
      records,
    };

    const monthName = DATA_MAINTENANCE_MONTH_NAMES[month - 1];
    const fileName = `Respaldo HHR ${monthName} ${year}.json`;
    await downloadJsonBackup(backup, fileName);

    // Audit log
    await logAuditEvent(getCurrentUserEmail(), 'DATA_EXPORTED', 'dailyRecord', `${year}-${month}`, {
      year,
      month,
      recordCount: records.length,
    });
    return {
      status: 'success',
      reason: 'unknown',
      userSafeMessage: 'Respaldo generado correctamente.',
      recordCount: records.length,
    };
  } catch (error) {
    dataMaintenanceLogger.error('Monthly export failed', error);
    return {
      status: 'failed',
      reason: 'unknown',
      userSafeMessage:
        error instanceof Error ? error.message : 'No se pudo exportar el respaldo mensual.',
      recordCount: 0,
    };
  }
};

/**
 * Exports all records from January 1st of a year through today when the year is current,
 * or through December 31st when exporting a past year.
 */
const exportYearToDateRecordsInternal = async (
  year: number = new Date().getFullYear()
): Promise<DataMaintenanceExportResult> => {
  try {
    const now = new Date();
    const { startDate, endDate } = resolveYearToDateRange(year, now);
    const records = await hydrateRangeRecords(startDate, endDate);

    if (records.length === 0) {
      return {
        status: 'failed',
        reason: 'no_records',
        userSafeMessage: 'No hay registros para exportar en el rango anual seleccionado.',
        recordCount: 0,
      };
    }

    const backup: YearToDateBackup = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      year,
      throughDate: endDate,
      recordCount: records.length,
      records,
    };

    const suffix = resolveYearToDateFileSuffix(year, now);
    const fileName = `Respaldo HHR ${year} hasta ${suffix}.json`;
    await downloadJsonBackup(backup, fileName);

    await logAuditEvent(getCurrentUserEmail(), 'DATA_EXPORTED', 'dailyRecord', `${year}-YTD`, {
      year,
      throughDate: endDate,
      recordCount: records.length,
      exportScope: 'year-to-date',
    });
    return {
      status: 'success',
      reason: 'unknown',
      userSafeMessage: 'Respaldo anual generado correctamente.',
      recordCount: records.length,
    };
  } catch (error) {
    dataMaintenanceLogger.error('Year-to-date export failed', error);
    return {
      status: 'failed',
      reason: 'unknown',
      userSafeMessage:
        error instanceof Error ? error.message : 'No se pudo exportar el respaldo anual.',
      recordCount: 0,
    };
  }
};

export const exportMonthRecordsWithResult = async (
  year: number,
  month: number
): Promise<DataMaintenanceExportResult> => exportMonthRecordsInternal(year, month);

export const exportYearToDateRecordsWithResult = async (
  year: number = new Date().getFullYear()
): Promise<DataMaintenanceExportResult> => exportYearToDateRecordsInternal(year);

export const exportMonthRecordsWithOutcome = async (
  year: number,
  month: number
): Promise<ApplicationOutcome<DataMaintenanceExportResult | null>> =>
  toDataMaintenanceOutcome(await exportMonthRecordsInternal(year, month));

export const exportYearToDateRecordsWithOutcome = async (
  year: number = new Date().getFullYear()
): Promise<ApplicationOutcome<DataMaintenanceExportResult | null>> =>
  toDataMaintenanceOutcome(await exportYearToDateRecordsInternal(year));

/**
 * Legacy throw-based compatibility wrappers.
 */
export const exportMonthRecords = async (year: number, month: number): Promise<void> => {
  const result = await exportMonthRecordsInternal(year, month);
  if (result.status === 'failed') {
    throw new Error(result.userSafeMessage);
  }
};

export const exportYearToDateRecords = async (
  year: number = new Date().getFullYear()
): Promise<void> => {
  const result = await exportYearToDateRecordsInternal(year);
  if (result.status === 'failed') {
    throw new Error(result.userSafeMessage);
  }
};

/**
 * Imports records from a backup object
 * Uses the repository to ensure Firestore sync and audit logging
 */
export const importRecordsFromBackup = async (
  backup: MonthBackup,
  onProgress?: (current: number, total: number) => void
): Promise<BackupImportResult> => {
  let success = 0;
  let failed = 0;
  let repaired = 0;

  for (let i = 0; i < backup.records.length; i++) {
    const record = backup.records[i];
    try {
      const parsed = parseDailyRecordWithDefaultsReport(record, record.date);
      const hadRepairs =
        parsed.report.nullNormalization.replacedNullCount > 0 ||
        parsed.report.nullNormalization.droppedArrayEntriesCount > 0 ||
        parsed.report.salvagedBeds.length > 0 ||
        parsed.report.droppedDischargeItems > 0 ||
        parsed.report.droppedTransferItems > 0 ||
        parsed.report.droppedCmaItems > 0 ||
        parsed.report.droppedRayenSyncEvents > 0;

      await saveDailyRecordDetailed(parsed.record);
      success++;
      if (hadRepairs) {
        repaired++;
      }
    } catch (error) {
      dataMaintenanceLogger.error(`Failed to import record for ${record.date}`, error);
      failed++;
    }

    if (onProgress) {
      onProgress(i + 1, backup.records.length);
    }
  }

  // Audit log
  if (success > 0) {
    const outcome = failed > 0 ? 'partial' : repaired > 0 ? 'repaired' : 'clean';
    await logAuditEvent(
      getCurrentUserEmail(),
      'DATA_IMPORTED',
      'dailyRecord',
      `${backup.year}-${backup.month}`,
      {
        year: backup.year,
        month: backup.month,
        recordCount: success,
        failedCount: failed,
        repairedCount: repaired,
        outcome,
      }
    );
  }

  const outcome =
    success === 0 ? 'blocked' : failed > 0 ? 'partial' : repaired > 0 ? 'repaired' : 'clean';

  return { success, failed, repaired, outcome };
};

/**
 * Validates if a file is a valid HHR Backup
 */
export const validateBackupFile = (content: unknown): content is MonthBackup => {
  if (!content || typeof content !== 'object') return false;
  const data = content as Record<string, unknown>;
  return (
    typeof data.version === 'string' &&
    Array.isArray(data.records) &&
    data.records.length > 0 &&
    typeof (data.records[0] as DailyRecord).date === 'string'
  );
};
