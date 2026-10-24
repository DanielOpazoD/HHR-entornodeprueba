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
import { getRecordForDateStrict } from '@/services/storage/indexeddb/indexedDbRecordService';
import { isClinicalDerivedLayoutRegression } from '@/services/storage/clinicalDerivedImportGuard';
import {
  createApplicationFailed,
  createApplicationPartial,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import {
  buildClinicalDerivedBackupSection,
  describeIncompleteClinicalDerivedBackup,
  loadClinicalDerivedDayRestore,
  type ClinicalDerivedBackupSection,
} from '@/services/exporters/clinicalDerivedBackupSection';
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
  /**
   * Episode documents of split days; present only when a day is marked. A restore embeds their
   * moved fields back into each day (clinicalDerivedBackupRestore); it never writes the documents.
   */
  clinicalDerived?: ClinicalDerivedBackupSection;
}

export interface YearToDateBackup {
  version: string;
  exportDate: string;
  year: number;
  throughDate: string;
  recordCount: number;
  records: DailyRecord[];
  clinicalDerived?: ClinicalDerivedBackupSection;
}

export interface BackupImportResult {
  success: number;
  failed: number;
  repaired: number;
  outcome: 'clean' | 'repaired' | 'partial' | 'blocked';
  /**
   * Restored split days whose per-episode data (vitals history, Rayen checkpoint) did not come
   * back; such a restore is `partial`. Absent when there are none.
   */
  clinicalDerivedIncompleteDates?: string[];
}

export interface DataMaintenanceExportResult {
  /** `partial`: the file was written, but some split days lack their episode documents. */
  status: 'success' | 'partial' | 'failed';
  reason: 'no_records' | 'clinical_derived_incomplete' | 'unknown';
  userSafeMessage: string;
  recordCount: number;
}

/** The result of a written backup: partial when its clinicalDerived section lists unread days. */
const completedExportResult = (
  clinicalDerived: ClinicalDerivedBackupSection | undefined,
  userSafeMessage: string,
  recordCount: number
): DataMaintenanceExportResult => {
  const incomplete = describeIncompleteClinicalDerivedBackup(clinicalDerived);
  return incomplete?.userSafeMessage
    ? {
        status: 'partial',
        reason: 'clinical_derived_incomplete',
        userSafeMessage: incomplete.userSafeMessage,
        recordCount,
      }
    : { status: 'success', reason: 'unknown', userSafeMessage, recordCount };
};

const toDataMaintenanceOutcome = (
  result: DataMaintenanceExportResult
): ApplicationOutcome<DataMaintenanceExportResult | null> =>
  result.status === 'success'
    ? createApplicationSuccess(result, [], {
        reason: result.reason,
        userSafeMessage: result.userSafeMessage,
      })
    : result.status === 'partial'
      ? createApplicationPartial(
          result,
          [
            {
              kind: 'unknown',
              code: result.reason,
              message: result.userSafeMessage,
              userSafeMessage: result.userSafeMessage,
              severity: 'warning',
              retryable: true,
            },
          ],
          { reason: result.reason, userSafeMessage: result.userSafeMessage, severity: 'warning' }
        )
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

    const clinicalDerived = await buildClinicalDerivedBackupSection(records);
    const backup: MonthBackup = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      year,
      month,
      recordCount: records.length,
      records,
      ...(clinicalDerived ? { clinicalDerived } : {}),
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
    return completedExportResult(
      clinicalDerived,
      'Respaldo generado correctamente.',
      records.length
    );
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

    const clinicalDerived = await buildClinicalDerivedBackupSection(records);
    const backup: YearToDateBackup = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      year,
      throughDate: endDate,
      recordCount: records.length,
      records,
      ...(clinicalDerived ? { clinicalDerived } : {}),
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
    return completedExportResult(
      clinicalDerived,
      'Respaldo anual generado correctamente.',
      records.length
    );
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
  const clinicalDerivedIncompleteDates: string[] = [];
  const restoreClinicalDerivedDay = await loadClinicalDerivedDayRestore(backup.clinicalDerived);

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

      // A local split day is never replaced by a copy that is not newer and lost (or changed) its
      // marker (D10). The date counts as failed, as does one whose local copy cannot be read.
      if (
        isClinicalDerivedLayoutRegression(
          await getRecordForDateStrict(parsed.record.date),
          parsed.record
        )
      ) {
        throw new Error('El día local está dividido y la copia del respaldo no es más nueva.');
      }

      // A split day gets each episode's vitals history and Rayen checkpoint back from the backup's
      // section, embedded where the episode lives. Declared intent: the clinical authority keeps
      // Rayen vitals/devices/scales when an administrator recreates a day that no longer exists
      // remotely (see functions fence); on a stored split day it keeps the stored values instead,
      // so the day the server confirms tells whether they came back.
      const restore = restoreClinicalDerivedDay(parsed.record);
      const confirmsRestore = restore.kind === 'embedded' && restore.needsConfirmation;
      const saved = await saveDailyRecordDetailed(
        restore.kind === 'absent' ? parsed.record : restore.record,
        undefined,
        {
          writeOrigin: 'backup_restore',
          ...(confirmsRestore ? { requireConfirmedRecord: true } : {}),
        }
      );
      success++;
      if (hadRepairs) {
        repaired++;
      }
      const keptClinicalDerived =
        restore.kind === 'absent' ||
        (restore.kind === 'embedded' &&
          (!restore.needsConfirmation ||
            restore.isKeptBy(saved?.savedRemotely ? saved.confirmedRecord : undefined)));
      if (!keptClinicalDerived) {
        clinicalDerivedIncompleteDates.push(parsed.record.date);
      }
    } catch (error) {
      dataMaintenanceLogger.error(`Failed to import record for ${record.date}`, error);
      failed++;
    }

    if (onProgress) {
      onProgress(i + 1, backup.records.length);
    }
  }

  const outcome =
    success === 0
      ? 'blocked'
      : failed > 0 || clinicalDerivedIncompleteDates.length > 0
        ? 'partial'
        : repaired > 0
          ? 'repaired'
          : 'clean';
  const incomplete =
    clinicalDerivedIncompleteDates.length > 0 ? { clinicalDerivedIncompleteDates } : {};

  // Audit log
  if (success > 0) {
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
        ...incomplete,
      }
    );
  }

  return { success, failed, repaired, outcome, ...incomplete };
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
