import { CURRENT_SCHEMA_VERSION } from '@/constants/version';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { normalizeDailyRecordInvariants } from '@/utils/recordInvariants';
import { normalizeMovementBedConsistency } from '@/services/repositories/clinicalMovementBedConsistencyPolicy';
import { validateAndSalvageRecord } from '@/services/repositories/helpers/validationHelper';
import { logError } from '@/services/utils/errorService';
import {
  ensureDailyRecordDateTimestamp,
  syncDailyRecordClinicalResources,
} from '@/services/repositories/dailyRecordDomainServices';
import { assertAdmissionDatePersistencePolicy } from '@/services/repositories/dailyRecordAdmissionDateWritePolicy';
import { buildInvariantRepairReviewContext } from '@/services/repositories/invariantRepairReviewContext';
import { ensureDailyRecordClinicalEpisodeIds } from '@/application/patient-flow/clinicalEpisodeIdPolicy';

const normalizePreparedRecord = (record: DailyRecord): DailyRecord => {
  const normalized = normalizeDailyRecordInvariants(record);
  const movementConsistency = normalizeMovementBedConsistency(normalized.record);
  const validatedRecord = ensureDailyRecordClinicalEpisodeIds(movementConsistency.record);

  const repairPaths = [
    ...Object.keys(normalized.patches),
    ...Object.keys(movementConsistency.patches),
  ];

  if (repairPaths.length > 0) {
    logError(
      'Invariant repair applied on save',
      undefined,
      buildInvariantRepairReviewContext({
        date: validatedRecord.date,
        operation: 'save',
        repairPaths,
        touchedPaths: ['*'],
      })
    );
  }

  syncDailyRecordClinicalResources(validatedRecord);
  validatedRecord.schemaVersion = CURRENT_SCHEMA_VERSION;
  return validatedRecord;
};

export const prepareDailyRecordForPersistence = (
  record: DailyRecord,
  date: string,
  previousRecord?: DailyRecord | null
): DailyRecord => {
  const recordWithSchemaDefaults = validateAndSalvageRecord(record, date);
  assertAdmissionDatePersistencePolicy(date, recordWithSchemaDefaults, previousRecord);
  ensureDailyRecordDateTimestamp(recordWithSchemaDefaults);
  return normalizePreparedRecord(recordWithSchemaDefaults);
};
