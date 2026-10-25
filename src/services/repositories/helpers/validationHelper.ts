import { DailyRecord } from '@/types/domain/dailyRecord';
import {
  DailyRecordSchema,
  hasStructuralRepairs,
  parseDailyRecordWithDefaultsReport,
} from '@/schemas/zodSchemas';
import type { UnreadableIdentityPolicy } from '@/schemas/zodFallbackBuilders';
import { repositoryValidationLogger } from '@/services/repositories/repositoryLoggers';

const logSalvageSummary = (
  date: string,
  report: ReturnType<typeof parseDailyRecordWithDefaultsReport>['report']
): void => {
  if (!hasStructuralRepairs(report)) {
    return;
  }

  repositoryValidationLogger.warn(`Salvaged ${date}`, report);
};

/**
 * Validates a DailyRecord against the strict schema.
 * If strict validation fails, attempts to salvage the data using defaults.
 *
 * @param record - The record to validate
 * @param date - The date identifier for reporting/salvage
 * @param options.unreadableIdentity - `quarantine` only for a record read from storage
 * @returns A strictly validated DailyRecord
 * @throws Error if the record is completely corrupt and cannot be salvaged
 * @throws PatientIdentityRepairRequiredError for an unreadable identity under `reject`
 */
export const validateAndSalvageRecord = (
  record: DailyRecord,
  date: string,
  { unreadableIdentity = 'reject' }: { unreadableIdentity?: UnreadableIdentityPolicy } = {}
): DailyRecord => {
  try {
    // 1. Attempt strict parse
    return DailyRecordSchema.parse(record);
  } catch (err) {
    repositoryValidationLogger.warn(
      `Strict validation failed for ${date}, attempting salvage...`,
      err
    );

    // 2. Fallback to salvage logic
    const { record: salvaged, report } = parseDailyRecordWithDefaultsReport(record, date, {
      unreadableIdentity,
    });
    logSalvageSummary(date, report);

    // 3. Re-validate the salvaged record to guarantee it meets the schema
    try {
      return DailyRecordSchema.parse(salvaged);
    } catch (finalErr) {
      repositoryValidationLogger.error(`Salvage failed strict validation for ${date}`, finalErr);
      throw new Error(
        `Crítico: El registro del día ${date} está corrupto y no pudo ser recuperado automáticamente.`
      );
    }
  }
};
