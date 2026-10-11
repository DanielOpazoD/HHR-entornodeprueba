/**
 * Data Migration Service
 * Handles migration of legacy data formats to current schema.
 *
 * Clinical Justification: Ensures that clinical data recorded in older versions
 * of the app remains consistent and usable for audits, even as data structures evolve.
 * Prevents "silent corruption" of historical patient records.
 */

import { DailyRecord } from '@/types/domain/dailyRecord';
import { parseDailyRecordWithDefaultsReport } from '@/schemas/zodSchemas';
import { normalizeDailyRecordInvariants } from '@/utils/recordInvariants';
import { recoverImportedMovementCalendarDate } from '@/utils/movementCalendarDate';
import {
  DailyRecordMigrationResult,
  LegacyMigrationRule,
  MigrationCompatibilityIntensity,
} from '@/services/repositories/dataMigrationContracts';
import { migrateRecordSchemaToCurrent } from '@/services/repositories/schemaGovernance';
import { assessSchemaCompatibility } from '@/services/repositories/schemaEvolutionPolicy';
import {
  applyDailyRecordStaffingCompatibility,
  hasLegacyDayShiftNurses,
  hasLegacyPrimaryDayShiftNurse,
} from '@/services/staff/dailyRecordStaffing';
import {
  hasMismatchedExplicitNameParts,
  inferDocumentTypeFromIdentity,
  normalizeLegacyIdentityValue,
  resolveLegacyNameParts,
} from '@/schemas/zod/helpers';

type LegacyDailyRecordShape = DailyRecord & {
  nurseName?: string;
  tens?: string[];
};

const pushRule = (appliedRules: LegacyMigrationRule[], rule: LegacyMigrationRule): void => {
  if (!appliedRules.includes(rule)) {
    appliedRules.push(rule);
  }
};

const pushRecoveredIssue = (recoveredIssues: string[], issue: string): void => {
  if (!recoveredIssues.includes(issue)) {
    recoveredIssues.push(issue);
  }
};

const migrateLegacyNurses = (
  record: LegacyDailyRecordShape,
  migrated: DailyRecord,
  appliedRules: LegacyMigrationRule[]
): void => {
  const normalized = applyDailyRecordStaffingCompatibility({
    nurses: migrated.nurses,
    nurseName: migrated.nurseName,
    nursesDayShift: migrated.nursesDayShift,
    nursesNightShift: migrated.nursesNightShift,
  });

  if (
    hasLegacyDayShiftNurses(record) &&
    (!record.nursesDayShift || record.nursesDayShift.every(n => !n))
  ) {
    pushRule(appliedRules, 'legacy_nurses_promoted_to_day_shift');
  }

  if (
    hasLegacyPrimaryDayShiftNurse(record) &&
    (!record.nursesDayShift || !record.nursesDayShift[0])
  ) {
    pushRule(appliedRules, 'legacy_single_nurse_promoted');
  }

  Object.assign(migrated, {
    nurses: normalized.nurses,
    nursesDayShift: normalized.nursesDayShift,
    nursesNightShift: normalized.nursesNightShift,
  });
};

const migrateLegacyTens = (
  record: LegacyDailyRecordShape,
  migrated: DailyRecord,
  appliedRules: LegacyMigrationRule[]
): void => {
  const rawTens = record.tens;
  if (!Array.isArray(rawTens) || rawTens.length === 0) return;

  const hasTens = rawTens.some(t => !!t);
  const isDayTensEmpty = !migrated.tensDayShift || migrated.tensDayShift.every(t => !t);
  if (!hasTens || !isDayTensEmpty) return;

  const paddedTens = [...rawTens];
  while (paddedTens.length < 3) paddedTens.push('');
  migrated.tensDayShift = paddedTens.slice(0, 3);
  pushRule(appliedRules, 'legacy_tens_promoted_to_day_shift');
};

const enforceSchemaVersionFloor = (
  migrated: DailyRecord,
  appliedRules: LegacyMigrationRule[],
  sourceVersion: number
): void => {
  const previousVersion = migrated.schemaVersion || 0;
  migrated.schemaVersion = Math.max(previousVersion, 1);
  if (migrated.schemaVersion !== previousVersion || sourceVersion <= 0) {
    pushRule(appliedRules, 'schema_version_floor_enforced');
  }
};

const reconcileLegacyPatientIdentity = (
  patient: DailyRecord['beds'][string] | undefined,
  recoveredIssues: string[]
): void => {
  if (!patient) {
    return;
  }

  const patientReference = patient.bedId || patient.patientName || 'cama_sin_id';
  const normalizedIdentityValue = normalizeLegacyIdentityValue(patient.rut);
  if (normalizedIdentityValue !== patient.rut) {
    patient.rut = normalizedIdentityValue;
    pushRecoveredIssue(recoveredIssues, `identity_value_normalized:${patientReference}`);
  }

  if (
    hasMismatchedExplicitNameParts({
      patientName: patient.patientName,
      firstName: patient.firstName,
      lastName: patient.lastName,
      secondLastName: patient.secondLastName,
    })
  ) {
    Object.assign(patient, resolveLegacyNameParts(patient.patientName));
    pushRecoveredIssue(recoveredIssues, `name_parts_reconciled:${patientReference}`);
  }

  const inferredDocumentType = inferDocumentTypeFromIdentity(patient.rut);
  const previousDocumentType = patient.documentType;
  if (
    inferredDocumentType &&
    (!patient.documentType ||
      (patient.documentType === 'RUT' && inferredDocumentType === 'Pasaporte') ||
      (!patient.rut && patient.documentType !== inferredDocumentType))
  ) {
    patient.documentType = inferredDocumentType;
    if (previousDocumentType !== patient.documentType) {
      pushRecoveredIssue(recoveredIssues, `document_type_reconciled:${patientReference}`);
    }
  }

  const previousIdentityStatus = patient.identityStatus;
  if (!patient.rut) {
    patient.identityStatus = 'provisional';
  } else if (!patient.identityStatus || patient.identityStatus === 'provisional') {
    patient.identityStatus = 'official';
  }
  if (previousIdentityStatus !== patient.identityStatus) {
    pushRecoveredIssue(recoveredIssues, `identity_status_reconciled:${patientReference}`);
  }

  if (patient.clinicalCrib) {
    reconcileLegacyPatientIdentity(patient.clinicalCrib, recoveredIssues);
  }
};

const reconcileLegacyPatientIdentityAcrossBeds = (
  migrated: DailyRecord,
  recoveredIssues: string[]
): void => {
  Object.values(migrated.beds || {}).forEach(patient => {
    reconcileLegacyPatientIdentity(patient, recoveredIssues);
  });
};

const classifyCompatibilityIntensity = (
  appliedRules: LegacyMigrationRule[],
  compatibilityDisposition: ReturnType<typeof assessSchemaCompatibility>['disposition']
): MigrationCompatibilityIntensity => {
  if (compatibilityDisposition === 'legacy_bridge') {
    return 'legacy_schema_bridge';
  }

  const hasLegacyStaffPromotion = appliedRules.some(
    rule =>
      rule === 'legacy_nurses_promoted_to_day_shift' ||
      rule === 'legacy_single_nurse_promoted' ||
      rule === 'legacy_tens_promoted_to_day_shift'
  );

  if (appliedRules.includes('schema_version_floor_enforced')) {
    return hasLegacyStaffPromotion ? 'legacy_schema_bridge' : 'legacy_schema_bridge';
  }

  if (hasLegacyStaffPromotion) {
    return 'legacy_staff_promoted';
  }

  if (
    appliedRules.includes('schema_defaults_applied') ||
    appliedRules.includes('legacy_nulls_normalized') ||
    appliedRules.includes('salvage_patient_fallback_applied') ||
    appliedRules.includes('record_invariants_normalized')
  ) {
    return 'normalized_only';
  }

  return 'none';
};

/**
 * Migrates legacy data formats to the current schema using Zod for robust validation.
 *
 * @param record - The record to migrate (potentially in legacy format)
 * @param date - The date string for the record
 * @returns Fully migrated and validated DailyRecord
 */
export const migrateLegacyDataWithReport = (
  record: DailyRecord,
  date: string
): DailyRecordMigrationResult => {
  const normalizedRecord = record as LegacyDailyRecordShape;
  const appliedRules: LegacyMigrationRule[] = [];
  const recoveredIssues: string[] = [];
  const schemaMigration = migrateRecordSchemaToCurrent(record, date);
  const compatibilityAssessment = assessSchemaCompatibility(record);

  // 1. Initial pass through Zod to apply defaults and recover basic structure
  const schemaParse = parseDailyRecordWithDefaultsReport(
    schemaMigration.record as LegacyDailyRecordShape,
    date
  );
  let migrated = schemaParse.record;
  pushRule(appliedRules, 'schema_defaults_applied');
  if (schemaParse.report.nullNormalization.replacedNullCount > 0) {
    pushRule(appliedRules, 'legacy_nulls_normalized');
  }
  if (schemaParse.report.salvagedBeds.length > 0) {
    pushRule(appliedRules, 'salvage_patient_fallback_applied');
  }

  // 2. Apply invariants so the current runtime never sees sparse bed maps.
  migrated = normalizeDailyRecordInvariants(migrated).record;
  pushRule(appliedRules, 'record_invariants_normalized');

  // Correct the former import contract on both Firebase and local-cache reads, without remote writes.
  const recoverMovement = <
    T extends DailyRecord['discharges'][number] | DailyRecord['transfers'][number],
  >(
    movement: T
  ): T => recoverImportedMovementCalendarDate(movement, date);
  migrated.discharges = migrated.discharges.map(recoverMovement);
  migrated.transfers = migrated.transfers.map(recoverMovement);

  // 3. Apply explicit legacy compatibility rules that are still supported.
  migrateLegacyNurses(normalizedRecord, migrated, appliedRules);
  migrateLegacyTens(normalizedRecord, migrated, appliedRules);
  if (compatibilityAssessment.legacyBridgeCandidate) {
    reconcileLegacyPatientIdentityAcrossBeds(migrated, recoveredIssues);
  }
  enforceSchemaVersionFloor(migrated, appliedRules, schemaMigration.plan.sourceVersion);

  return {
    record: migrated,
    appliedRules,
    recoveredIssues,
    compatibilityIntensity: classifyCompatibilityIntensity(
      appliedRules,
      compatibilityAssessment.disposition
    ),
    schemaPlan: schemaMigration.plan,
    compatibilityDisposition: compatibilityAssessment.disposition,
  };
};

export const migrateLegacyData = (record: DailyRecord, date: string): DailyRecord =>
  migrateLegacyDataWithReport(record, date).record;
